import { isWfmSlug } from "./textNormalize";

/** One closed-sales row of warframe.market statistics, as the Browse chart plots it. */
export interface MarketStatPoint {
  source: "wfm" | "archive";
  time: number;
  volume: number | null;
  median: number;
  movingAvg: number | null;
  avgPrice: number | null;
  openPrice: number | null;
  closedPrice: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  donchTop: number | null;
  donchBot: number | null;
  rank: number | null;
}

const MARKET_STATS_MAX_DAYS = 365;
/** A year of every mod rank warframe.market reports per day fits well inside this. */
export const MARKET_STATS_MAX_POINTS = 8000;
const DAY_MS = 86_400_000;
const MAX_RANK = 20;
const PRICE_FIELDS = [
  "volume",
  "avgPrice",
  "openPrice",
  "closedPrice",
  "minPrice",
  "maxPrice",
  "donchTop",
  "donchBot",
] as const;

export function isMarketStatsSlug(value: unknown): value is string {
  return typeof value === "string" && value.length <= 120 && isWfmSlug(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function normalizeMarketStatPoint(value: unknown, now: number): MarketStatPoint | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (raw.source !== "wfm" && raw.source !== "archive") return null;
  if (!finite(raw.median) || raw.median < 0) return null;
  if (!finite(raw.time) || raw.time <= 0 || raw.time > now + DAY_MS) return null;
  const rank = raw.rank ?? null;
  if (
    rank !== null &&
    (!Number.isInteger(rank) || (rank as number) < 0 || (rank as number) > MAX_RANK)
  )
    return null;
  const movingAvg = raw.movingAvg ?? null;
  if (movingAvg !== null && !finite(movingAvg)) return null;
  const point: Record<string, number | null> = {};
  for (const key of PRICE_FIELDS) {
    const number = raw[key];
    if (number !== null && (!finite(number) || number < 0)) return null;
    point[key] = number;
  }
  return {
    source: raw.source,
    time: raw.time,
    volume: point.volume,
    median: raw.median,
    movingAvg,
    avgPrice: point.avgPrice,
    openPrice: point.openPrice,
    closedPrice: point.closedPrice,
    minPrice: point.minPrice,
    maxPrice: point.maxPrice,
    donchTop: point.donchTop,
    donchBot: point.donchBot,
    rank: rank as number | null,
  };
}

function marketStatPointKey(point: MarketStatPoint): string {
  return `${new Date(point.time).toISOString().slice(0, 10)}|${point.rank ?? "-"}`;
}

/** "fill" refreshes archive rows and missing days while preserving WFM measurements. */
export type MarketStatsMergeMode = "replace" | "fill";

/** Merges fresh rows into the stored ones; the result keeps a year from its newest day. */
export function mergeMarketStatPoints(
  stored: readonly MarketStatPoint[],
  fresh: readonly MarketStatPoint[],
  mode: MarketStatsMergeMode = "replace",
): MarketStatPoint[] {
  const byKey = new Map<string, MarketStatPoint>();
  for (const point of stored) byKey.set(marketStatPointKey(point), point);
  for (const point of fresh) {
    const key = marketStatPointKey(point);
    if (mode === "fill" && byKey.get(key)?.source === "wfm") continue;
    byKey.set(key, point);
  }
  const merged = [...byKey.values()].sort((a, b) => a.time - b.time);
  const newest = merged[merged.length - 1]?.time ?? 0;
  const kept = merged.filter((point) => point.time >= newest - MARKET_STATS_MAX_DAYS * DAY_MS);
  return kept.length > MARKET_STATS_MAX_POINTS ? kept.slice(-MARKET_STATS_MAX_POINTS) : kept;
}
