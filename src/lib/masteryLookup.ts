import { componentParentOf } from "./inventory/partConsumers.js";
import type { ItemDbEntry, MasteryData, MasteryStatus } from "../types/inventory.js";

interface MasteryLookup {
  byUniqueName: Map<string, MasteryStatus>;
  byName: Map<string, MasteryStatus>;
}

export function normalizeLookupKey(value: string | null | undefined): string {
  return (value || "").trim().toLowerCase();
}

/** Plain Maps: callers rebuild the whole lookup inside a reactive statement,
 *  so per-entry reactivity would never be observed. */
export function buildMasteryLookup(data: MasteryData | null): MasteryLookup {
  const byUniqueName = new Map<string, MasteryStatus>();
  const byName = new Map<string, MasteryStatus>();

  for (const item of data?.items ?? []) {
    const status = item.status;
    if (!status) continue;

    const uniqueName = item.uniqueName || item.internalName;
    if (uniqueName && !byUniqueName.has(uniqueName)) {
      byUniqueName.set(uniqueName, status);
    }

    const nameKey = normalizeLookupKey(item.name);
    if (nameKey && !byName.has(nameKey)) {
      byName.set(nameKey, status);
    }
  }

  return { byUniqueName, byName };
}

function statusOf(
  lookup: MasteryLookup,
  uniqueName: string | null | undefined,
  name: string | null | undefined,
): MasteryStatus | undefined {
  return (
    (uniqueName ? lookup.byUniqueName.get(uniqueName) : undefined) ??
    lookup.byName.get(normalizeLookupKey(name))
  );
}

/** A build component has no mastery of its own and carries the status of the
 *  item it builds; anything else answers for itself, by uniqueName then name. */
export function inheritedMasteryStatus(
  lookup: MasteryLookup,
  itemDb: Record<string, ItemDbEntry>,
  uniqueName: string | null | undefined,
  name: string | null | undefined,
): MasteryStatus | undefined {
  if (uniqueName) {
    const direct = lookup.byUniqueName.get(uniqueName);
    if (direct) return direct;
    const parent = componentParentOf(uniqueName, itemDb);
    if (parent) {
      const inherited = statusOf(lookup, parent, itemDb[parent]?.name);
      if (inherited) return inherited;
    }
  }
  return lookup.byName.get(normalizeLookupKey(name));
}
