import { describe, expect, it } from "vitest";
import { parsePersonalLoadouts } from "../../services/personalLoadouts";

const frameId = "a".repeat(24);
const primaryId = "b".repeat(24);
const modId = "c".repeat(24);
const absentId = "d".repeat(24);
const slot = (id: string, mod = 1, cus = 0) => ({ ItemId: { $oid: id }, mod, cus });
const fixture = () => ({
  LoadOutPresets: {
    NORMAL: [
      { n: "Fixture loadout", s: slot(frameId), l: slot(primaryId), p: slot(absentId), m: {} },
      { n: "Other fixture", s: slot(frameId, 0, 1) },
    ],
    ARCHWING: [{ n: "Not a normal loadout", s: slot(frameId) }],
  },
  CurrentLoadOutIds: [{ $oid: frameId }],
  Suits: [
    {
      ItemId: { $oid: frameId },
      ItemType: "/Lotus/Powersuits/Fixture",
      Configs: [
        { Name: "Appearance one", Skins: ["/Lotus/Skins/Fixture"], Upgrades: [] },
        {
          Name: "Build two",
          Skins: [] as string[],
          Upgrades: [modId, "", "/Lotus/Upgrades/Mods/Fixture", absentId],
        },
      ],
    },
  ],
  LongGuns: [
    {
      ItemId: { $oid: primaryId },
      ItemType: "/Lotus/Weapons/Fixture",
      Configs: [{ Skins: [] }, { Upgrades: [modId] }],
    },
  ],
  Upgrades: [
    {
      ItemId: { $oid: modId },
      ItemType: "/Lotus/Upgrades/Mods/RankedFixture",
      UpgradeFingerprint: '{"lvl":8,"secret":"never-export"}',
    },
  ],
});

describe("saved personal loadouts", () => {
  it("resolves instance references and separate appearance and mod configurations", () => {
    const result = parsePersonalLoadouts(fixture());
    expect(result).toHaveLength(2);
    const frame = result[0].slots[0].item!;
    expect(frame.activeConfig).toBe(0);
    expect(frame.activeModConfig).toBe(1);
    expect(frame.configs[0].skins).toEqual([{ slot: 0, type: "/Lotus/Skins/Fixture" }]);
    expect(frame.modConfigs[1].upgrades).toEqual([
      { slot: 0, type: "/Lotus/Upgrades/Mods/RankedFixture", rank: 8 },
      { slot: 2, type: "/Lotus/Upgrades/Mods/Fixture", rank: null },
      { slot: 3, type: null, rank: null },
    ]);
    expect(result[1].slots[0].item).toMatchObject({ activeConfig: 1, activeModConfig: 0 });
    expect(result[0].slots[1].item?.modConfigs[1].upgrades?.[0].rank).toBe(8);
    expect(result[0].slots.slice(2)).toEqual([{ category: "Pistols", item: null }]);
    const serialized = JSON.stringify(result);
    for (const privateValue of [
      frameId,
      primaryId,
      modId,
      absentId,
      "never-export",
      "CurrentLoadOutIds",
    ])
      expect(serialized).not.toContain(privateValue);
  });

  it("supports nested helper envelopes without treating the public preset as all saved presets", () => {
    expect(parsePersonalLoadouts({ InventoryJson: JSON.stringify(fixture()) })).toEqual(
      parsePersonalLoadouts(fixture()),
    );
    for (const value of [
      null,
      {},
      { LoadOutPreset: fixture().LoadOutPresets.NORMAL[0] },
      { LoadOutPresets: { NORMAL: {} } },
    ])
      expect(parsePersonalLoadouts(value)).toEqual([]);
  });

  it("omits unequipped slots but keeps unresolved equipment references unavailable", () => {
    const result = parsePersonalLoadouts(fixture());
    expect(result[0].slots.map((slot) => slot.category)).toEqual(["Suits", "LongGuns", "Pistols"]);
    expect(result[1].slots.map((slot) => slot.category)).toEqual(["Suits"]);
    expect(result[0].slots[2].item).toBeNull();
  });

  it("preserves missing configurations and unreported ranks as unknown", () => {
    const payload = fixture();
    payload.LoadOutPresets.NORMAL[0].s = slot(frameId, 99, -1);
    payload.Upgrades[0].UpgradeFingerprint = "corrupt";
    const frame = parsePersonalLoadouts(payload)[0].slots[0].item!;
    expect(frame.activeConfig).toBeNull();
    expect(frame.activeModConfig).toBeNull();
    expect(frame.modConfigs[0].upgrades).toEqual([]);
    expect(frame.modConfigs[1].upgrades?.[0].rank).toBeNull();
    expect(parsePersonalLoadouts(payload)[0].slots[1].item?.modConfigs[0].upgrades).toBeNull();
  });

  it("bounds result size and does not substitute a different owned item for an unresolved slot", () => {
    const payload = fixture();
    payload.LoadOutPresets.NORMAL = Array.from(
      { length: 200 },
      () => payload.LoadOutPresets.NORMAL[0],
    );
    payload.LoadOutPresets.NORMAL[0].s = slot(absentId);
    const result = parsePersonalLoadouts(payload);
    expect(result).toHaveLength(128);
    expect(result[0].slots[0].item).toBeNull();
    expect(result[0].slots[1].item?.type).toBe("/Lotus/Weapons/Fixture");
  });
});

describe("owned skin references", () => {
  it("resolves WeaponSkins ids to their type and drops ids the inventory does not hold", () => {
    const skinId = "e".repeat(24);
    const payload = fixture();
    Object.assign(payload, {
      WeaponSkins: [{ ItemId: { $oid: skinId }, ItemType: "/Lotus/Upgrades/Skins/Armor/Fixture" }],
    });
    payload.Suits[0].Configs[0].Skins.push(skinId, absentId);
    const frame = parsePersonalLoadouts(payload)[0].slots[0].item!;
    expect(frame.configs[0].skins).toEqual([
      { slot: 0, type: "/Lotus/Skins/Fixture" },
      { slot: 1, type: "/Lotus/Upgrades/Skins/Armor/Fixture" },
    ]);
  });
});
