import { describe, expect, it } from "vitest";

import { isRewardNeeded, type RewardNeedContext } from "../../../../src/lib/relic/rewardNeed.js";
import type { MasteryStatus } from "../../../../src/types/inventory.js";
import type { RelicReward } from "../../../../src/types/relics.js";

const CHASSIS_COMPONENT = "/Lotus/Types/Recipes/WarframeRecipes/SarynPrimeChassisComponent";
const CHASSIS_BLUEPRINT = "/Lotus/Types/Recipes/WarframeRecipes/SarynPrimeChassisBlueprint";
const SARYN_PRIME = "/Lotus/Powersuits/Mag/SarynPrime";

function makeReward(overrides: Partial<RelicReward> = {}): RelicReward {
  return {
    name: "Saryn Prime Chassis",
    uniqueName: CHASSIS_COMPONENT,
    rarity: "Common",
    chance: 25,
    urlName: "saryn_prime_chassis",
    ducats: 45,
    ...overrides,
  };
}

interface ContextOverrides {
  owned?: Record<string, number>;
  building?: string[];
  mastery?: Record<string, MasteryStatus>;
  parents?: Record<string, string>;
  ownedByName?: boolean;
}

function makeContext(overrides: ContextOverrides = {}): RewardNeedContext {
  const parents = overrides.parents ?? {
    [CHASSIS_COMPONENT]: SARYN_PRIME,
    [CHASSIS_BLUEPRINT]: SARYN_PRIME,
  };

  return {
    owned: new Map(Object.entries(overrides.owned ?? {})),
    building: new Set(overrides.building ?? []),
    mastery: new Map(Object.entries(overrides.mastery ?? {})),
    parentOf: (uniqueName) => parents[uniqueName] ?? null,
    uniqueNameOf: (reward) => reward.uniqueName || null,
    ownedByName: () => overrides.ownedByName ?? false,
  };
}

describe("isRewardNeeded", () => {
  it("needs a reward nothing in the account accounts for", () => {
    expect(isRewardNeeded(makeReward(), makeContext())).toBe(true);
  });

  it("does not need a part held under the other spelling", () => {
    const ctx = makeContext({ owned: { [CHASSIS_BLUEPRINT]: 1 } });
    expect(isRewardNeeded(makeReward(), ctx)).toBe(false);
  });

  it("does not need a part whose parent is in the foundry", () => {
    const ctx = makeContext({ building: [SARYN_PRIME] });
    expect(isRewardNeeded(makeReward(), ctx)).toBe(false);
  });

  it("does not need a part whose parent is built", () => {
    const ctx = makeContext({ owned: { [SARYN_PRIME]: 1 } });
    expect(isRewardNeeded(makeReward(), ctx)).toBe(false);
  });

  it("does not need a part whose parent is mastered but no longer owned", () => {
    const ctx = makeContext({ mastery: { [SARYN_PRIME]: "mastered" } });
    expect(isRewardNeeded(makeReward(), ctx)).toBe(false);
  });

  it("does not need a whole item that is mastered", () => {
    const ctx = makeContext({
      parents: {},
      mastery: { [CHASSIS_COMPONENT]: "mastered" },
    });
    expect(isRewardNeeded(makeReward(), ctx)).toBe(false);
  });

  it("still needs a part whose parent is only in progress", () => {
    const ctx = makeContext({ mastery: { [SARYN_PRIME]: "progress" } });
    expect(isRewardNeeded(makeReward(), ctx)).toBe(true);
  });

  it("falls back to the name check when the reward has no uniqueName", () => {
    const reward = makeReward({ uniqueName: null });
    expect(isRewardNeeded(reward, makeContext({ owned: { [SARYN_PRIME]: 1 } }))).toBe(true);
    expect(isRewardNeeded(reward, makeContext({ ownedByName: true }))).toBe(false);
  });
});
