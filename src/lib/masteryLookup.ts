import type { MasteryData, MasteryStatus } from "../types/inventory.js";

export function normalizeLookupKey(value: string | null | undefined): string {
  return (value || "").trim().toLowerCase();
}

/** Plain Maps: callers rebuild the whole lookup inside a reactive statement,
 *  so per-entry reactivity would never be observed. */
export function buildMasteryLookup(data: MasteryData | null): {
  byUniqueName: Map<string, MasteryStatus>;
  byName: Map<string, MasteryStatus>;
} {
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
