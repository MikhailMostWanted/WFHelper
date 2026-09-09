import { describe, expect, it } from "vitest";

import {
  buildMasteryRoadmap,
  estimateMasteryPurchaseCost,
  type MasteryRoadmapSourceItem,
} from "../../../src/lib/masteryRoadmap.js";
import type { OwnedCounts, RelicDatabase, RelicReward } from "../../../src/types/relics.js";

function item(overrides: Partial<MasteryRoadmapSourceItem>): MasteryRoadmapSourceItem {
  return {
    name: "Item",
    internalName: "/Item",
    imageUrl: null,
    category: "Primary",
    categoryLabel: "Primary",
    status: "missing",
    rank: 0,
    maxRank: 30,
    isPrime: false,
    masteryReq: 0,
    vaulted: false,
    tradable: true,
    description: "",
    masteryXpRemaining: 3_000,
    platinum: null,
    estimatedCost: null,
    owned: false,
    foundryState: undefined,
    components: [],
    drops: [],
    wikiaUrl: null,
    ...overrides,
  };
}

function relicInventory(
  rewards: RelicReward[],
  count: number,
): { db: RelicDatabase; owned: OwnedCounts } {
  return {
    db: {
      groups: {
        "Lith T1": {
          key: "Lith T1",
          name: "Lith T1",
          tier: "Lith",
          code: "T1",
          imageUrl: null,
          qualities: { intact: { uniqueName: "/Relic", rewards } },
        },
      },
      byUniqueName: {},
    },
    owned: {
      "Lith T1": { intact: count, exceptional: 0, flawless: 0, radiant: 0 },
    },
  };
}

function reward(name: string, uniqueName: string, chance: number): RelicReward {
  return { name, uniqueName, chance, rarity: "Common", urlName: null, ducats: null };
}

describe("buildMasteryRoadmap", () => {
  it("orders directly actionable items before Foundry actions", () => {
    const roadmap = buildMasteryRoadmap([
      item({ name: "Buildable", foundryState: "buildable" }),
      item({ name: "Claimable", foundryState: "claimable" }),
      item({ name: "Owned", status: "progress", owned: true }),
    ]);

    expect(roadmap.easy.map((entry) => entry.name)).toEqual(["Owned", "Claimable", "Buildable"]);
  });

  it("tells an ungilded modular build to gild before levelling", () => {
    const roadmap = buildMasteryRoadmap([
      item({ name: "Claimable", foundryState: "claimable" }),
      item({ name: "Mote Prism", status: "progress", owned: true, needsGilding: true }),
      item({ name: "Owned", status: "progress", owned: true }),
    ]);

    expect(roadmap.easy.map((entry) => [entry.name, entry.access])).toEqual([
      ["Owned", "owned"],
      ["Mote Prism", "gild"],
      ["Claimable", "claimable"],
    ]);
  });

  it("ranks purchases by remaining XP per platinum", () => {
    const roadmap = buildMasteryRoadmap([
      item({ name: "Efficient", platinum: 10, estimatedCost: 10, masteryXpRemaining: 3_000 }),
      item({ name: "Expensive", platinum: 40, estimatedCost: 40, masteryXpRemaining: 6_000 }),
    ]);

    expect(roadmap.platinum.map((entry) => entry.name)).toEqual(["Efficient", "Expensive"]);
    expect(roadmap.platinum[0].xpPerPlatinum).toBe(300);
  });

  it("excludes mastered, unpriced, and already actionable items from purchases", () => {
    const roadmap = buildMasteryRoadmap([
      item({ name: "Mastered", status: "mastered", platinum: 5, estimatedCost: 5 }),
      item({ name: "Unpriced" }),
      item({ name: "Owned", owned: true, platinum: 5, estimatedCost: 5 }),
    ]);

    expect(roadmap.platinum).toEqual([]);
    expect(roadmap.easy.map((entry) => entry.name)).toEqual(["Owned"]);
  });

  it("does not treat sold partial-progress items as owned", () => {
    const roadmap = buildMasteryRoadmap([
      item({
        name: "Sold Partial",
        status: "progress",
        currentlyOwned: false,
        platinum: 10,
        estimatedCost: 10,
      }),
    ]);

    expect(roadmap.easy).toEqual([]);
    expect(roadmap.platinum.map((entry) => entry.name)).toEqual(["Sold Partial"]);
  });

  it("calculates the exact chance of getting every missing part from owned relics", () => {
    const { db, owned } = relicInventory(
      [reward("Item Part A", "/PartA", 50), reward("Item Part B", "/PartB", 50)],
      2,
    );
    const roadmap = buildMasteryRoadmap(
      [
        item({
          components: [
            { name: "Part A", uniqueName: "/PartA" },
            { name: "Part B", uniqueName: "/PartB" },
          ],
        }),
      ],
      db,
      owned,
    );

    expect(roadmap.relics).toHaveLength(1);
    expect(roadmap.relics[0].relicProbability).toBeCloseTo(0.5);
    expect(roadmap.relics[0].relevantRelicCount).toBe(2);
  });

  it("ignores owned parts and orders relic recommendations by completion chance", () => {
    const { db, owned } = relicInventory(
      [reward("Low Part", "/Low", 20), reward("High Part", "/High", 50)],
      1,
    );
    const roadmap = buildMasteryRoadmap(
      [
        item({ name: "Low", components: [{ name: "Part", uniqueName: "/Low" }] }),
        item({
          name: "High",
          components: [
            { name: "Already owned", uniqueName: "/Unavailable", owned: true },
            { name: "Part", uniqueName: "/High" },
          ],
        }),
      ],
      db,
      owned,
    );

    expect(roadmap.relics.map((entry) => entry.name)).toEqual(["High", "Low"]);
    expect(roadmap.relics.map((entry) => entry.relicProbability)).toEqual([0.5, 0.2]);
  });

  it("omits items when owned relics cannot supply every missing copy", () => {
    const { db, owned } = relicInventory([reward("Item Part", "/Part", 100)], 1);
    const roadmap = buildMasteryRoadmap(
      [item({ components: [{ name: "Part", uniqueName: "/Part", itemCount: 2 }] })],
      db,
      owned,
    );

    expect(roadmap.relics).toEqual([]);
  });

  it("matches parent-prefixed relic rewards when component paths are unavailable", () => {
    const { db, owned } = relicInventory([reward("Boar Prime Blueprint", "", 100)], 1);
    const roadmap = buildMasteryRoadmap(
      [item({ name: "Boar Prime", components: [{ name: "Blueprint" }] })],
      db,
      owned,
    );

    expect(roadmap.relics[0]?.relicProbability).toBe(1);
  });
});

describe("estimateMasteryPurchaseCost", () => {
  it("prices only the last missing part of a nearly complete set", () => {
    const components = [
      { name: "Blueprint", owned: true },
      { name: "Barrel", owned: false },
      { name: "Receiver", owned: true },
      { name: "Stock", owned: true },
    ];

    expect(
      estimateMasteryPurchaseCost(40, components, (component) =>
        component.name === "Barrel" ? 7 : null,
      ),
    ).toBe(7);
  });

  it("uses the cheaper of a complete set and all missing components", () => {
    const components = [
      { name: "Blueprint", itemCount: 1, ownedCount: 0 },
      { name: "Barrel", itemCount: 2, ownedCount: 1 },
      { name: "Receiver", itemCount: 1, owned: true },
    ];
    const prices = new Map([
      ["Blueprint", 8],
      ["Barrel", 5],
    ]);

    expect(
      estimateMasteryPurchaseCost(
        20,
        components,
        (component) => prices.get(component.name) ?? null,
      ),
    ).toBe(13);
    expect(
      estimateMasteryPurchaseCost(
        10,
        components,
        (component) => prices.get(component.name) ?? null,
      ),
    ).toBe(10);
  });

  it("falls back to the set price when a missing component has no price", () => {
    expect(estimateMasteryPurchaseCost(25, [{ name: "Unknown", owned: false }], () => null)).toBe(
      25,
    );
  });

  it("prices only missing copies when another copy is building", () => {
    expect(
      estimateMasteryPurchaseCost(
        20,
        [{ name: "Blade", itemCount: 2, ownedCount: 0, building: true }],
        () => 3,
      ),
    ).toBe(3);
  });
});
