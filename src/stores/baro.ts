import { derived, get, writable } from "svelte/store";

import { normalizeBaroHistory, type BaroHistory } from "../../config/shared/baroHistory.js";
import { storeItemPath } from "../../config/shared/itemPath.js";
import { readStoredJson, readStorage, writeStorage, persistedBoolean } from "../lib/persistence.js";
import { fetchBackendBaroHistory } from "../lib/wfm/backendLite.js";
import { activeWindow } from "../lib/format.js";
import { tr } from "../lib/i18n.js";
import { worldData } from "./world.js";
import { addToast } from "./toasts.js";

const HISTORY_KEY = "baro-history-v1";
const WISHLIST_KEY = "baro-wishlist-v1";
const CACHE_MS = 60 * 60 * 1000;
const RETRY_MS = 60_000;
const REFRESH_MS = 30_000;

export const baroHistory = writable<BaroHistory | null>(
  readStoredJson(HISTORY_KEY, normalizeBaroHistory, () => null),
);
export const baroHistoryLoading = writable(false);
export const baroHistoryError = writable(false);
export const baroHistoryRetryAt = writable(0);
export const baroHistoryRefreshAt = writable(0);
export const baroLastSeen = derived(
  baroHistory,
  (history) => new Map(history?.lastSeen.map((item) => [item.uniqueName, item.lastSeen])),
);

function normalizeWishlist(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, number> = {};
  for (const [key, quantity] of Object.entries(value).slice(0, 500)) {
    if (
      key.startsWith("/Lotus/") &&
      key.length <= 512 &&
      typeof quantity === "number" &&
      Number.isSafeInteger(quantity) &&
      quantity > 0 &&
      quantity <= 99
    ) {
      const canonical = storeItemPath(key);
      result[canonical] = Math.max(result[canonical] ?? 0, quantity);
    }
  }
  return result;
}

export const baroWishlist = writable<Record<string, number>>(
  readStoredJson(WISHLIST_KEY, normalizeWishlist, () => ({})),
);

export const baroWishlistAlerts = persistedBoolean("baro-wishlist-alerts", false);
export const baroWishlistFull = derived(
  baroWishlist,
  (wishlist) => Object.keys(wishlist).length >= 500,
);

export function setBaroWishlistAlerts(enabled: boolean): void {
  baroWishlistAlerts.set(enabled);
}

export function watchBaroWishlistArrivals(): () => void {
  const saved = readStoredJson(
    "baro-wishlist-seen",
    (value) =>
      Array.isArray(value)
        ? value
            .filter((entry): entry is string => typeof entry === "string" && entry.length <= 600)
            .slice(-2500)
        : [],
    () => [],
  );
  const seen = new Set(saved);
  return derived([worldData, baroWishlist, baroWishlistAlerts], ([world, wishlist, enabled]) => ({
    world,
    wishlist,
    enabled,
  })).subscribe(({ world, wishlist, enabled }) => {
    const visit = world?.voidTrader;
    if (!enabled || !activeWindow(visit?.activation, visit?.expiry, Date.now())) return;
    let count = 0;
    for (const item of visit?.inventory ?? []) {
      const name = item.uniqueName;
      if (!name || !(wishlist[name] > 0)) continue;
      const key = `${visit?.activation}|${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      count += 1;
    }
    if (!count) return;
    while (seen.size > 2500) seen.delete(seen.values().next().value!);
    writeStorage("baro-wishlist-seen", JSON.stringify([...seen]));
    addToast({
      level: "info",
      title: get(tr)("world.baroKiteer"),
      message: get(tr)("baro.wishlistAvailable", { count }),
      durationMs: 12_000,
    });
  });
}

export async function setBaroWishQuantity(uniqueName: string, quantity: number): Promise<boolean> {
  if (!uniqueName.startsWith("/Lotus/") || uniqueName.length > 512 || !Number.isFinite(quantity))
    return false;
  const canonical = storeItemPath(uniqueName);
  const mutate = () => {
    let accepted = false;
    baroWishlist.update((current) => {
      const next = readStoredJson(WISHLIST_KEY, normalizeWishlist, () => ({ ...current }));
      if (quantity <= 0) delete next[canonical];
      else {
        if (!(canonical in next) && Object.keys(next).length >= 500) return next;
        next[canonical] = Math.min(99, Math.max(1, Math.floor(quantity)));
      }
      writeStorage(WISHLIST_KEY, JSON.stringify(next));
      accepted = true;
      return next;
    });
    return accepted;
  };
  return typeof navigator !== "undefined" && navigator.locks
    ? navigator.locks.request("wfhelper:baro-wishlist", mutate)
    : mutate();
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === WISHLIST_KEY || event.key === null) {
      baroWishlist.set(readStoredJson(WISHLIST_KEY, normalizeWishlist, () => ({})));
    }
    if (event.key === "baro-wishlist-alerts" || event.key === null) {
      baroWishlistAlerts.set(readStorage("baro-wishlist-alerts") === "1");
    }
    if (event.key === HISTORY_KEY || event.key === null) {
      baroHistory.set(readStoredJson(HISTORY_KEY, normalizeBaroHistory, () => null));
    }
  });
}

let pending: Promise<void> | null = null;
let nextAttemptAt = 0;
let lastLoadedAt = 0;

export async function loadBaroHistory(force = false): Promise<void> {
  if (pending) return pending;
  if (
    Date.now() < nextAttemptAt ||
    (!force && lastLoadedAt && Date.now() - lastLoadedAt < CACHE_MS)
  )
    return;
  baroHistoryLoading.set(true);
  pending = (async () => {
    try {
      const history = await fetchBackendBaroHistory();
      if (!history) {
        baroHistoryError.set(true);
        baroHistoryRetryAt.set((nextAttemptAt = Date.now() + RETRY_MS));
        return;
      }
      const previous = get(baroHistory);
      // An older edge response must not erase dates already recorded locally.
      if (!previous || history.updatedAt >= previous.updatedAt) {
        baroHistory.set(history);
        writeStorage(HISTORY_KEY, JSON.stringify(history));
      }
      baroHistoryError.set(false);
      baroHistoryRetryAt.set((nextAttemptAt = 0));
      lastLoadedAt = Date.now();
      baroHistoryRefreshAt.set((nextAttemptAt = lastLoadedAt + REFRESH_MS));
    } catch {
      baroHistoryError.set(true);
      baroHistoryRetryAt.set((nextAttemptAt = Date.now() + RETRY_MS));
    } finally {
      baroHistoryLoading.set(false);
      pending = null;
    }
  })();
  return pending;
}
