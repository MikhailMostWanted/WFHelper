import { componentUniqueNameAliases } from "../../config/shared/componentNames.js";
import { componentParentOf } from "./inventory/partConsumers.js";
import type { SafetyVerdictLookup } from "./inventory/safetyRules.js";
import { buildMasteryLookup, inheritedMasteryFacts, normalizeLookupKey } from "./masteryLookup.js";
import type { MasteryFacts } from "./masteryLookup.js";
import type { ItemDbEntry, MasteryData } from "../types/inventory.js";

interface RowLike {
  name: string;
  internalName?: string;
  parentMastered?: boolean;
  parentOwned?: boolean;
  spare?: boolean;
}

interface PartMasteryFlags {
  parentMastered?: boolean;
  /** The build this row feeds is in the inventory now. Left unset on a built
   *  row: there the owned count is the answer. */
  parentOwned?: boolean;
  /** The row is a build component, the only kind the Spares filter is about. */
  component?: true;
}

type PartMasteryResolver = (row: RowLike) => PartMasteryFlags;

/** What the M and C badges show for a row. */
interface ItemMarks {
  mastered: boolean;
  crafted: boolean;
}

export function itemMarksFor(flags: {
  parentMastered?: unknown;
  parentOwned?: unknown;
}): ItemMarks {
  return { mastered: flags.parentMastered === true, crafted: flags.parentOwned === true };
}

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

  // A part and a set row both answer for the build they belong to, so both
  // flags describe that build and never the row itself.
  const partFlags = (facts: MasteryFacts | undefined): PartMasteryFlags =>
    facts ? { parentMastered: facts.status === "mastered", parentOwned: facts.owned } : {};

  return (row) => {
    const setBase = /\sSet$/i.test(row.name) ? row.name.replace(/\s+Set$/i, "") : null;
    if (setBase) return partFlags(inheritedMasteryFacts(lookup, itemDb, null, setBase));

    const resolved =
      dbEntryFor(itemDb, row.internalName) ??
      dbEntryFor(itemDb, nameIndex.get(normalizeLookupKey(row.name)));
    const parent = resolved ? componentParentOf(resolved.uniqueName, itemDb) : null;
    if (parent) {
      return {
        ...partFlags(inheritedMasteryFacts(lookup, itemDb, parent, itemDb[parent]?.name)),
        component: true,
      };
    }
    const facts = inheritedMasteryFacts(
      lookup,
      itemDb,
      resolved?.uniqueName ?? row.internalName,
      row.name,
    );
    return facts ? { parentMastered: facts.status === "mastered" } : {};
  };
}

const RESOLVER_CACHE = new WeakMap<
  Record<string, ItemDbEntry>,
  { mastery: MasteryData | null; resolve: PartMasteryResolver }
>();

/** For per-row callers: building the resolver indexes the whole item database,
 *  which a card list must not repeat per card. */
export function sharedPartMasteryResolver(
  itemDb: Record<string, ItemDbEntry>,
  mastery: MasteryData | null,
): PartMasteryResolver {
  const cached = RESOLVER_CACHE.get(itemDb);
  if (cached && cached.mastery === mastery) return cached.resolve;
  const resolve = buildPartMasteryResolver(itemDb, mastery);
  RESOLVER_CACHE.set(itemDb, { mastery, resolve });
  return resolve;
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
