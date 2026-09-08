import fs from "node:fs";
import path from "node:path";

import { createJsonCache } from "./jsonCache";
import { withScope } from "./logger";
import { userDataPath } from "./userDataPath";
import {
  isMarketStatsSlug,
  MARKET_STATS_MAX_POINTS,
  mergeMarketStatPoints,
  normalizeMarketStatPoint,
  type MarketStatPoint,
  type MarketStatsMergeMode,
} from "../config/shared/marketStats";

const log = withScope("MarketStatsHistory");
const DIRECTORY = "market-stats";

interface StoredMarketStats {
  v: 2;
  points: MarketStatPoint[];
}

function revive(now: number): (parsed: unknown) => StoredMarketStats | null {
  return (parsed) => {
    if (!parsed || typeof parsed !== "object") return null;
    const raw = parsed as Record<string, unknown>;
    if (raw.v !== 2 || !Array.isArray(raw.points)) return null;
    const points: MarketStatPoint[] = [];
    for (const entry of raw.points.slice(0, MARKET_STATS_MAX_POINTS)) {
      const point = normalizeMarketStatPoint(entry, now);
      if (point) points.push(point);
    }
    return { v: 2, points };
  };
}

/** Merges daily history on disk; "fill" preserves WFM rows when the archive refreshes. */
export function mergeMarketStatsHistory(
  slug: unknown,
  incoming: unknown,
  mode: unknown = "replace",
  now = Date.now(),
): MarketStatPoint[] | null {
  if (!isMarketStatsSlug(slug) || !Array.isArray(incoming)) return null;
  if (incoming.length > MARKET_STATS_MAX_POINTS) return null;
  const fresh: MarketStatPoint[] = [];
  for (const entry of incoming) {
    const point = normalizeMarketStatPoint(entry, now);
    if (point) fresh.push(point);
  }
  const merge: MarketStatsMergeMode = mode === "fill" ? "fill" : "replace";
  const cache = createJsonCache(path.join(DIRECTORY, `${slug}.json`), revive(now));
  const merged = mergeMarketStatPoints(cache.read()?.points ?? [], fresh, merge);
  if (fresh.length > 0) {
    try {
      fs.mkdirSync(userDataPath(DIRECTORY), { recursive: true });
      cache.write({ v: 2, points: merged });
    } catch (error) {
      log.warn("Could not persist market statistics:", error);
    }
  }
  return merged;
}
