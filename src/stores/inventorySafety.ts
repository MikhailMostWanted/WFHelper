import { derived, get, writable, type Readable } from "svelte/store";
import { aggregateComponentOwnership } from "../../config/shared/componentOwnership.js";
import { withoutFoundryPending } from "../../config/shared/foundryPending.js";
import { foundryBuildProducts } from "../lib/inventory/foundryResources.js";
import {
  safeToList,
  type InventorySafetySettings,
  type SafetyContext,
  type SafetyRuleId,
  type SafetyVerdict,
  type SafetyVerdictLookup,
  DEFAULT_SAFETY_SETTINGS,
  normalizeSafetySettings,
} from "../lib/inventory/safetyRules.js";
import { readStoredJson, writeStorage } from "../lib/persistence.js";
import { buildSelectionSafetyContext, selectionKeyFor } from "../lib/tradeWorkbench/queueModel.js";
import { foundryData, inventoryData, itemDb, parsedItems } from "./data.js";
import { masteryData } from "./mastery.js";
import { masteryPins } from "./masteryPins.js";
import type {
  FoundryData,
  InventoryGroup,
  ItemDbEntry,
  ParsedItem,
  RawInventoryData,
} from "../types/inventory.js";

const STORAGE_KEY = "inventory.safety";

/** One blob rather than four keys: the rules are read together on every row,
 *  and a half-written pair of keys would reserve the wrong counts. */
function load(): InventorySafetySettings {
  return readStoredJson(STORAGE_KEY, normalizeSafetySettings, () => DEFAULT_SAFETY_SETTINGS);
}

const store = writable<InventorySafetySettings>(load());

function commit(next: InventorySafetySettings): void {
  const normalized = normalizeSafetySettings(next);
  writeStorage(STORAGE_KEY, JSON.stringify(normalized));
  store.set(normalized);
}

function edit(fn: (current: InventorySafetySettings) => InventorySafetySettings): void {
  commit(fn(get(store)));
}

/** Locks, spares and set-keep flags behind `safeToList`. Read-only: every write
 *  goes through the helpers below so the persisted blob stays normalized. */
export const inventorySafety: Readable<InventorySafetySettings> = { subscribe: store.subscribe };

export function setSpareDefault(count: number): void {
  edit((current) => ({ ...current, spareDefault: count }));
}

/** `null` drops the override so the row falls back to the global default. */
export function setItemSpare(key: string, count: number | null): void {
  if (!key) return;
  edit((current) => {
    const spares = { ...current.spares };
    if (count == null) delete spares[key];
    else spares[key] = count;
    return { ...current, spares };
  });
}

export function toggleSafetyLock(key: string): void {
  if (!key) return;
  edit((current) => ({
    ...current,
    locks: current.locks.includes(key)
      ? current.locks.filter((entry) => entry !== key)
      : [...current.locks, key],
  }));
}

/** Keyed by set ROOT uniqueName, so pass `setRootOf(item.internalName)`. */
export function toggleSetKeep(rootUniqueName: string): void {
  if (!rootUniqueName) return;
  edit((current) => ({
    ...current,
    setKeep: current.setKeep.includes(rootUniqueName)
      ? current.setKeep.filter((entry) => entry !== rootUniqueName)
      : [...current.setKeep, rootUniqueName],
  }));
}

export function resetInventorySafety(): void {
  commit(DEFAULT_SAFETY_SETTINGS);
}

let ownershipInventory: RawInventoryData | null = null;
let ownershipDb: Record<string, ItemDbEntry> | null = null;
let ownershipCounts: ReadonlyMap<string, number> = new Map();

/** The engine's own ownership, always without foundry-spent blueprints; the
 *  `componentOwnership` store follows a user preference instead. */
function engineOwnership(
  inventory: RawInventoryData | null,
  db: Record<string, ItemDbEntry>,
): ReadonlyMap<string, number> {
  if (inventory === ownershipInventory && db === ownershipDb) return ownershipCounts;
  ownershipInventory = inventory;
  ownershipDb = db;
  ownershipCounts = inventory
    ? aggregateComponentOwnership(
        withoutFoundryPending(
          inventory,
          (uniqueName) => db[uniqueName]?.reusableBlueprint === true,
        ),
      )
    : new Map();
  return ownershipCounts;
}

let buildingSource: FoundryData | null = null;
let buildingProducts: ReadonlySet<string> = new Set();

/** Identity-cached: a fresh set per emit would rebuild the whole recipe walk. */
function foundryBuilds(foundry: FoundryData): ReadonlySet<string> {
  if (foundry === buildingSource) return buildingProducts;
  buildingSource = foundry;
  buildingProducts = foundryBuildProducts(foundry);
  return buildingProducts;
}

/** Built once per inventory/mastery/settings generation; carries the recipe
 *  rule's parent index. */
export const inventorySafetyContext: Readable<SafetyContext> = derived(
  [itemDb, store, masteryData, masteryPins, inventoryData, foundryData],
  ([$itemDb, $settings, $mastery, $pins, $inventory, $foundry]) =>
    buildSelectionSafetyContext({
      itemDb: $itemDb,
      settings: $settings,
      mastery: $mastery,
      pins: $pins,
      ownership: engineOwnership($inventory, $itemDb),
      buildingUniqueNames: foundryBuilds($foundry),
    }),
);

/** Inventory row key -> verdict, keyed like the selection set. Verdicts are
 *  computed on first read, so a settings keystroke costs only the visible rows. */
export const inventorySafetyVerdicts: Readable<SafetyVerdictLookup> = derived(
  [parsedItems, inventorySafetyContext],
  ([$items, $context]) => {
    const rows = new Map<string, ParsedItem>();
    for (const item of $items) rows.set(selectionKeyFor(item), item);
    const verdicts = new Map<string, SafetyVerdict>();
    return {
      get(key: string): SafetyVerdict | undefined {
        const cached = verdicts.get(key);
        if (cached) return cached;
        const item = rows.get(key);
        if (!item) return undefined;
        const verdict = safeToList(item, $context);
        verdicts.set(key, verdict);
        return verdict;
      },
    };
  },
);

/** Null for an item that is not an inventory row, such as one the detail modal
 *  built from the item database; the engine has no copies to judge there. */
export function verdictFor(item: ParsedItem, verdicts: SafetyVerdictLookup): SafetyVerdict | null {
  return verdicts.get(selectionKeyFor(item)) ?? null;
}

const ENGINE_ONLY_RULES: ReadonlySet<SafetyRuleId> = new Set(["built", "lastCopy", "equipped"]);

/** Ranked gear is bound by the game, so a badge that only says so would read
 *  `x1 (0)` on every equipment card; a lock, pin or recipe claim still shows. */
export function showsSafetyBadge(
  item: { tradable?: boolean; inventoryGroup?: InventoryGroup },
  verdict: SafetyVerdict | null | undefined,
): boolean {
  if (item.tradable !== true || verdict == null || verdict.reserved <= 0) return false;
  if (item.inventoryGroup !== "equipment") return true;
  const rules = verdict.reservations.map((entry) => entry.rule);
  return !(rules.includes("built") && rules.every((rule) => ENGINE_ONLY_RULES.has(rule)));
}
