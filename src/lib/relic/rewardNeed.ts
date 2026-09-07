import { componentUniqueNameAliases } from "../../../config/shared/componentNames.js";
import type { MasteryStatus } from "../../types/inventory.js";
import type { RelicReward } from "../../types/relics.js";

export interface RewardNeedContext {
  /** Owned copies per uniqueName from the raw inventory; foundry-consumed blueprints still count. */
  owned: ReadonlyMap<string, number>;
  /** Product uniqueNames sitting in the foundry, building or claimable. */
  building: ReadonlySet<string>;
  mastery: ReadonlyMap<string, MasteryStatus>;
  /** The item a component belongs to (itemDb componentOf), or null for a whole item. */
  parentOf: (uniqueName: string) => string | null;
  /** reward.uniqueName, else the WFM gameRef behind reward.urlName. */
  uniqueNameOf: (reward: RelicReward) => string | null;
  /** The parsed-inventory name/gameRef ownership check. */
  ownedByName: (reward: RelicReward) => boolean;
}

function heldOrMastered(uniqueName: string, ctx: RewardNeedContext): boolean {
  if ((ctx.owned.get(uniqueName) ?? 0) > 0) return true;
  if (ctx.building.has(uniqueName)) return true;
  return ctx.mastery.get(uniqueName) === "mastered";
}

/** A reward is still needed when neither it nor the item it builds is held,
 *  in the foundry, or mastered. Mastered gear the player sold stays unneeded. */
export function isRewardNeeded(reward: RelicReward, ctx: RewardNeedContext): boolean {
  if (ctx.ownedByName(reward)) return false;

  const uniqueName = ctx.uniqueNameOf(reward);
  if (!uniqueName) return true;

  for (const alias of componentUniqueNameAliases(uniqueName)) {
    if (heldOrMastered(alias, ctx)) return false;
    const parent = ctx.parentOf(alias);
    if (parent && heldOrMastered(parent, ctx)) return false;
  }

  return true;
}
