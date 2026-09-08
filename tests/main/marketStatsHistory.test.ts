import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MARKET_STATS_MAX_POINTS,
  mergeMarketStatPoints,
  normalizeMarketStatPoint,
  type MarketStatPoint,
} from "../../config/shared/marketStats";

const mocks = vi.hoisted(() => ({ directory: "" }));

vi.mock("../../services/userDataPath", () => ({
  userDataPath: (...segments: string[]) => path.join(mocks.directory, ...segments),
}));

import { mergeMarketStatsHistory } from "../../services/marketStatsHistory";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 8, 12);

function point(daysAgo: number, median: number, rank: number | null = null): MarketStatPoint {
  return {
    source: "wfm",
    time: Date.UTC(2026, 8, 8) - daysAgo * DAY,
    volume: 10,
    median,
    movingAvg: null,
    avgPrice: median,
    openPrice: median,
    closedPrice: median,
    minPrice: median,
    maxPrice: median,
    donchTop: median,
    donchBot: median,
    rank,
  };
}

function storedFile(slug: string): string {
  return path.join(mocks.directory, "market-stats", `${slug}.json`);
}

describe("mergeMarketStatPoints", () => {
  it("lets a fresh row replace the stored row of the same day and rank", () => {
    const merged = mergeMarketStatPoints([point(1, 10), point(1, 11, 3)], [point(1, 20)]);
    expect(merged.map((entry) => [entry.rank, entry.median])).toEqual([
      [null, 20],
      [3, 11],
    ]);
  });

  it("keeps one year measured from the newest row", () => {
    const merged = mergeMarketStatPoints(
      [point(400, 1), point(366, 2), point(365, 3)],
      [point(0, 4)],
    );
    expect(merged.map((entry) => entry.median)).toEqual([3, 4]);
  });

  it("keeps every rank of every day inside the year under the row cap", () => {
    const stored = Array.from({ length: 400 * 21 }, (_, index) =>
      point(Math.floor(index / 21), index, index % 21),
    );
    const merged = mergeMarketStatPoints(stored, []);
    expect(merged).toHaveLength(366 * 21);
    expect(merged.length).toBeLessThan(MARKET_STATS_MAX_POINTS);
  });

  it("adds only the days a fill misses and never overwrites a stored one", () => {
    const merged = mergeMarketStatPoints(
      [point(1, 10), point(1, 11, 3)],
      [point(1, 20), point(1, 21, 3), point(2, 30)],
      "fill",
    );
    expect(merged.map((entry) => [entry.rank, entry.median])).toEqual([
      [null, 30],
      [null, 10],
      [3, 11],
    ]);
  });
});

describe("normalizeMarketStatPoint", () => {
  it("rejects rows from the future, negative prices and out-of-range ranks", () => {
    expect(normalizeMarketStatPoint({ ...point(0, 5), time: NOW + 2 * DAY }, NOW)).toBeNull();
    expect(normalizeMarketStatPoint({ ...point(0, 5), median: -1 }, NOW)).toBeNull();
    expect(normalizeMarketStatPoint({ ...point(0, 5), rank: 21 }, NOW)).toBeNull();
    expect(normalizeMarketStatPoint({ ...point(0, 5), rank: 1.5 }, NOW)).toBeNull();
    expect(normalizeMarketStatPoint("row", NOW)).toBeNull();
  });

  it("accepts a plain row and drops unknown fields", () => {
    const normalized = normalizeMarketStatPoint({ ...point(2, 7, 0), extra: true }, NOW);
    expect(normalized).toEqual(point(2, 7, 0));
  });
});

describe("mergeMarketStatsHistory", () => {
  beforeEach(() => {
    mocks.directory = fs.mkdtempSync(path.join(os.tmpdir(), "wfhelper-market-stats-"));
  });

  afterEach(() => {
    fs.rmSync(mocks.directory, { recursive: true, force: true });
  });

  it("persists the merged year and grows it across fetches", () => {
    const first = mergeMarketStatsHistory(
      "braton_prime_barrel",
      [point(2, 5), point(1, 6)],
      "replace",
      NOW,
    );
    expect(first?.map((entry) => entry.median)).toEqual([5, 6]);
    expect(fs.existsSync(storedFile("braton_prime_barrel"))).toBe(true);

    const second = mergeMarketStatsHistory(
      "braton_prime_barrel",
      [point(1, 7), point(0, 8)],
      "replace",
      NOW,
    );
    expect(second?.map((entry) => entry.median)).toEqual([5, 7, 8]);
  });

  it("refuses a slug that is not a warframe.market slug and writes nothing", () => {
    expect(mergeMarketStatsHistory("../secrets", [point(0, 1)], "replace", NOW)).toBeNull();
    expect(mergeMarketStatsHistory("Braton Prime", [point(0, 1)], "replace", NOW)).toBeNull();
    expect(fs.existsSync(path.join(mocks.directory, "market-stats"))).toBe(false);
  });

  it("drops invalid rows and treats a corrupt file as empty", () => {
    fs.mkdirSync(path.join(mocks.directory, "market-stats"), { recursive: true });
    fs.writeFileSync(storedFile("forma"), "{not json");
    const merged = mergeMarketStatsHistory(
      "forma",
      [point(0, 3), { time: "x" }, null],
      "replace",
      NOW,
    );
    expect(merged?.map((entry) => entry.median)).toEqual([3]);
    expect(JSON.parse(fs.readFileSync(storedFile("forma"), "utf8")).points).toHaveLength(1);
  });

  it("fills the days the stored year lacks and leaves the days it holds alone", () => {
    mergeMarketStatsHistory("forma", [point(1, 5), point(0, 6)], "replace", NOW);

    const filled = mergeMarketStatsHistory(
      "forma",
      [point(2, 90), point(1, 91), point(0, 92)],
      "fill",
      NOW,
    );

    expect(filled?.map((entry) => entry.median)).toEqual([90, 5, 6]);
    expect(
      JSON.parse(fs.readFileSync(storedFile("forma"), "utf8")).points.map(
        (entry: MarketStatPoint) => entry.median,
      ),
    ).toEqual([90, 5, 6]);
  });

  it("refreshes archived rows without replacing WFM measurements and drops the old cache schema", () => {
    const archived: MarketStatPoint = {
      ...point(2, 10),
      source: "archive",
      volume: null,
      movingAvg: null,
      avgPrice: null,
      openPrice: null,
      closedPrice: null,
      minPrice: null,
      maxPrice: null,
      donchTop: null,
      donchBot: null,
    };
    fs.mkdirSync(path.join(mocks.directory, "market-stats"), { recursive: true });
    fs.writeFileSync(storedFile("forma"), JSON.stringify({ v: 1, points: [point(3, 99)] }));
    expect(mergeMarketStatsHistory("forma", [archived, point(1, 20)], "fill", NOW)).toEqual([
      archived,
      point(1, 20),
    ]);
    const refreshed = { ...archived, volume: 5 };
    expect(
      mergeMarketStatsHistory(
        "forma",
        [refreshed, { ...point(1, 999), source: "archive" }],
        "fill",
        NOW,
      ),
    ).toEqual([refreshed, point(1, 20)]);
  });

  it("treats an unknown mode as a replace", () => {
    mergeMarketStatsHistory("forma", [point(0, 5)], "replace", NOW);
    const merged = mergeMarketStatsHistory("forma", [point(0, 6)], "overwrite", NOW);
    expect(merged?.map((entry) => entry.median)).toEqual([6]);
  });

  it("returns the stored year without writing when the fetch carried no rows", () => {
    mergeMarketStatsHistory("forma", [point(0, 3)], "replace", NOW);
    const before = fs.statSync(storedFile("forma")).mtimeMs;
    const merged = mergeMarketStatsHistory("forma", [], "replace", NOW);
    expect(merged?.map((entry) => entry.median)).toEqual([3]);
    expect(fs.statSync(storedFile("forma")).mtimeMs).toBe(before);
  });
});

describe("mergeMarketStatsHistory limits", () => {
  beforeEach(() => {
    mocks.directory = fs.mkdtempSync(path.join(os.tmpdir(), "wfhelper-market-limits-"));
  });

  afterEach(() => {
    fs.rmSync(mocks.directory, { recursive: true, force: true });
  });

  it("refuses an oversized batch and writes nothing", () => {
    const batch = Array.from({ length: MARKET_STATS_MAX_POINTS + 1 }, () => point(0, 1));
    expect(mergeMarketStatsHistory("forma", batch, "replace", NOW)).toBeNull();
    expect(fs.existsSync(storedFile("forma"))).toBe(false);
  });

  it("keeps the stored year untouched when every incoming row is invalid", () => {
    mergeMarketStatsHistory("forma", [point(0, 3)], "replace", NOW);
    const before = fs.statSync(storedFile("forma")).mtimeMs;
    const merged = mergeMarketStatsHistory(
      "forma",
      [{ time: NOW + 3 * DAY }, "row"],
      "replace",
      NOW,
    );
    expect(merged?.map((entry) => entry.median)).toEqual([3]);
    expect(fs.statSync(storedFile("forma")).mtimeMs).toBe(before);
  });

  it("accepts the rank boundaries and a finite moving average", () => {
    expect(normalizeMarketStatPoint(point(0, 5, 0), NOW)?.rank).toBe(0);
    expect(normalizeMarketStatPoint(point(0, 5, 20), NOW)?.rank).toBe(20);
    expect(normalizeMarketStatPoint({ ...point(0, 5), movingAvg: "x" }, NOW)).toBeNull();
    expect(normalizeMarketStatPoint({ ...point(0, 5), movingAvg: 4.5 }, NOW)?.movingAvg).toBe(4.5);
  });
});
