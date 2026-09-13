// The game lists a relic's drops common first with the rare last, while @wfcd
// hands them over the other way round. Every in-app relic surface sorts through
// here; the planner overlay deliberately keeps rare first, see relicSelection.
const RELIC_RARITY_RANK: Readonly<Record<string, number>> = Object.freeze({
  common: 0,
  uncommon: 1,
  rare: 2,
});

/** Unknown rarities rank past rare, so they never displace a real drop. */
function relicRarityRank(rarity: string | null | undefined): number {
  return RELIC_RARITY_RANK[String(rarity ?? "").toLowerCase()] ?? 3;
}

export function sortRelicRewards<T extends { rarity?: string | null; chance?: number | null }>(
  rewards: readonly T[],
): T[] {
  return rewards.slice().sort((a, b) => {
    const rank = relicRarityRank(a.rarity) - relicRarityRank(b.rarity);
    if (rank !== 0) return rank;
    return (b.chance ?? 0) - (a.chance ?? 0);
  });
}
