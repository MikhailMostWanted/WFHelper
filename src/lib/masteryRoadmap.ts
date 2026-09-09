import { componentUniqueNameAliases } from "../../config/shared/componentNames.js";
import type { ComponentInfo, ParsedItem } from "../types/inventory.js";
import type { FoundryState } from "../types/filters.js";
import type { OwnedCounts, RelicDatabase, RelicQuality, RelicReward } from "../types/relics.js";

type MasteryRoadmapAccess = "owned" | "gild" | "claimable" | "building" | "buildable";

interface MissingMasteryComponent {
  component: ComponentInfo;
  count: number;
}

interface OwnedRelicPool {
  count: number;
  rewards: RelicReward[];
}

interface RelicComponentMatcher {
  uniqueNames: Set<string>;
  names: Set<string>;
}

export interface MasteryRoadmapSourceItem extends ParsedItem {
  masteryXpRemaining: number;
  platinum: number | null;
  estimatedCost: number | null;
  owned: boolean;
  foundryState: FoundryState | undefined;
}

export interface MasteryRoadmapRecommendation extends MasteryRoadmapSourceItem {
  access: MasteryRoadmapAccess | "relics" | "platinum";
  xpPerPlatinum: number | null;
  relicProbability: number | null;
  relevantRelicCount: number;
}

function missingMasteryComponents(components: ComponentInfo[]): MissingMasteryComponent[] {
  return components
    .map((component) => {
      const required = Math.max(1, component.itemCount ?? 1);
      const owned = component.owned ? required : Math.max(0, component.ownedCount ?? 0);
      const foundry = component.building ? 1 : 0;
      return { component, count: Math.max(0, required - owned - foundry) };
    })
    .filter((entry) => entry.count > 0);
}

export function estimateMasteryPurchaseCost(
  rootPrice: number | null,
  components: MasteryRoadmapSourceItem["components"],
  componentPrice: (component: MasteryRoadmapSourceItem["components"][number]) => number | null,
): number | null {
  if (components.length === 0) return rootPrice;

  const missing = missingMasteryComponents(components);
  if (missing.length === 0) return null;

  let componentTotal = 0;
  for (const entry of missing) {
    const price = componentPrice(entry.component);
    if (price == null || !Number.isFinite(price) || price <= 0) return rootPrice;
    componentTotal += price * entry.count;
  }

  if (rootPrice == null || !Number.isFinite(rootPrice) || rootPrice <= 0) return componentTotal;
  return Math.min(rootPrice, componentTotal);
}

export interface MasteryRoadmap {
  easy: MasteryRoadmapRecommendation[];
  relics: MasteryRoadmapRecommendation[];
  platinum: MasteryRoadmapRecommendation[];
}

const ACCESS_PRIORITY: Record<MasteryRoadmapAccess, number> = {
  owned: 0,
  gild: 1,
  claimable: 2,
  building: 3,
  buildable: 4,
};

function easyAccess(item: MasteryRoadmapSourceItem): MasteryRoadmapAccess | null {
  // A max-rank ungilded amp reads "level it" otherwise, which is what the player just did.
  if (item.needsGilding) return "gild";
  if (item.owned || item.currentlyOwned) return "owned";
  if (item.foundryState === "claimable") return "claimable";
  if (item.foundryState === "building") return "building";
  if (item.foundryState === "buildable") return "buildable";
  return null;
}

function normalizePartName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/(?:^|\s)blueprint$/, "")
    .trim();
}

function componentMatcher(
  item: MasteryRoadmapSourceItem,
  component: ComponentInfo,
): RelicComponentMatcher {
  const uniqueNames = new Set(
    component.uniqueName
      ? componentUniqueNameAliases(component.uniqueName).map((name) => name.toLowerCase())
      : [],
  );
  const itemName = normalizePartName(item.name);
  const componentName = normalizePartName(component.name);
  const fullName = componentName.startsWith(itemName)
    ? componentName
    : `${itemName} ${componentName}`.trim();
  return { uniqueNames, names: new Set([fullName]) };
}

function matchingComponentIndex(reward: RelicReward, matchers: RelicComponentMatcher[]): number {
  const uniqueName = reward.uniqueName?.toLowerCase() || "";
  if (uniqueName) {
    const byUniqueName = matchers.findIndex((matcher) => matcher.uniqueNames.has(uniqueName));
    if (byUniqueName >= 0) return byUniqueName;
  }

  const rewardName = normalizePartName(reward.name);
  return matchers.findIndex((matcher) => matcher.names.has(rewardName));
}

function buildOwnedRelicPools(
  relicDb: RelicDatabase | null,
  ownedCounts: OwnedCounts,
): OwnedRelicPool[] {
  if (!relicDb) return [];
  const pools: OwnedRelicPool[] = [];
  for (const [groupKey, qualities] of Object.entries(ownedCounts)) {
    const group = relicDb.groups[groupKey];
    if (!group) continue;
    for (const [quality, rawCount] of Object.entries(qualities) as Array<[RelicQuality, number]>) {
      const count = Math.max(0, Math.floor(rawCount));
      const rewards = group.qualities[quality]?.rewards || [];
      if (count > 0 && rewards.length > 0) pools.push({ count, rewards });
    }
  }
  return pools;
}

function calculateOwnedRelicCompletion(
  item: MasteryRoadmapSourceItem,
  pools: OwnedRelicPool[],
): { probability: number; relicCount: number } | null {
  const missing = missingMasteryComponents(item.components);
  if (missing.length === 0 || pools.length === 0) return null;

  const matchers = missing.map((entry) => componentMatcher(item, entry.component));
  const relevantPools: Array<{ count: number; chances: number[] }> = [];
  const obtainable = new Array(missing.length).fill(false) as boolean[];
  let relicCount = 0;

  for (const pool of pools) {
    const chances = new Array(missing.length).fill(0) as number[];
    for (const reward of pool.rewards) {
      const index = matchingComponentIndex(reward, matchers);
      if (index < 0) continue;
      const chance = Math.max(0, Math.min(1, reward.chance / 100));
      chances[index] += chance;
    }
    const total = chances.reduce((sum, chance) => sum + chance, 0);
    if (total <= 0) continue;
    if (total > 1) {
      for (let index = 0; index < chances.length; index++) chances[index] /= total;
    }
    for (let index = 0; index < chances.length; index++) {
      if (chances[index] > 0) obtainable[index] = true;
    }
    relevantPools.push({ count: pool.count, chances });
    relicCount += pool.count;
  }

  if (obtainable.some((value) => !value)) return null;

  const multipliers: number[] = [];
  let stateCount = 1;
  for (const entry of missing) {
    multipliers.push(stateCount);
    stateCount *= entry.count + 1;
  }

  // One relic yields one reward, so keep a capped joint distribution instead
  // of treating each missing component as an independent event.
  let current = new Float64Array(stateCount);
  current[0] = 1;
  for (const pool of relevantPools) {
    const awardedChance = pool.chances.reduce((sum, chance) => sum + chance, 0);
    for (let copy = 0; copy < pool.count; copy++) {
      const next = new Float64Array(stateCount);
      for (let state = 0; state < stateCount; state++) {
        const probability = current[state];
        if (probability === 0) continue;
        next[state] += probability * Math.max(0, 1 - awardedChance);
        for (let index = 0; index < pool.chances.length; index++) {
          const chance = pool.chances[index];
          if (chance === 0) continue;
          const multiplier = multipliers[index];
          const progress = Math.floor(state / multiplier) % (missing[index].count + 1);
          const nextState = progress < missing[index].count ? state + multiplier : state;
          next[nextState] += probability * chance;
        }
      }
      current = next;
    }
  }

  const probability = Math.max(0, Math.min(1, current[stateCount - 1]));
  return probability > 0 ? { probability, relicCount } : null;
}

export function buildMasteryRoadmap(
  items: MasteryRoadmapSourceItem[],
  relicDb: RelicDatabase | null = null,
  ownedCounts: OwnedCounts = {},
): MasteryRoadmap {
  const easy: MasteryRoadmapRecommendation[] = [];
  const relics: MasteryRoadmapRecommendation[] = [];
  const platinum: MasteryRoadmapRecommendation[] = [];
  const ownedRelicPools = buildOwnedRelicPools(relicDb, ownedCounts);

  for (const item of items) {
    if (item.status === "mastered" || item.masteryXpRemaining <= 0) continue;

    const access = easyAccess(item);
    if (access) {
      easy.push({
        ...item,
        access,
        xpPerPlatinum: null,
        relicProbability: null,
        relevantRelicCount: 0,
      });
      continue;
    }

    const relicPlan = calculateOwnedRelicCompletion(item, ownedRelicPools);
    if (relicPlan) {
      relics.push({
        ...item,
        access: "relics",
        xpPerPlatinum: null,
        relicProbability: relicPlan.probability,
        relevantRelicCount: relicPlan.relicCount,
      });
    }

    if (
      typeof item.estimatedCost === "number" &&
      Number.isFinite(item.estimatedCost) &&
      item.estimatedCost > 0
    ) {
      platinum.push({
        ...item,
        access: "platinum",
        xpPerPlatinum: item.masteryXpRemaining / item.estimatedCost,
        relicProbability: null,
        relevantRelicCount: 0,
      });
    }
  }

  easy.sort(
    (a, b) =>
      ACCESS_PRIORITY[a.access as MasteryRoadmapAccess] -
        ACCESS_PRIORITY[b.access as MasteryRoadmapAccess] ||
      b.masteryXpRemaining - a.masteryXpRemaining ||
      a.name.localeCompare(b.name),
  );
  relics.sort(
    (a, b) =>
      (b.relicProbability ?? 0) - (a.relicProbability ?? 0) ||
      b.masteryXpRemaining - a.masteryXpRemaining ||
      a.name.localeCompare(b.name),
  );
  platinum.sort(
    (a, b) =>
      (b.xpPerPlatinum ?? 0) - (a.xpPerPlatinum ?? 0) ||
      (a.estimatedCost ?? Number.POSITIVE_INFINITY) -
        (b.estimatedCost ?? Number.POSITIVE_INFINITY) ||
      a.name.localeCompare(b.name),
  );

  return { easy, relics, platinum };
}
