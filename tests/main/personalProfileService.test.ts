import fs from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  directory: "",
  requests: [] as Array<(body: unknown, status?: number) => void>,
  responses: [] as EventEmitter[],
  warn: vi.fn(),
}));
vi.mock("electron", () => ({ app: { getPath: () => mocks.directory } }));
vi.mock("../../services/logger", () => ({
  withScope: () => ({ info: vi.fn(), warn: mocks.warn }),
}));
vi.mock("node:https", () => ({
  default: {
    get: (
      _url: string,
      _options: unknown,
      callback: (response: EventEmitter & { statusCode: number; resume: () => void }) => void,
    ) => {
      const req = Object.assign(new EventEmitter(), { setTimeout: vi.fn(), destroy: vi.fn() });
      mocks.requests.push((body, status = 200) => {
        const response = Object.assign(new EventEmitter(), { statusCode: status, resume: vi.fn() });
        mocks.responses.push(response);
        callback(response);
        if (body === undefined) return;
        response.emit("data", Buffer.from(JSON.stringify(body)));
        response.emit("end");
      });
      return req;
    },
  },
}));

const accountA = "a".repeat(24);
const accountB = "b".repeat(24);
const payload = (time: number) => ({
  Results: [{ DisplayName: "Fixture Tenno", PlayerLevel: 12 }],
  Stats: { TimePlayedSec: time, Scans: [{ type: "/Lotus/FixtureEnemy", scans: 2 }] },
});
const load = () => import("../../services/codexProfile");

beforeEach(() => {
  vi.resetModules();
  mocks.directory = fs.mkdtempSync(path.join(os.tmpdir(), "wfh-profile-service-"));
  mocks.requests = [];
  mocks.responses = [];
  mocks.warn.mockClear();
  vi.spyOn(Date, "now").mockReturnValue(1800000000000);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  fs.rmSync(mocks.directory, { recursive: true, force: true });
});

describe("personal profile service", () => {
  it("rejects account query substrings and suffixes consistently", async () => {
    const service = await load();
    const bytes = Buffer.from('{"Suits":[]}');
    for (const authz of [
      `?otheraccountId=${accountA}`,
      `?accountId=${accountA}a`,
      `?accountId=${accountA}-suffix`,
    ]) {
      service.noteAuthz(authz);
      service.noteInventorySnapshot(authz, bytes);
      expect((await service.getPersonalProfile()).status).toBe("no-account");
    }
    expect(mocks.requests).toHaveLength(0);
  });
  it("waits for a known account and a manual refresh", async () => {
    const service = await load();
    expect((await service.getPersonalProfile()).status).toBe("no-account");
    service.noteAuthz(`?accountId=${accountA}&nonce=1`);
    expect((await service.getPersonalProfile()).status).toBe("no-data");
    expect(mocks.requests).toHaveLength(0);
  });

  it("shares a profile request with Codex and persists only normalized personal data", async () => {
    const service = await load();
    service.noteAuthz(`?accountId=${accountA}&nonce=1`);
    const personal = service.getPersonalProfile(true);
    const codex = service.getCodexScans(true);
    expect(mocks.requests).toHaveLength(1);
    mocks.requests[0]({ ...payload(3600), SecretField: "do-not-cache" });
    expect((await personal).profile?.career.TimePlayedSec).toBe(3600);
    expect(await codex).toMatchObject({ scans: [{ type: "/Lotus/FixtureEnemy", count: 2 }] });
    const disk = fs.readFileSync(path.join(mocks.directory, "personal-profile.json"), "utf8");
    expect(disk).not.toContain("do-not-cache");
    vi.resetModules();
    expect((await (await load()).getPersonalProfile()).profile?.career.TimePlayedSec).toBe(3600);
    expect(mocks.requests).toHaveLength(1);
  });

  it("retains an old snapshot and exposes refresh failure without extending its timestamp", async () => {
    const service = await load();
    service.noteAuthz(`?accountId=${accountA}&nonce=1`);
    const first = service.getPersonalProfile(true);
    mocks.requests[0](payload(3600));
    const original = await first;
    vi.mocked(Date.now).mockReturnValue(1800000061000);
    const refresh = service.getPersonalProfile(true);
    mocks.requests[1]({}, 503);
    const result = await refresh;
    expect(result).toMatchObject({
      status: "fetch-failed",
      fetchedAt: original.fetchedAt,
      profile: original.profile,
    });
    expect((await service.getPersonalProfile(true)).status).toBe("fetch-failed");
    expect(mocks.requests).toHaveLength(2);
  });

  it("clears an obsolete failure after a successful shared Codex refresh", async () => {
    const service = await load();
    service.noteAuthz(`?accountId=${accountA}&nonce=1`);
    const first = service.getPersonalProfile(true);
    mocks.requests[0](payload(3600));
    await first;
    vi.mocked(Date.now).mockReturnValue(1800000061000);
    const failed = service.getPersonalProfile(true);
    mocks.requests[1]({}, 503);
    expect((await failed).status).toBe("fetch-failed");
    vi.mocked(Date.now).mockReturnValue(1800000122000);
    const codex = service.getCodexScans(true);
    mocks.requests[2](payload(7200));
    await codex;
    expect(await service.getPersonalProfile()).toMatchObject({
      status: "ready",
      fetchedAt: 1800000122000,
      profile: { career: { TimePlayedSec: 7200 } },
    });
  });

  it("does not publish or persist an old account's in-flight response", async () => {
    const service = await load();
    service.noteAuthz(`?accountId=${accountA}&nonce=1`);
    const first = service.getPersonalProfile(true);
    service.noteAuthz(`?accountId=${accountB}&nonce=1`);
    const second = service.getPersonalProfile(true);
    mocks.requests[1](payload(7200));
    expect((await second).profile?.career.TimePlayedSec).toBe(7200);
    mocks.requests[0](payload(3600));
    expect(await first).toMatchObject({ status: "account-changed", profile: null });
    expect((await service.getPersonalProfile()).profile?.career.TimePlayedSec).toBe(7200);
    expect(
      JSON.parse(fs.readFileSync(path.join(mocks.directory, "personal-profile.json"), "utf8"))
        .accountId,
    ).toBe(accountB);
  });

  it("rejects a disk snapshot for a different account", async () => {
    const service = await load();
    service.noteAuthz(`?accountId=${accountA}&nonce=1`);
    const first = service.getPersonalProfile(true);
    mocks.requests[0](payload(3600));
    await first;
    service.noteAuthz(`?accountId=${accountB}&nonce=1`);
    expect(await service.getPersonalProfile()).toMatchObject({
      status: "no-data",
      profile: null,
      fetchedAt: null,
    });
  });
});

describe("Codex profile refresh isolation", () => {
  it("does not reuse or persist obsolete account requests, including switching back", async () => {
    const service = await load();
    service.noteAuthz(`?accountId=${accountA}`);
    const old = service.getCodexScans(true);
    service.noteAuthz(`?accountId=${accountB}`);
    expect(await service.getCodexScans()).toMatchObject({ error: "no-data" });
    service.noteAuthz(`?accountId=${accountA}`);
    const current = service.getCodexScans(true);
    expect(mocks.requests).toHaveLength(2);
    mocks.requests[1](payload(7200));
    expect(await current).toMatchObject({ scans: [{ count: 2 }] });
    mocks.requests[0]({ Stats: { Scans: [{ type: "/Lotus/Old", scans: 99 }] } });
    expect(await old).toMatchObject({ error: "account-changed" });
    expect(await service.getCodexScans()).toMatchObject({ scans: [{ count: 2 }] });
  });

  it("retains stale scans with an explicit error and throttles failed attempts", async () => {
    const service = await load();
    service.noteAuthz(`?accountId=${accountA}`);
    const first = service.getCodexScans(true);
    mocks.requests[0](payload(1));
    const original = await first;
    vi.mocked(Date.now).mockReturnValue(1800000061000);
    const refresh = service.getCodexScans(true);
    mocks.requests[1]({}, 503);
    expect(await refresh).toMatchObject({
      ...original,
      error: "fetch-failed",
      nextRefreshAt: 1800000121000,
    });
    expect(await service.getCodexScans(true)).toMatchObject({ error: "fetch-failed" });
    expect(mocks.requests).toHaveLength(2);
  });

  it.each([
    { fetchedAt: 1800000000000, scans: [{ type: "/Lotus/X", count: 2 }] },
    { accountId: accountB, fetchedAt: 1800000000000, scans: [] },
    { accountId: accountA, fetchedAt: 9e15, scans: [] },
    { accountId: accountA, fetchedAt: 1800000000000, scans: [{ type: null, count: "bad" }] },
    { accountId: accountA, fetchedAt: 1800000000000, scans: [{ type: "/Lotus/X", count: true }] },
  ])("rejects unbound, mismatched, future or malformed scan cache %#", async (cache) => {
    fs.writeFileSync(path.join(mocks.directory, "codex-scans.json"), JSON.stringify(cache));
    const service = await load();
    service.noteAuthz(`?accountId=${accountA}`);
    expect(await service.getCodexScans()).toMatchObject({ error: "no-data" });
    const refresh = service.getCodexScans(true);
    mocks.requests[0](payload(1));
    expect(await refresh).toMatchObject({ scans: [{ count: 2 }] });
  });

  it.each(["aborted", "error", "close"])(
    "settles a response %s for both profile consumers",
    async (event) => {
      const service = await load();
      service.noteAuthz(`?accountId=${accountA}`);
      const personal = service.getPersonalProfile(true);
      const codex = service.getCodexScans(true);
      mocks.requests[0](undefined);
      mocks.responses[0].emit(event, new Error("fixture transport failure"));
      expect(await personal).toMatchObject({ status: "fetch-failed" });
      expect(await codex).toMatchObject({ error: "fetch-failed" });
      expect(mocks.warn).toHaveBeenCalled();
      expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain(accountA);
    },
  );

  it("enforces the total body deadline even while chunks arrive", async () => {
    vi.useFakeTimers();
    const service = await load();
    service.noteAuthz(`?accountId=${accountA}`);
    const request = service.getPersonalProfile(true);
    mocks.requests[0](undefined);
    for (let i = 0; i < 4; i++) {
      mocks.responses[0].emit("data", Buffer.from(" "));
      await vi.advanceTimersByTimeAsync(5000);
    }
    expect(await request).toMatchObject({ status: "fetch-failed" });
    expect(vi.getTimerCount()).toBe(0);
  });
});

it("enriches names once per snapshot and keeps source names off disk", async () => {
  const names = await import("../../services/regionNames");
  const enrich = vi.spyOn(names, "loadRegionTranslation");
  const service = await load();
  service.noteAuthz(`?accountId=${accountA}`);
  const first = service.getPersonalProfile(true);
  mocks.requests[0]({
    Stats: {
      Abilities: [{ type: "/Lotus/Powersuits/PowersuitAbilities/SlashDashAbility", used: 2 }],
    },
  });
  expect((await first).profile?.abilities?.[0].name).toBe("Slash Dash");
  expect((await service.getPersonalProfile()).profile?.abilities?.[0].name).toBe("Slash Dash");
  expect((await service.getPersonalProfile(true)).profile?.abilities?.[0].name).toBe("Slash Dash");
  expect(enrich).toHaveBeenCalledTimes(1);
  expect(
    fs.readFileSync(path.join(mocks.directory, "personal-profile.json"), "utf8"),
  ).not.toContain('"name":');
});

it("recovers a corrupt personal cache through manual refresh", async () => {
  fs.writeFileSync(
    path.join(mocks.directory, "personal-profile.json"),
    JSON.stringify({
      accountId: accountA,
      fetchedAt: 9e15,
      profile: { career: { TimePlayedSec: true } },
    }),
  );
  const service = await load();
  service.noteAuthz(`?accountId=${accountA}`);
  expect(await service.getPersonalProfile()).toMatchObject({ profile: null, status: "no-data" });
  const refresh = service.getPersonalProfile(true);
  mocks.requests[0](payload(2));
  expect(await refresh).toMatchObject({
    profile: { career: { TimePlayedSec: 2 } },
    status: "ready",
  });
});

it("does not log raw response JSON when parsing fails", async () => {
  const service = await load();
  service.noteAuthz(`?accountId=${accountA}`);
  const refresh = service.getPersonalProfile(true);
  mocks.requests[0](undefined);
  mocks.responses[0].emit("data", Buffer.from(`{secret: "${accountA}"`));
  mocks.responses[0].emit("end");
  mocks.responses[0].emit("close");
  expect(await refresh).toMatchObject({ status: "fetch-failed" });
  expect(JSON.stringify(mocks.warn.mock.calls)).toContain("not valid JSON");
  expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain(accountA);
});

describe("inventory account binding", () => {
  const bytes = Buffer.from('{"LoreFragmentScans":[{"ItemType":"/Fixture","Progress":1}]}');
  const hash = createHash("sha256").update(bytes).digest("hex");

  it("binds only a freshly fetched exact snapshot and survives a restart", async () => {
    const service = await load();
    expect(service.isInventorySnapshotForCurrentAccount(hash)).toBe(false);
    service.noteAuthz(`?accountId=${accountA}`);
    expect(service.isInventorySnapshotForCurrentAccount(hash)).toBe(false);
    service.noteInventorySnapshot(`?accountId=${accountA}&nonce=private-nonce`, bytes);
    expect(service.isInventorySnapshotForCurrentAccount(hash)).toBe(true);
    expect(service.isInventorySnapshotForCurrentAccount("f".repeat(64))).toBe(false);
    expect(service.isInventorySnapshotForCurrentAccount(hash.toUpperCase())).toBe(false);
    const disk = fs.readFileSync(
      path.join(mocks.directory, "inventory-profile-binding.json"),
      "utf8",
    );
    expect(disk).not.toContain("private-nonce");
    expect(disk).not.toContain("LoreFragmentScans");
    vi.resetModules();
    expect((await load()).isInventorySnapshotForCurrentAccount(hash)).toBe(true);
  });

  it("rejects an old account's binding and late response after switching accounts", async () => {
    const service = await load();
    service.noteAuthz(`?accountId=${accountA}`);
    service.noteInventorySnapshot(`?accountId=${accountA}`, bytes);
    service.noteAuthz(`?accountId=${accountB}`);
    expect(service.isInventorySnapshotForCurrentAccount(hash)).toBe(false);
    service.noteInventorySnapshot(`?accountId=${accountA}`, bytes);
    expect(service.isInventorySnapshotForCurrentAccount(hash)).toBe(false);
    service.noteInventorySnapshot(`?accountId=${accountB}`, bytes);
    expect(service.isInventorySnapshotForCurrentAccount(hash)).toBe(true);
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain(accountA);
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain(accountB);
  });

  it.each([
    null,
    { accountId: accountA, hash: true },
    { accountId: "invalid", hash },
    { hash },
    { accountId: accountA, hash: hash.toUpperCase() },
  ])("rejects corrupt or unbound binding cache %#", async (binding) => {
    fs.writeFileSync(
      path.join(mocks.directory, "inventory-profile-binding.json"),
      JSON.stringify(binding),
    );
    const service = await load();
    service.noteAuthz(`?accountId=${accountA}`);
    expect(service.isInventorySnapshotForCurrentAccount(hash)).toBe(false);
  });

  it("does not interrupt an inventory fetch when the binding cannot be saved", async () => {
    const service = await load();
    service.noteAuthz(`?accountId=${accountA}`);
    fs.mkdirSync(path.join(mocks.directory, "inventory-profile-binding.json"));
    expect(() => service.noteInventorySnapshot(`?accountId=${accountA}`, bytes)).not.toThrow();
    expect(service.isInventorySnapshotForCurrentAccount(hash)).toBe(false);
    expect(mocks.warn).toHaveBeenCalled();
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain(accountA);
  });
});

it("notifies account changes after invalidation without exposing an account id", async () => {
  const service = await load();
  const listener = vi.fn();
  const stop = service.onProfileAccountChanged(listener);
  const stopFailure = service.onProfileAccountChanged(() => {
    throw new Error(accountA);
  });
  service.noteAuthz(`?accountId=${accountA}`);
  expect(listener).toHaveBeenCalledExactlyOnceWith();
  expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain(accountA);
  service.noteAuthz(`?accountId=${accountA}`);
  expect(listener).toHaveBeenCalledTimes(1);
  stop();
  stopFailure();
  service.noteAuthz(`?accountId=${accountB}`);
  expect(listener).toHaveBeenCalledTimes(1);
});

it("notifies only newly persisted inventory bindings after they are readable", async () => {
  const service = await load();
  const bytes = Buffer.from('{"Suits":[]}');
  const hash = createHash("sha256").update(bytes).digest("hex");
  service.noteAuthz(`?accountId=${accountA}`);
  const bound: boolean[] = [];
  const listener = vi.fn(() => bound.push(service.isInventorySnapshotForCurrentAccount(hash)));
  const stop = service.onInventoryProfileBindingChanged(listener);
  const stopFailure = service.onInventoryProfileBindingChanged(() => {
    throw new Error(accountA);
  });
  service.noteInventorySnapshot(`?accountId=${accountB}`, bytes);
  expect(listener).not.toHaveBeenCalled();
  service.noteInventorySnapshot(`?accountId=${accountA}`, bytes);
  expect(listener).toHaveBeenCalledExactlyOnceWith();
  expect(bound).toEqual([true]);
  service.noteInventorySnapshot(`?accountId=${accountA}`, bytes);
  expect(listener).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain(accountA);
  stop();
  stopFailure();
  service.noteInventorySnapshot(`?accountId=${accountA}`, Buffer.from('{"Suits":[],"marker":1}'));
  expect(listener).toHaveBeenCalledTimes(1);
});

it("does not notify when an inventory binding write fails", async () => {
  const service = await load();
  service.noteAuthz(`?accountId=${accountA}`);
  const listener = vi.fn();
  const stop = service.onInventoryProfileBindingChanged(listener);
  fs.mkdirSync(path.join(mocks.directory, "inventory-profile-binding.json"));
  service.noteInventorySnapshot(`?accountId=${accountA}`, Buffer.from('{"Suits":[]}'));
  expect(listener).not.toHaveBeenCalled();
  stop();
});
