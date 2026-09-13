import { collectRelicInventoryCounts } from "../../../config/shared/relicCounts.js";
import { QUALITY_MODES } from "./relicConstants.js";
import type { RawInventoryData } from "../../types/inventory.js";
import type { OwnedCounts, RelicDatabase, RelicGroup, RelicQuality } from "../../types/relics.js";

/** The refinements of one relic the player holds, in the game's tier order and
 *  with the empty ones dropped. Counts come in as an argument: a template call
 *  in a legacy component is untracked, so reading the store inside would leave
 *  the row showing whatever ownership held when it was first drawn. */
export function ownedRelicQualities(
  counts: OwnedCounts,
  groupKey: string,
): Array<{ quality: RelicQuality; count: number }> {
  const owned = counts[groupKey];
  if (!owned) return [];
  return QUALITY_MODES.filter((quality) => owned[quality] > 0).map((quality) => ({
    quality,
    count: owned[quality],
  }));
}

/** Group for a projection uniqueName of any refinement; null when unknown or
 *  the relic database has not loaded yet. */
export function relicGroupForUniqueName(
  relicDb: RelicDatabase | null,
  uniqueName: string,
): RelicGroup | null {
  const ref = relicDb?.byUniqueName[uniqueName];
  return ref ? (relicDb?.groups[ref.groupKey] ?? null) : null;
}

/** Group for a drop-table label ("Lith A1 Relic", "Lith A1 Relic (Radiant)").
 *  The group key is the bare "<tier> <code>", so the suffix and any refinement
 *  in parentheses are dropped before matching. */
export function relicGroupForDisplayName(
  relicDb: RelicDatabase | null,
  displayName: string,
): RelicGroup | null {
  if (!relicDb) return null;
  const cleaned = String(displayName || "")
    .replace(/\([^()]*\)/g, " ")
    .replace(/\bRelic\b/i, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;

  const direct = relicDb.groups[cleaned];
  if (direct) return direct;

  const wanted = cleaned.toLowerCase();
  return (
    Object.values(relicDb.groups).find(
      (group) => `${group.tier} ${group.code}`.toLowerCase() === wanted,
    ) ?? null
  );
}

export function parseOwnedRelics(
  inventoryData: RawInventoryData | null,
  relicDb: RelicDatabase | null,
): OwnedCounts {
  const owned: OwnedCounts = {};
  if (!inventoryData || !relicDb) return owned;

  const ensureOwnedSlot = (groupKey: string): void => {
    if (!owned[groupKey]) {
      owned[groupKey] = {
        intact: 0,
        exceptional: 0,
        flawless: 0,
        radiant: 0,
      };
    }
  };

  const countedByItemType = collectRelicInventoryCounts(
    inventoryData,
    (itemType) => relicDb.byUniqueName[itemType] !== undefined,
  );

  for (const [itemType, count] of countedByItemType) {
    const info = relicDb.byUniqueName[itemType];
    if (!info) continue;
    ensureOwnedSlot(info.groupKey);
    owned[info.groupKey][info.quality] += count;
  }

  return owned;
}
