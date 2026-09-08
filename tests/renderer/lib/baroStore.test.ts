import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BaroHistory } from "../../../config/shared/baroHistory";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), toast: vi.fn() }));
vi.mock("../../../src/lib/wfm/backendLite", () => ({ fetchBackendBaroHistory: mocks.fetch }));
vi.mock("../../../src/stores/toasts", () => ({ addToast: mocks.toast }));

const name = "/Lotus/Fixture/BaroItem";
const now = 1800000000000;
const history = (updatedAt = now): BaroHistory => ({
  version: 1,
  updatedAt,
  coverageStart: null,
  visits: [],
  lastSeen: [],
});
let storage: Map<string, string>;
let browserWindow: EventTarget;

function storageEvent(key: string | null): void {
  const event = new Event("storage");
  Object.defineProperty(event, "key", { value: key });
  browserWindow.dispatchEvent(event);
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  storage = new Map();
  browserWindow = new EventTarget();
  vi.stubGlobal("window", browserWindow);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  vi.spyOn(Date, "now").mockReturnValue(now);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Baro stores", () => {
  it("throttles explicit refreshes after success without reporting unavailable", async () => {
    const store = await import("../../../src/stores/baro");
    mocks.fetch.mockResolvedValue(history());
    await store.loadBaroHistory();
    await store.loadBaroHistory();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    await store.loadBaroHistory(true);
    await store.loadBaroHistory(true);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(get(store.baroHistoryError)).toBe(false);
    expect(get(store.baroHistoryRetryAt)).toBe(0);
    expect(get(store.baroHistoryRefreshAt)).toBe(now + 30_000);
    vi.mocked(Date.now).mockReturnValue(now + 30_000);
    await store.loadBaroHistory(true);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  it("reports the cap while still allowing edits and removals", async () => {
    const wishes = Object.fromEntries(
      Array.from({ length: 500 }, (_, i) => [`/Lotus/Fixture/${i}`, 1]),
    );
    storage.set("baro-wishlist-v1", JSON.stringify(wishes));
    const store = await import("../../../src/stores/baro");
    expect(get(store.baroWishlistFull)).toBe(true);
    expect(await store.setBaroWishQuantity(name, 1)).toBe(false);
    expect(await store.setBaroWishQuantity("/Lotus/Fixture/0", 2)).toBe(true);
    expect(await store.setBaroWishQuantity("/Lotus/Fixture/1", 0)).toBe(true);
    expect(get(store.baroWishlistFull)).toBe(false);
    expect(await store.setBaroWishQuantity(name, 1)).toBe(true);
  });

  it("serializes two window stores against the latest shared wishlist", async () => {
    let queue = Promise.resolve();
    const request = vi.fn((_key: string, mutation: () => boolean) => {
      const result = queue.then(mutation);
      queue = result.then(() => undefined);
      return result;
    });
    vi.stubGlobal("navigator", { locks: { request } });
    const first = await import("../../../src/stores/baro");
    vi.resetModules();
    const second = await import("../../../src/stores/baro");
    await Promise.all([
      first.setBaroWishQuantity(name, 2),
      second.setBaroWishQuantity("/Lotus/Fixture/Other", 3),
    ]);
    expect(request).toHaveBeenCalledTimes(2);
    expect(JSON.parse(storage.get("baro-wishlist-v1")!)).toEqual({
      [name]: 2,
      "/Lotus/Fixture/Other": 3,
    });
  });

  it("deduplicates history loads and retains the saved snapshot after failure", async () => {
    storage.set("baro-history-v1", JSON.stringify(history(now - 1000)));
    const store = await import("../../../src/stores/baro");
    let finish!: (value: BaroHistory | null) => void;
    mocks.fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = Array.from({ length: 12 }, () => store.loadBaroHistory());
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(get(store.baroHistoryLoading)).toBe(true);
    finish(null);
    await Promise.all(pending);
    expect(get(store.baroHistoryError)).toBe(true);
    expect(get(store.baroHistory)?.updatedAt).toBe(now - 1000);
    await store.loadBaroHistory(true);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    vi.mocked(Date.now).mockReturnValue(now + 61000);
    mocks.fetch.mockResolvedValueOnce(history(now - 2000));
    await store.loadBaroHistory(true);
    expect(get(store.baroHistoryError)).toBe(false);
    expect(get(store.baroHistory)?.updatedAt).toBe(now - 1000);
  });

  it("bounds wishlist quantities and keeps changes across a module reload", async () => {
    const store = await import("../../../src/stores/baro");
    await store.setBaroWishQuantity(name, 1000);
    await store.setBaroWishQuantity("invalid", 1);
    expect(get(store.baroWishlist)).toEqual({ [name]: 99 });
    vi.resetModules();
    const restored = await import("../../../src/stores/baro");
    expect(get(restored.baroWishlist)[name]).toBe(99);
    await restored.setBaroWishQuantity(name, 0);
    expect(JSON.parse(storage.get("baro-wishlist-v1")!)).toEqual({});
  });

  it("merges edits with a newer wishlist saved by another window", async () => {
    const store = await import("../../../src/stores/baro");
    storage.set("baro-wishlist-v1", JSON.stringify({ [name]: 2 }));
    await store.setBaroWishQuantity("/Lotus/Fixture/SecondItem", 1);
    expect(get(store.baroWishlist)).toEqual({ [name]: 2, "/Lotus/Fixture/SecondItem": 1 });
  });

  it("restores and edits canonical wishlist identities without duplicating store aliases", async () => {
    const rawName = name.replace("/Lotus/", "/Lotus/StoreItems/");
    storage.set("baro-wishlist-v1", JSON.stringify({ [rawName]: 3, [name]: 2 }));
    const store = await import("../../../src/stores/baro");
    expect(get(store.baroWishlist)).toEqual({ [name]: 3 });
    await store.setBaroWishQuantity(rawName, 4);
    expect(JSON.parse(storage.get("baro-wishlist-v1")!)).toEqual({ [name]: 4 });
    await store.setBaroWishQuantity(rawName, 0);
    expect(get(store.baroWishlist)).toEqual({});
  });

  it("applies other-window storage events to the main arrival watcher and saved history", async () => {
    const store = await import("../../../src/stores/baro");
    const { worldData } = await import("../../../src/stores/world");
    worldData.set({
      voidTrader: {
        activation: new Date(now - 1000).toISOString(),
        expiry: new Date(now + 100000).toISOString(),
        inventory: [{ uniqueName: name, ducats: 100, credits: 1000 }],
      },
    });
    const stop = store.watchBaroWishlistArrivals();
    try {
      storage.set("baro-wishlist-v1", JSON.stringify({ [name]: 2 }));
      storageEvent("baro-wishlist-v1");
      expect(get(store.baroWishlist)).toEqual({ [name]: 2 });
      expect(mocks.toast).not.toHaveBeenCalled();
      storage.set("baro-wishlist-alerts", "1");
      storageEvent("baro-wishlist-alerts");
      expect(get(store.baroWishlistAlerts)).toBe(true);
      expect(mocks.toast).toHaveBeenCalledTimes(1);
      storageEvent("baro-wishlist-v1");
      storageEvent("baro-wishlist-alerts");
      expect(mocks.toast).toHaveBeenCalledTimes(1);
      storage.set("baro-history-v1", JSON.stringify(history()));
      storageEvent("baro-history-v1");
      expect(get(store.baroHistory)).toEqual(history());
      storage.clear();
      storageEvent(null);
      expect(get(store.baroWishlist)).toEqual({});
      expect(get(store.baroWishlistAlerts)).toBe(false);
      expect(get(store.baroHistory)).toBeNull();
    } finally {
      stop();
    }
  });

  it("notifies only when enabled and once per item and visit across restarts", async () => {
    const store = await import("../../../src/stores/baro");
    const { worldData } = await import("../../../src/stores/world");
    const visit = {
      activation: new Date(now - 1000).toISOString(),
      expiry: new Date(now + 100000).toISOString(),
      inventory: [{ uniqueName: name, ducats: 100, credits: 1000 }],
    };
    await store.setBaroWishQuantity(name, 1);
    const stop = store.watchBaroWishlistArrivals();
    worldData.set({ voidTrader: visit });
    expect(mocks.toast).not.toHaveBeenCalled();
    store.setBaroWishlistAlerts(true);
    expect(mocks.toast).toHaveBeenCalledTimes(1);
    worldData.set({ voidTrader: { ...visit } });
    await store.setBaroWishQuantity(name, 2);
    expect(mocks.toast).toHaveBeenCalledTimes(1);
    stop();
    const stopAgain = store.watchBaroWishlistArrivals();
    expect(mocks.toast).toHaveBeenCalledTimes(1);
    worldData.set({ voidTrader: { ...visit, activation: new Date(now - 500).toISOString() } });
    expect(mocks.toast).toHaveBeenCalledTimes(2);
    worldData.set({ voidTrader: { ...visit, expiry: new Date(now - 1).toISOString() } });
    expect(mocks.toast).toHaveBeenCalledTimes(2);
    stopAgain();
  });
});
