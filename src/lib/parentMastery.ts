import { componentUniqueNameAliases } from "../../config/shared/componentNames.js";
import type { SafetyVerdict } from "./inventory/safetyRules.js";
import type { ItemDbEntry, MasteryData } from "../types/inventory.js";

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
  const items = mastery?.items ?? [];
  if (items.length === 0) return () => ({});

  const statusByUnique = new Map<string, string>();
  const statusByName = new Map<string, string>();
  for (const item of items) {
    if (!item.status) continue;
    if (item.uniqueName) statusByUnique.set(item.uniqueName, item.status);
    statusByName.set(item.name.toLowerCase(), item.status);
  }

  const nameIndex = new Map<string, string>();
  for (const [uniqueName, entry] of Object.entries(itemDb)) {
    const key = entry.name?.toLowerCase();
    if (key && !nameIndex.has(key)) nameIndex.set(key, uniqueName);
  }

  const statusOf = (uniqueName?: string, name?: string): string | undefined =>
    (uniqueName ? statusByUnique.get(uniqueName) : undefined) ??
    (name ? statusByName.get(name.toLowerCase()) : undefined);

  const masteredFlag = (status: string | undefined): PartMasteryFlags =>
    status ? { parentMastered: status === "mastered" } : {};

  return (row) => {
    const setBase = /\sSet$/i.test(row.name) ? row.name.replace(/\s+Set$/i, "") : null;
    if (setBase) return masteredFlag(statusOf(undefined, setBase));

    const resolved =
      dbEntryFor(itemDb, row.internalName) ??
      dbEntryFor(itemDb, nameIndex.get(row.name.toLowerCase()));
    if (resolved?.entry.isBuildComponent && resolved.entry.componentOf) {
      const parent = itemDb[resolved.entry.componentOf];
      return {
        ...masteredFlag(statusOf(resolved.entry.componentOf, parent?.name)),
        component: true,
      };
    }
    return masteredFlag(statusOf(resolved?.uniqueName ?? row.internalName, row.name));
  };
}

/** Takes a prebuilt resolver: it indexes the whole item database, so callers
 * keep one per itemDb/mastery pair instead of rebuilding it per row list.
 * `spare` comes from the safety verdicts so the filter, the card badge and the
 * bulk sell queue can never disagree about what is free to sell. */
export function attachPartMasteryFlags<T extends RowLike>(
  rows: T[],
  resolve: PartMasteryResolver,
  verdicts?: ReadonlyMap<string, SafetyVerdict>,
): T[] {
  return rows.map((row) => {
    const { component, ...flags } = resolve(row);
    const verdict = component && row.internalName ? verdicts?.get(row.internalName) : undefined;
    if (flags.parentMastered === undefined && verdict === undefined) return row;
    return { ...row, ...flags, ...(verdict ? { spare: verdict.safe > 0 } : {}) };
  });
}
