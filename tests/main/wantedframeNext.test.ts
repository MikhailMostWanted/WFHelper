import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OcrWorkQueue } from "../../services/ocrWorkQueue";
import { parseRussianRivenStats } from "../../services/rivenRussianText";
import { buildAccountSnapshot } from "../../services/accountSnapshot";
import { beginStartupData, finishStartupData, waitForStartupData } from "../../services/startupReadiness";
import { nameInLocale, setGameLocale, getGameLocale } from "../../services/gameLocale";

const mod = "a".repeat(24), frame = "b".repeat(24);
const settings = { source: "file", inventoryUpdatedAt: 1000, now: 2000, appVersion: "preview" };
const payload = () => ({
  PlayerLevel: 14, RegularCredits: 12345, PremiumCredits: 0, FusionPoints: 900,
  sessionToken: "NEVER_EXPORT_THIS", Email: "PRIVATE_EMAIL", AccountId: { $oid: "PRIVATE_ID" },
  MiscItems: [{ ItemType: "/Lotus/Tests/Resource", ItemCount: 52 }], RawUpgrades: [],
  Suits: [{ ItemType: "/Lotus/Tests/Frame", ItemId: { $oid: frame }, XP: 0, Polarized: 3,
    Configs: [{ Name: "A", Upgrades: [mod, "", "/Lotus/Tests/UnknownRank"] }],
    ArchonCrystalUpgrades: [{ UpgradeType: "/Lotus/Tests/Shard", Color: "ACC_RED_MYTHIC" }, {}] }],
  Upgrades: [{ ItemType: "/Lotus/Tests/Mod", ItemId: { $oid: mod }, UpgradeFingerprint: JSON.stringify({ lvl: 8, buffs: [{ Tag: "Damage", Value: 12345 }], secret: "PRIVATE_FP" }) }],
  XPInfo: [{ ItemType: "/Lotus/Tests/SoldWeapon", XP: 450000 }],
  LoadOutPresets: { NORMAL: [{ n: "My build", s: { ItemId: { $oid: frame }, mod: 1, cus: 2 } }] },
});
afterEach(() => { vi.useRealTimers(); setGameLocale("en"); finishStartupData(); });

describe("bounded native OCR", () => {
  it("retains the capacity of timed-out native work until actual completion", async () => {
    vi.useFakeTimers(); const queue = new OcrWorkQueue(1, 2);
    let release!: (v: string) => void;
    const first = queue.run(() => new Promise<string>((resolve) => { release = resolve; }), 10);
    const failed = first.catch((error: Error) => error.message);
    await vi.advanceTimersByTimeAsync(11); expect(await failed).toContain("deadline");
    const work = vi.fn().mockResolvedValue("second"); const next = queue.run(work, 100);
    await vi.advanceTimersByTimeAsync(1); expect(work).not.toHaveBeenCalled();
    release("late"); await vi.advanceTimersByTimeAsync(0); expect(await next).toBe("second");
  });
  it("does not start expired queued work and bounds the waiting queue", async () => {
    vi.useFakeTimers(); const queue = new OcrWorkQueue(1, 1);
    let release!: () => void;
    const first = queue.run(() => new Promise<void>((resolve) => { release = resolve; }), 100);
    const work = vi.fn().mockResolvedValue("unwanted");
    const second = queue.run(work, 10).catch(() => "expired");
    expect(await queue.run(work, 50).catch((error: Error) => error.message)).toContain("busy");
    await vi.advanceTimersByTimeAsync(11); expect(await second).toBe("expired");
    release(); await first; await vi.advanceTimersByTimeAsync(0); expect(work).not.toHaveBeenCalled();
  });
  it("releases capacity after a native failure", async () => {
    const queue = new OcrWorkQueue(1);
    await expect(queue.run(async () => { throw new Error("native failed"); }, 100)).rejects.toThrow("native failed");
    expect(await queue.run(async () => "recovered", 100)).toBe("recovered");
  });
});

describe("Russian Riven labels and numbers", () => {
  it("reads DE labels, decimal commas and the inverse recoil sign", () => {
    const result = parseRussianRivenStats("+120,5% урона\n+90,2% мультивыстрел\n−45,1% к отдаче");
    expect(result.unresolved).toEqual([]);
    expect(result.stats).toMatchObject([{ name: "Damage", value: 120.5, positive: true }, { name: "Multishot", value: 90.2, positive: true }, { name: "Weapon Recoil", value: 45.1, positive: true, displayPositive: false }]);
  });
  it("joins wrapped names but ignores footer text", () => {
    const result = parseRussianRivenStats("Имя карточки\n+88,3% к скорости\nперезарядки\n+120% урона\nРанг 16\nОписание");
    expect(result.stats.map((s) => s.name)).toEqual(["Reload Speed", "Damage"]); expect(result.unresolved).toEqual([]);
  });
  it("retains faction multipliers and non-percentage units", () => {
    expect(parseRussianRivenStats("х0,75 урона Корпусу\n+5,2с к длительности комбо").stats).toMatchObject([{ name: "Damage to Corpus", value: 0.75, multiplier: true, positive: false }, { name: "Combo Duration", value: 5.2, positive: true }]);
  });
  it("does not invent decimal positions or unknown stats", () => {
    const result = parseRussianRivenStats("+1205% урона\n+99% загадочное свойство\n+1 5% мультивыстрел");
    expect(result.stats).toMatchObject([{ name: "Damage", value: 1205 }]); expect(result.unresolved).toHaveLength(2);
  });
  it("does not add duplicated stats together", () => {
    const result = parseRussianRivenStats("+10% урона\n+20% урона");
    expect(result.stats).toHaveLength(1); expect(result.unresolved).toHaveLength(1);
  });
  it("repairs mixed Cyrillic and Latin without touching numbers", () => {
    expect(parseRussianRivenStats("+100,2% урoна\n+75% к скорoсти перезaрядки").stats).toHaveLength(2);
  });
});

describe("account snapshot", () => {
  it("distinguishes zero, absent sections and original timestamps", () => {
    const result = buildAccountSnapshot(payload(), settings);
    expect(result.account).toEqual({ masteryRank: 14, masteryXp: null, credits: 12345, platinum: 0, endo: 900 });
    expect(result.inventoryUpdatedAt).toBe(1000); expect(result.generatedAt).toBe(2000);
    expect(result.coverage.find((r) => r.section === "RawUpgrades")?.status).toBe("present");
    expect(result.coverage.find((r) => r.section === "LongGuns")?.status).toBe("absent");
  });
  it("resolves mod ranks and retains unknown ranks and empty sockets", () => {
    const item = buildAccountSnapshot(payload(), settings).items.find((i) => i.section === "Suits")!;
    expect(item.count).toBe(1); expect(item.xp).toBe(0); expect(item.polarizationCount).toBe(3);
    expect(item.configs?.[0].mods?.[0]).toMatchObject({ slot: 0, type: "/Lotus/Tests/Mod", rank: 8 });
    expect(item.configs?.[0].mods?.[2]).toMatchObject({ slot: 2, rank: null });
    expect(item.shards?.[1]).toEqual({ slot: 1, type: null, color: null });
  });
  it("does not treat historical mastery as current ownership", () => {
    const item = buildAccountSnapshot(payload(), settings).items.find((i) => i.type === "/Lotus/Tests/SoldWeapon")!;
    expect(item.section).toBe("XPInfo"); expect(item.count).toBeNull();
  });
  it("preserves separate mod and appearance selections", () => {
    expect(buildAccountSnapshot(payload(), settings).loadouts[0].slots[0]).toEqual({ slot: "s", instanceId: frame, modConfig: 1, appearanceConfig: 2 });
  });
  it("does not copy authentication or raw fingerprint fields", () => {
    const result = buildAccountSnapshot({ InventoryJson: JSON.stringify(payload()) }, settings);
    for (const secret of ["NEVER_EXPORT_THIS", "PRIVATE_EMAIL", "PRIVATE_ID", "PRIVATE_FP", "sessionToken"]) expect(JSON.stringify(result)).not.toContain(secret);
    expect(result.items.find((r) => r.section === "Upgrades")?.roll?.buffs[0].rawValue).toBe(12345);
  });
  it("rejects invalid inputs", () => { expect(() => buildAccountSnapshot({}, settings)).toThrow("No valid inventory"); });
  it("reports malformed rows and nested truncation", () => {
    const data = payload();
    const result = buildAccountSnapshot({ ...data, MiscItems: [...data.MiscItems, { ItemType: "invalid" }], Suits: [{ ...data.Suits[0], Configs: Array.from({ length: 20 }, () => ({ Upgrades: [] })) }] }, settings);
    expect(result.coverage.find((r) => r.section === "MiscItems")?.status).toBe("partial"); expect(result.fieldCoverage.omittedValues).toBe(8);
  });
  it("resolves Russian strings without changing game language", () => {
    setGameLocale("de"); expect(nameInLocale("/Lotus/Language/Items/RifleModDamageAmount", "ru")).toBeTruthy();
    expect(getGameLocale()).toBe("de"); expect(nameInLocale("/Lotus/NotAKnownKey", "ru")).toBeNull();
  });
  it("keeps the last valid file when an update fails", async () => {
    const { saveAccountSnapshot, getAccountSnapshotStatus } = await import("../../services/accountSnapshotStore");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wantedframe-snapshot-")); const file = path.join(dir, "account-snapshot.json");
    try {
      await saveAccountSnapshot(file, payload(), settings); const before = await fs.readFile(file, "utf8");
      await saveAccountSnapshot(file, {}, settings); expect(await fs.readFile(file, "utf8")).toBe(before);
      expect(getAccountSnapshotStatus().error).toContain("previous snapshot preserved"); expect(await fs.readdir(dir)).toEqual(["account-snapshot.json"]);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
});

describe("startup readiness", () => {
  it("holds early requests until build completion", async () => {
    beginStartupData(); const done = vi.fn(); const request = waitForStartupData().then(done);
    await Promise.resolve(); expect(done).not.toHaveBeenCalled(); finishStartupData(); await request; expect(done).toHaveBeenCalledOnce();
  });
  it("does not return an empty database after a failure", async () => {
    beginStartupData(); const request = waitForStartupData(); finishStartupData(false); await expect(request).rejects.toThrow("initialization failed");
  });
});
