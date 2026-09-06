import { derived, get, writable, type Readable } from "svelte/store";
import {
  safeToList,
  type InventorySafetySettings,
  type SafetyContext,
  type SafetyVerdict,
  DEFAULT_SAFETY_SETTINGS,
  normalizeSafetySettings,
} from "../lib/inventory/safetyRules.js";
import { readStoredJson, writeStorage } from "../lib/persistence.js";
import { buildSelectionSafetyContext, selectionKeyFor } from "../lib/tradeWorkbench/queueModel.js";
import { componentOwnership, itemDb, parsedItems } from "./data.js";
import { masteryData } from "./mastery.js";
import { masteryPins } from "./masteryPins.js";

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

/** The one context every consumer reads: the parent index behind the recipe
 *  rule is built here, once per inventory/mastery/settings generation. */
export const inventorySafetyContext: Readable<SafetyContext> = derived(
  [itemDb, store, masteryData, masteryPins, componentOwnership],
  ([$itemDb, $settings, $mastery, $pins, $ownership]) =>
    buildSelectionSafetyContext({
      itemDb: $itemDb,
      settings: $settings,
      mastery: $mastery,
      pins: $pins,
      ownership: $ownership,
    }),
);

/** Inventory row key -> verdict, so a grid of a thousand cards looks its answer
 *  up instead of re-running the engine per card. Keyed like the selection set. */
export const inventorySafetyVerdicts: Readable<ReadonlyMap<string, SafetyVerdict>> = derived(
  [parsedItems, inventorySafetyContext],
  ([$items, $context]) => {
    const verdicts = new Map<string, SafetyVerdict>();
    for (const item of $items) verdicts.set(selectionKeyFor(item), safeToList(item, $context));
    return verdicts;
  },
);
