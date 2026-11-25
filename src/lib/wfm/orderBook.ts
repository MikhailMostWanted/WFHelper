import { normalizeWfmSlug } from "../../../config/shared/wfm.js";
import { isCacheEntryFresh, normalizeRank } from "../../../config/shared/numeric.js";
import { WFM_HEADERS } from "../../../config/shared/wfm.js";
import { rendererOrderBookCacheKey } from "../../../config/shared/wfmCacheKeys.js";
import {
  extractWfmOrderList,
  normalizeSubtype,
  normalizeWfmOrderBookSide,
  type WfmOrderBookEntry,
} from "../../../config/shared/wfmOrders.js";
import { fetchWithTimeout } from "../../../config/shared/fetchWithTimeout.js";
import { createPriorityRequestQueue } from "./requestPolicy.js";
import { log } from "../log.js";

export type OrderBookEntry = WfmOrderBookEntry;

export interface ItemOrderBook {
  slug: string;
  sell: OrderBookEntry[];
  buy: OrderBookEntry[];
  timestamp: number;
}

type ItemOrderBookResult =
  | { status: "ok"; data: ItemOrderBook }
  | { status: "not_found"; slug: string }
  | { status: "error"; slug: string; reason?: OrderBookErrorReason };

type OrderBookErrorReason = "access-denied" | "rate-limited";
export function orderBookErrorKey(reason?: OrderBookErrorReason) {
  if (reason === "access-denied") return "orderbook.accessDenied";
  if (reason === "rate-limited") return "orderbook.rateLimited";
  return "common.failedToLoadListingsTryAgain";
}

type EndpointResult =
  | { status: "ok"; orders: unknown[] }
  | { status: "not_found" }
  | { status: "error"; reason?: OrderBookErrorReason };

const ORDERBOOK_TTL_MS = 45_000;
const ORDERBOOK_NO_DATA_TTL_MS = 3 * 60 * 1000;
const DIRECT_ORDER_BOOK_FETCH_TIMEOUT_MS = 10_000;
const orderBookQueue = createPriorityRequestQueue({
  priorities: ["interactive", "background"] as const,
  maxConcurrent: 4,
  maxDepth: Number.MAX_SAFE_INTEGER,
});

interface OrderBookDebugCounters {
  requests: number;
  cacheHitOk: number;
  cacheHitNoData: number;
  httpCalls: number;
  v1FallbackCalls: number;
  resultOk: number;
  resultNoData: number;
  resultError: number;
}

type CacheEntry =
  | { status: "ok"; data: ItemOrderBook; cachedAt: number }
  | { status: "not_found"; cachedAt: number };

const cacheBySlug = new Map<string, CacheEntry>();
const inFlightBySlug = new Map<string, { owner: symbol; promise: Promise<ItemOrderBookResult> }>();
const generationBySlug = new Map<string, number>();
let clearGeneration = 0;

const orderBookDebugCounters: OrderBookDebugCounters = {
  requests: 0,
  cacheHitOk: 0,
  cacheHitNoData: 0,
  httpCalls: 0,
  v1FallbackCalls: 0,
  resultOk: 0,
  resultNoData: 0,
  resultError: 0,
};

function bumpCounter(counter: keyof OrderBookDebugCounters): void {
  orderBookDebugCounters[counter] += 1;
}

function isFresh(entry: CacheEntry): boolean {
  return isCacheEntryFresh(entry, ORDERBOOK_TTL_MS, ORDERBOOK_NO_DATA_TTL_MS, {
    timestampKey: "cachedAt",
  });
}

async function fetchRawOrdersFromEndpoint(url: string): Promise<EndpointResult> {
  bumpCounter("httpCalls");

  try {
    const response = await fetchWithTimeout(url, DIRECT_ORDER_BOOK_FETCH_TIMEOUT_MS, {
      headers: WFM_HEADERS,
    });
    if (response.status === 404) return { status: "not_found" };
    if (response.status === 401 || response.status === 403) {
      return { status: "error", reason: "access-denied" };
    }
    if (response.status === 429) return { status: "error", reason: "rate-limited" };
    if (!response.ok) return { status: "error" };

    const orders = extractWfmOrderList(await response.json());
    return orders ? { status: "ok", orders } : { status: "error" };
  } catch {
    return { status: "error" };
  }
}

async function fetchDirectOrderBook(
  slug: string,
  rank: number | null,
  subtype: string | null,
): Promise<ItemOrderBookResult> {
  let result = await fetchRawOrdersFromEndpoint(
    `https://api.warframe.market/v2/orders/item/${slug}`,
  );
  if (result.status === "not_found") {
    bumpCounter("v1FallbackCalls");
    result = await fetchRawOrdersFromEndpoint(
      `https://api.warframe.market/v1/items/${slug}/orders`,
    );
  }
  if (result.status === "not_found") {
    bumpCounter("resultNoData");
    return { status: "not_found", slug };
  }
  if (result.status === "error") {
    bumpCounter("resultError");
    return { ...result, slug };
  }

  bumpCounter("resultOk");
  if (result.orders.length === 0) log.info(`[OrderBook] No orders returned for ${slug}`);
  return {
    status: "ok",
    data: {
      slug,
      // The browse tab pages the full book locally.
      sell: normalizeWfmOrderBookSide(
        result.orders,
        "sell",
        rank,
        Number.MAX_SAFE_INTEGER,
        subtype,
      ),
      buy: normalizeWfmOrderBookSide(result.orders, "buy", rank, Number.MAX_SAFE_INTEGER, subtype),
      timestamp: Date.now(),
    },
  };
}

export function resetOrderBookDebugCounters(): void {
  for (const key of Object.keys(orderBookDebugCounters) as Array<keyof OrderBookDebugCounters>) {
    orderBookDebugCounters[key] = 0;
  }
}

function subtypedCacheKey(slug: string, rank: number | null, subtype: string | null): string {
  const base = rendererOrderBookCacheKey(slug, rank);
  return subtype ? `${base}:st-${subtype}` : base;
}

export function clearOrderBookCache(
  slug?: string | null,
  rank?: number | null,
  subtype?: string | null,
): void {
  const normalizedSlug = normalizeWfmSlug(slug);
  if (!normalizedSlug) {
    clearGeneration += 1;
    cacheBySlug.clear();
    inFlightBySlug.clear();
    generationBySlug.clear();
    return;
  }

  const normalizedRank = normalizeRank(rank);
  const key = subtypedCacheKey(normalizedSlug, normalizedRank, normalizeSubtype(subtype));
  cacheBySlug.delete(key);
  inFlightBySlug.delete(key);
  generationBySlug.set(key, (generationBySlug.get(key) ?? 0) + 1);
}

export async function fetchItemOrderBookBySlug(
  slug: string | null | undefined,
  options?: {
    rank?: number | null;
    subtype?: string | null;
    priority?: "interactive" | "background";
  },
): Promise<ItemOrderBookResult> {
  const normalizedSlug = normalizeWfmSlug(slug);
  bumpCounter("requests");
  if (!normalizedSlug) {
    bumpCounter("resultError");
    return { status: "error", slug: "" };
  }

  const normalizedRank = normalizeRank(options?.rank ?? null);
  const normalizedSubtype = normalizeSubtype(options?.subtype);
  const key = subtypedCacheKey(normalizedSlug, normalizedRank, normalizedSubtype);

  const cached = cacheBySlug.get(key);
  if (cached && isFresh(cached)) {
    if (cached.status === "ok") {
      bumpCounter("cacheHitOk");
      return { status: "ok", data: cached.data };
    }
    bumpCounter("cacheHitNoData");
    return { status: "not_found", slug: normalizedSlug };
  }

  const inFlight = inFlightBySlug.get(key);
  const priority = options?.priority ?? "interactive";
  if (inFlight) {
    orderBookQueue.promote(inFlight.owner, priority);
    return inFlight.promise;
  }

  const requestClearGeneration = clearGeneration;
  const requestKeyGeneration = generationBySlug.get(key) ?? 0;
  const isCurrentRequest = (): boolean =>
    requestClearGeneration === clearGeneration &&
    requestKeyGeneration === (generationBySlug.get(key) ?? 0);

  const requestOwner = Symbol(key);
  const request = orderBookQueue
    .enqueue(
      async (): Promise<ItemOrderBookResult> => {
        // Cache invalidation must also retire work that has not reached the network.
        if (!isCurrentRequest()) return { status: "error", slug: normalizedSlug };
        const result = await fetchDirectOrderBook(
          normalizedSlug,
          normalizedRank,
          normalizedSubtype,
        );
        if (result.status === "ok") {
          const data: ItemOrderBook = result.data;
          if (isCurrentRequest()) {
            cacheBySlug.set(key, { status: "ok", data, cachedAt: Date.now() });
          }
          return { status: "ok", data };
        }

        if (result.status === "not_found") {
          if (isCurrentRequest()) {
            cacheBySlug.set(key, { status: "not_found", cachedAt: Date.now() });
          }
          return { status: "not_found", slug: normalizedSlug };
        }

        return result;
      },
      priority,
      requestOwner,
    )
    .finally(() => {
      if (inFlightBySlug.get(key)?.owner === requestOwner) inFlightBySlug.delete(key);
    });

  inFlightBySlug.set(key, { owner: requestOwner, promise: request });
  return request;
}
