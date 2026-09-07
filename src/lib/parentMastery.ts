import { componentUniqueNameAliases } from "../../config/shared/componentNames.js";
import { componentParentOf } from "./inventory/partConsumers.js";
import type { SafetyVerdictLookup } from "./inventory/safetyRules.js";
import { buildMasteryLookup, inheritedMasteryStatus, normalizeLookupKey } from "./masteryLookup.js";
import type { ItemDbEntry, MasteryData, MasteryStatus } from "../types/inventory.js";

interface RowLike {
  name: string;
  internalName?: string;
  parentMastered?: boolean;
  spare?: boolean;
}

interface PartMasteryFlags {
  parentMastered?: boolean;
  /** The row is a build component, the only kind the Spares filter is about. */
  component?: true;
}

type PartMasteryResolver = (row: RowLike) => PartMasteryFlags;

function dbEntryFor(
  itemDb: Record<string, ItemDbEntry>,
  key: string | undefined,
): { uniqueName: string; entry: ItemDbEntry } | null {
  if (!key) return null;
  const candidates = [...componentUniqueNameAliases(key), key.replace(/Blueprint$/i, "")];
  for (const candidate of candidates) {
    const entry = itemDb[candidate];
    if (entry) return { uniqueName: candidate, entry };
  }
  return null;
}

/** Per-row parent-mastery flag. Unset means nothing masterable owns the row,
 * and the strict tri-state filter then skips it. */
export function buildPartMasteryResolver(
  itemDb: Record<string, ItemDbEntry>,
  mastery: MasteryData | null,
): PartMasteryResolver {
  if ((mastery?.items ?? []).length === 0) return () => ({});
  const lookup = buildMasteryLookup(mastery);

  const nameIndex = new Map<string, string>();
  for (const [uniqueName, entry] of Object.entries(itemDb)) {
    const key = normalizeLookupKey(entry.name);
    if (key && !nameIndex.has(key)) nameIndex.set(key, uniqueName);
  }

  const masteredFlag = (status: MasteryStatus | undefined): PartMasteryFlags =>
    status ? { parentMastered: status === "mastered" } : {};

  return (row) => {
    const setBase = /\sSet$/i.test(row.name) ? row.name.replace(/\s+Set$/i, "") : null;
    if (setBase) return masteredFlag(lookup.byName.get(normalizeLookupKey(setBase)));

    const resolved =
      dbEntryFor(itemDb, row.internalName) ??
      dbEntryFor(itemDb, nameIndex.get(normalizeLookupKey(row.name)));
    const parent = resolved ? componentParentOf(resolved.uniqueName, itemDb) : null;
    if (parent) {
      return {
        ...masteredFlag(inheritedMasteryStatus(lookup, itemDb, parent, itemDb[parent]?.name)),
        component: true,
      };
    }
    return masteredFlag(
      inheritedMasteryStatus(lookup, itemDb, resolved?.uniqueName ?? row.internalName, row.name),
    );
  };
}

/** Takes a prebuilt resolver: it indexes the whole item database, so keep one
 * per itemDb/mastery pair. */
export function attachPartMasteryFlags<T extends RowLike>(
  rows: T[],
  resolve: PartMasteryResolver,
  verdicts?: SafetyVerdictLookup,
): T[] {
  return rows.map((row) => {
    const { component, ...flags } = resolve(row);
    const verdict = component && row.internalName ? verdicts?.get(row.internalName) : undefined;
    if (flags.parentMastered === undefined && verdict === undefined) return row;
    return { ...row, ...flags, ...(verdict ? { spare: verdict.safe > 0 } : {}) };
  });
}
