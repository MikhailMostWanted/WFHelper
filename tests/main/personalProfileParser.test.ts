import { describe, expect, it } from "vitest";

import {
  enrichPersonalProfileNames,
  parsePersonalProfile,
  revivePersonalProfile,
} from "../../services/personalProfileParser";

function appearancePayload(cus: unknown = 0, selectedId = "selected") {
  return {
    Stats: {},
    Results: [
      {
        LoadOutPreset: { s: { ItemId: { $oid: selectedId }, cus, hide: true } },
        LoadOutInventory: {
          Suits: [
            {
              ItemId: { $oid: "selected" },
              ItemType: "/Lotus/Suits/Test",
              Configs: [
                {
                  Name: "  Test look  ",
                  Skins: ["", "/Lotus/Skins/Test", "/Lotus/Types/EmptyCustomization"],
                  pricol: { t0: 0xff112233, t1: -16777216, t2: 0, t3: null, en: 0x80123456 },
                  attcol: { m0: 0xffffffff },
                  syancol: { e1: 0x12345678 },
                  sigcol: { t0: -2147483648 },
                },
              ],
            },
          ],
        },
      },
    ],
  };
}

describe("parsePersonalProfile", () => {
  it("rejects unrelated input and preserves unavailable tables", () => {
    for (const input of [null, [], {}, { Results: [{}] }, { Stats: [] }]) {
      expect(parsePersonalProfile(input)).toBeNull();
    }
    expect(parsePersonalProfile({ Stats: {} })).toEqual({
      career: {},
      equipment: null,
      enemies: null,
      abilities: null,
      missions: null,
      appearance: [],
    });
  });

  it("accepts both Stats locations and keeps zero distinct from missing or malformed", () => {
    const stats = {
      Income: 0,
      TimePlayedSec: 3.25,
      Deaths: null,
      ReviveCount: "3",
      HealCount: -1,
      FishCount: Infinity,
    };
    expect(parsePersonalProfile({ Stats: stats })?.career).toEqual({
      Income: 0,
      TimePlayedSec: 3.25,
    });
    expect(parsePersonalProfile({ Results: [{ Stats: stats }] })?.career).toEqual({
      Income: 0,
      TimePlayedSec: 3.25,
    });
  });

  it("reads bounded metadata and discards private account fields", () => {
    const profile = parsePersonalProfile({
      Stats: {},
      Results: [
        {
          DisplayName: " Sample ",
          PlayerLevel: 0,
          Created: { $date: { $numberLong: "1700000000000" } },
          AccountId: "private",
          GuildName: "private",
          token: "private",
        },
      ],
    });
    expect(profile).toMatchObject({
      displayName: "Sample",
      masteryRank: 0,
      registeredAt: 1700000000000,
    });
    expect(JSON.stringify(profile)).not.toContain("private");
    expect(
      parsePersonalProfile({
        Stats: {},
        Results: [{ DisplayName: "x".repeat(121), PlayerLevel: 1.5, Created: { $date: null } }],
      }),
    ).not.toHaveProperty("registeredAt");
  });

  it("keeps table identities and the largest reported duplicate counters without summing", () => {
    const profile = parsePersonalProfile({
      Stats: {
        Weapons: [
          null,
          { type: "/Test/A", kills: 4 },
          { type: "/Test/A", kills: 8, equipTime: 1.25 },
          { type: "/Test/A", kills: 90, xp: 2 },
          { type: "/Test/B", xp: 0, assists: false },
          { type: "x".repeat(513), kills: 1 },
        ],
        Abilities: [{ type: "/Unknown/Ability", used: 0 }],
        Missions: [{ type: "/Unknown/Node", highScore: 12 }],
      },
    });
    expect(profile?.equipment).toEqual([
      { type: "/Test/A", kills: 90, xp: 2, equipTime: 1.25 },
      { type: "/Test/B", xp: 0 },
    ]);
    expect(profile?.abilities).toEqual([{ type: "/Unknown/Ability", used: 0 }]);
    expect(profile?.missions).toEqual([{ type: "/Unknown/Node", highScore: 12 }]);
  });

  it("joins scan counts only to exact existing enemy identities", () => {
    const profile = parsePersonalProfile({
      Stats: {
        Enemies: [
          { type: "/Enemy/A", kills: 1 },
          { type: "/Enemy/B", scans: 0 },
          { type: "/Enemy/a" },
        ],
        Scans: [
          { type: "/Enemy/A", scans: 4 },
          { type: "/Enemy/B", scans: 7 },
          { type: "/Lore/C", scans: 10 },
        ],
      },
    });
    expect(profile?.enemies).toEqual([
      { type: "/Enemy/A", kills: 1, scans: 4 },
      { type: "/Enemy/B", scans: 0 },
      { type: "/Enemy/a" },
    ]);
    expect(
      parsePersonalProfile({ Stats: { Scans: [{ type: "/Lore/C", scans: 10 }] } })?.enemies,
    ).toBeNull();
    expect(parsePersonalProfile({ Stats: { Enemies: [{ type: "/Enemy/A" }] } })?.enemies).toEqual([
      { type: "/Enemy/A" },
    ]);
  });

  it("converts packed colors without losing alpha, zero or skin slot indices", () => {
    const item = parsePersonalProfile(appearancePayload())?.appearance[0];
    expect(item?.activeConfig).toBe(0);
    expect(item?.hiddenWhenHolstered).toBe(true);
    expect(item?.configs[0]).toEqual({
      name: "Test look",
      skins: [{ slot: 1, type: "/Lotus/Skins/Test" }],
      colors: {
        pricol: { t0: "#112233ff", t1: "#000000ff", t2: "#00000000", en: "#12345680" },
        attcol: { m0: "#ffffffff" },
        syancol: { e1: "#34567812" },
        sigcol: { t0: "#00000080" },
      },
    });
    expect(JSON.stringify(item)).not.toContain("selected");
  });

  it("does not invent an active config for a missing, invalid or mismatched preset", () => {
    for (const index of [undefined, null, "0", -1, 0.5, 1, Infinity]) {
      const payload = appearancePayload(index);
      payload.Results[0].LoadOutPreset.s.cus = index;
      expect(parsePersonalProfile(payload)?.appearance[0].activeConfig).toBeNull();
    }
    expect(
      parsePersonalProfile(appearancePayload(0, "other"))?.appearance[0].activeConfig,
    ).toBeNull();
    const fallback = appearancePayload();
    fallback.Results[0].LoadOutPreset.s.ItemId.$oid = "";
    expect(parsePersonalProfile(fallback)?.appearance[0].activeConfig).toBe(0);
    fallback.Results[0].LoadOutInventory.Suits.push(fallback.Results[0].LoadOutInventory.Suits[0]);
    expect(parsePersonalProfile(fallback)?.appearance.map((item) => item.activeConfig)).toEqual([
      null,
      null,
    ]);
  });

  it("drops invalid packed colors and explicit empty customization markers", () => {
    const payload = appearancePayload();
    const config = payload.Results[0].LoadOutInventory.Suits[0].Configs[0];
    config.pricol = {
      t0: 0x100000000,
      t1: -0x80000001,
      t2: 1.5,
      t3: null,
      en: Infinity,
    };
    config.Skins = ["EmptyCustomization", "", "/Lotus/Types/EmptyCustomization"];
    const parsed = parsePersonalProfile(payload)?.appearance[0].configs[0];
    expect(parsed?.skins).toEqual([]);
    expect(parsed?.colors).not.toHaveProperty("pricol");
  });

  it("bounds untrusted row, item, config and skin counts", () => {
    const payload = appearancePayload();
    const item = payload.Results[0].LoadOutInventory.Suits[0];
    item.Configs[0].Skins = Array.from({ length: 200 }, (_, i) => `/Skin/${i}`);
    item.Configs = Array.from({ length: 20 }, () => item.Configs[0]);
    payload.Results[0].LoadOutInventory.Suits = Array.from({ length: 20 }, () => item);
    const profile = parsePersonalProfile({
      ...payload,
      Stats: { Weapons: Array.from({ length: 10_001 }, (_, i) => ({ type: `/Weapon/${i}` })) },
    });
    expect(profile?.equipment).toHaveLength(10_000);
    expect(profile?.appearance).toHaveLength(16);
    expect(profile?.appearance[0].configs).toHaveLength(12);
    expect(profile?.appearance[0].configs[0].skins).toHaveLength(128);
  });
});

describe("revivePersonalProfile", () => {
  it("round trips normalized data and strips unexpected private fields", () => {
    const profile = parsePersonalProfile(appearancePayload());
    expect(revivePersonalProfile(profile)).toEqual(profile);
    expect(revivePersonalProfile({ ...profile, AccountId: "private" })).toEqual(profile);
  });

  it("rejects malformed persisted tables and metadata rather than treating them as empty", () => {
    const profile = parsePersonalProfile({ Stats: {} });
    for (const patch of [
      { career: { Income: null } },
      { equipment: undefined },
      { enemies: {} },
      { equipment: [{ type: "x", kills: NaN }] },
      { equipment: [{ type: "x" }, { type: "x" }] },
      { equipment: Array.from({ length: 10_001 }, (_, i) => ({ type: String(i) })) },
      { displayName: "" },
      { masteryRank: -1 },
      { registeredAt: 8.64e15 + 1 },
    ])
      expect(revivePersonalProfile({ ...profile, ...patch })).toBeNull();
  });

  it("rejects invalid appearance indices, slots and color values", () => {
    const profile = parsePersonalProfile(appearancePayload())!;
    const item = profile.appearance[0];
    for (const patch of [
      { category: "Other" },
      { activeConfig: 5 },
      { activeConfig: undefined },
      { hiddenWhenHolstered: "true" },
      { configs: Array.from({ length: 13 }, () => item.configs[0]) },
      { configs: [{ skins: [{ slot: -1, type: "/Skin/A" }], colors: {} }] },
      { configs: [{ skins: [], colors: { pricol: { t0: "red" } } }] },
    ])
      expect(revivePersonalProfile({ ...profile, appearance: [{ ...item, ...patch }] })).toBeNull();
  });
});

describe("enrichPersonalProfileNames", () => {
  it("resolves direct and Warframe ability names and mission labels without changing raw identities", () => {
    const profile = parsePersonalProfile({
      Stats: {
        Abilities: [
          { type: "/Ability/Direct", used: 12 },
          { type: "/Ability/Suit", used: 4 },
          { type: "/Ability/Unknown" },
        ],
        Missions: [{ type: "SolNode1", highScore: 99 }, { type: "UnknownNode" }],
      },
    })!;
    const source = {
      abilities: { "/Ability/Direct": { name: "/Language/Direct" } },
      warframes: {
        "/Suit/Test": {
          abilities: [
            { uniqueName: "/Ability/Suit", name: "/Language/Suit" },
            { uniqueName: "/Ability/Direct", name: "/Language/Duplicate" },
          ],
        },
      },
      resolveName: (value: unknown) =>
        value === "/Language/Direct"
          ? "Direct ability"
          : value === "/Language/Suit"
            ? "Suit ability"
            : null,
      missionName: (type: string) => (type === "SolNode1" ? "Test node (Earth)" : type),
    };
    const enriched = enrichPersonalProfileNames(profile, source);
    expect(enriched.abilities).toEqual([
      { type: "/Ability/Direct", name: "Direct ability", used: 12 },
      { type: "/Ability/Suit", name: "Suit ability", used: 4 },
      { type: "/Ability/Unknown" },
    ]);
    expect(enriched.missions).toEqual([
      { type: "SolNode1", name: "Test node (Earth)", highScore: 99 },
      { type: "UnknownNode" },
    ]);
    expect(profile.abilities?.[0]).not.toHaveProperty("name");
    expect(revivePersonalProfile(enriched)).toEqual(enriched);
    const changedLocale = enrichPersonalProfileNames(enriched, {
      ...source,
      resolveName: () => "Neue Fähigkeit",
      missionName: () => null,
    });
    expect(changedLocale.abilities?.[0].name).toBe("Neue Fähigkeit");
    expect(changedLocale.missions?.[0]).not.toHaveProperty("name");
  });

  it("preserves unavailable tables and rejects malformed persisted names", () => {
    const profile = parsePersonalProfile({ Stats: {} })!;
    expect(
      enrichPersonalProfileNames(profile, {
        abilities: null,
        warframes: [],
        resolveName: () => null,
        missionName: () => null,
      }),
    ).toEqual(profile);
    for (const name of [null, 4, "", "x".repeat(241)]) {
      expect(
        revivePersonalProfile({ ...profile, abilities: [{ type: "/Ability/A", name }] }),
      ).toBeNull();
      expect(revivePersonalProfile({ ...profile, missions: [{ type: "Node", name }] })).toBeNull();
    }
  });
});

it("combines split Stats locations and preserves explicitly empty tables", () => {
  const result = parsePersonalProfile({
    Stats: { TimePlayedSec: 0, Weapons: [] },
    Results: [
      { Stats: { TimePlayedSec: 99, Income: 25, Weapons: [{ type: "/Weapon/Old" }], Enemies: [] } },
    ],
  });
  expect(result?.career).toEqual({ TimePlayedSec: 0, Income: 25 });
  expect(result?.equipment).toEqual([]);
  expect(result?.enemies).toEqual([]);
});

it("decodes a signed profile color matching the independent profile viewer", () => {
  const result = parsePersonalProfile({
    Stats: {},
    Results: [
      {
        LoadOutInventory: {
          Suits: [{ ItemType: "/Suit/Fixture", Configs: [{ pricol: { t0: -25600 } }] }],
        },
      },
    ],
  });
  expect(result?.appearance[0].configs[0].colors.pricol?.t0).toBe("#ff9c00ff");
});
