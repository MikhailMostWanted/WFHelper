import fs from "node:fs";
import path from "node:path";

import { test, expect, type Page } from "@playwright/test";

import type { PtRunRecord } from "../config/shared/profitTakerTypes";
import { PT_GET_RUNS } from "../config/shared/ipcChannels";
import { createProfitTakerParser } from "../services/profitTakerParser";
import {
  closeElectronTestHarness,
  evaluateInMain,
  launchElectronTestHarness,
  setDisplayLanguage,
  setLayoutViewport,
  type ElectronTestHarness,
} from "./electronTestHarness";

const METRICS = {
  total: "112.971",
  flight: "11.339",
  shield: "27.250",
  leg: "27.107",
  body: "2.131",
  pylon: "24.573",
} as const;

/** Mirrors formatPtTime, which is what a metric card's value span holds. */
function cardText(seconds: string): string {
  const value = Number(seconds);
  if (value < 60) return seconds;
  return `${Math.floor(value / 60)}:${(value % 60).toFixed(3).padStart(6, "0")}`;
}

function recordedRun(): PtRunRecord {
  const parser = createProfitTakerParser();
  const lines = fs
    .readFileSync(path.resolve("tests/fixtures/pt/host-single-run.log"), "utf8")
    .split(/\r?\n/);
  for (const line of lines) {
    if (parser.feedLine(line)?.type === "run-end") break;
  }
  const parsed = parser.finalize();
  if (!parsed?.complete) throw new Error("Recorded host fixture did not complete");
  const startedAt = new Date(2026, 8, 1, 12).getTime();
  return {
    id: "2026-09-01_12-00-00",
    startedAt,
    endedAt: startedAt + parsed.durationSec * 1000,
    durationSec: parsed.durationSec,
    flightSec: parsed.flightSec,
    shieldSec: parsed.shieldSec,
    legSec: parsed.legSec,
    bodySec: parsed.bodySec,
    pylonSec: parsed.pylonSec,
    phases: parsed.phases,
    // Synthetic names keep comparison grouping independent of the timing fixture.
    players: [...parsed.players, "ClientTwo", "ClientThree"],
    complete: parsed.complete,
    bugged: parsed.bugged,
    aborted: parsed.aborted,
    logFile: null,
    logSizeBytes: 0,
    endReason: "completed",
    source: "imported",
    tags: ["Recorded"],
  };
}

function scaledRun(day: number, factor: number, patch: Partial<PtRunRecord> = {}): PtRunRecord {
  const run = recordedRun();
  const startedAt = new Date(2026, 8, day, 12).getTime();
  return {
    ...run,
    id: `2026-09-${String(day).padStart(2, "0")}_12-00-00`,
    startedAt,
    endedAt: startedAt + run.durationSec * factor * 1000,
    durationSec: run.durationSec * factor,
    flightSec: run.flightSec * factor,
    shieldSec: run.shieldSec * factor,
    legSec: run.legSec * factor,
    bodySec: run.bodySec * factor,
    pylonSec: run.pylonSec * factor,
    phases: run.phases.map((phase) => ({
      ...phase,
      totalSec: phase.totalSec * factor,
      shieldSec: phase.shieldSec * factor,
      legSec: phase.legSec * factor,
      bodySec: phase.bodySec * factor,
      pylonSec: phase.pylonSec * factor,
      shields: phase.shields.map((entry) => ({ ...entry, seconds: entry.seconds * factor })),
      legs: phase.legs.map((entry) => ({ ...entry, seconds: entry.seconds * factor })),
    })),
    tags: [],
    ...patch,
  };
}

const BASE = recordedRun();
BASE.source = "live";
const SLOWER = scaledRun(2, 1.2, { tags: ["Baseline"] });
const PARTIAL = scaledRun(3, 0.8, { players: ["HostPlayer"] });
const UNKNOWN = scaledRun(4, 0.5, { players: [] });
const BUGGED = scaledRun(5, 0.2, { bugged: true });
const MISSING = scaledRun(6, 0.3);
MISSING.phases.splice(2, 1);
const MIGRATED = scaledRun(7, 0.4, { hostMigration: true });
const UNRELIABLE = scaledRun(8, 0.4, { flightUnreliable: true });
const ABORTED = scaledRun(9, 0.4, { complete: false, aborted: true, endReason: "aborted" });
const DUPLICATE: PtRunRecord = {
  ...BASE,
  id: `${BASE.id}-2`,
  source: "imported",
  tags: [],
  duplicateOf: BASE.id,
};
const RUNS = [
  BASE,
  SLOWER,
  PARTIAL,
  UNKNOWN,
  BUGGED,
  MISSING,
  MIGRATED,
  UNRELIABLE,
  ABORTED,
  DUPLICATE,
];

async function openPt(page: Page): Promise<void> {
  await page.locator('#sidebar [data-view="arbi"]').click();
  await page.locator('#content [data-tour-tab="profitTaker"]').click();
}

test.describe("Profit-Taker analytics", () => {
  let harness: ElectronTestHarness | undefined;
  const errors: string[] = [];

  test.afterEach(async () => {
    await closeElectronTestHarness(harness);
    harness = undefined;
  });

  test("compares all recorded player counts and qualifies the roster", async ({
    browserName: _browserName,
  }, testInfo) => {
    const groups = [1, 2, 3, 4].map((count) => {
      const players = ["A", "B", "C", "D"].slice(0, count);
      return {
        count,
        fast: scaledRun(count, 0.8, { players, tags: count === 4 ? ["WithUnknown"] : [] }),
        slow: scaledRun(count + 4, 1, { players, tags: count === 4 ? ["WithUnknown"] : [] }),
      };
    });
    harness = await launchElectronTestHarness("wfh-pt-recorded-counts-", {
      userDataFiles: {
        "pt-runs.json": {
          schemaVersion: 1,
          runs: [
            ...groups.flatMap(({ fast, slow }) => [fast, slow]),
            scaledRun(10, 1, { players: [], tags: ["WithUnknown"] }),
          ],
        },
      },
    });
    const { page } = harness;
    await openPt(page);
    await expect(page.locator("[data-pt-recorded-roster]")).toContainText("before capture");
    for (const { count, fast, slow } of groups) {
      await page
        .locator("[data-pt-filter-squad]")
        .selectOption(count === 1 ? "solo" : String(count));
      await expect(page.locator("[data-pt-run]")).toHaveCount(2);
      await expect(page.locator(`[data-pt-run="${fast.id}"] [data-pt-pb]`)).toBeVisible();
      await expect(page.locator(`[data-pt-run="${slow.id}"] [data-pt-pb]`)).toHaveCount(0);
      await page.locator(`[data-pt-run="${fast.id}"]`).click();
      const options = page.locator('[data-pt-baseline] option:not([value=""])');
      await expect(options).toHaveCount(1);
      await expect(options).toHaveAttribute("value", slow.id);
      await page.locator("[data-pt-baseline]").selectOption(slow.id);
      await expect(page.locator('[data-pt-stat="total"] [data-pt-delta]')).toContainText("-22.594");
      await expect(page.locator("[data-pt-recorded-roster]")).toContainText("before capture");
      if (count === 1) {
        expect(await page.locator("#content").innerText()).not.toMatch(/\bSolo\b/);
        await page.screenshot({
          path: testInfo.outputPath("pt-one-recorded-player.png"),
          fullPage: true,
        });
      }
      await page.locator("[data-pt-detail-back]").click();
    }
    await page.locator("[data-pt-filter-squad]").selectOption("all");
    await page.locator("[data-pt-filter-tag]").selectOption("WithUnknown");
    await page.locator('[data-pt-subtab="analytics"]').click();
    await expect(page.locator("[data-pt-chart-run]")).toHaveCount(3);
    await expect(page.locator("[data-pt-unknown-squad]")).toBeVisible();
    await expect(page.locator("[data-pt-mixed-squads]")).toHaveCount(0);
  });

  test("date filters preserve lifetime PBs and invalid dates remain unavailable", async () => {
    const invalid = { ...BASE, id: "2026-09-04_12-00-00", startedAt: null };
    harness = await launchElectronTestHarness("wfh-pt-pb-filter-", {
      userDataFiles: { "pt-runs.json": { schemaVersion: 1, runs: [BASE, SLOWER, invalid] } },
    });
    const { page } = harness;
    await openPt(page);
    const invalidRow = page.locator(`[data-pt-run="${invalid.id}"]`);
    await expect(invalidRow.locator("td").first()).toHaveText("\u2014");
    await invalidRow.click();
    await expect(page.locator("[data-pt-exclusion]")).toBeVisible();
    expect(await page.locator("#content").innerText()).not.toMatch(/1970|NaN/);
    await page.locator("[data-pt-detail-back]").click();
    await page.locator("[data-pt-filter-from]").fill("2026-09-02");
    await expect(page.locator("[data-pt-run]")).toHaveCount(1);
    await expect(page.locator("[data-pt-pb]")).toHaveCount(0);
    await page.locator(`[data-pt-run="${SLOWER.id}"]`).click();
    await page.locator("[data-pt-baseline]").selectOption(BASE.id);
    await expect(page.locator('[data-pt-stat="total"] [data-pt-delta]')).toContainText("+22.594");
  });

  test("recorded timing cards, phase clocks and same-squad baseline remain exact", async ({
    browserName: _browserName,
  }, testInfo) => {
    errors.length = 0;
    harness = await launchElectronTestHarness("wfh-pt-detail-", {
      userDataFiles: { "pt-runs.json": { schemaVersion: 1, runs: RUNS } },
      onPage: (page) => {
        page.on("pageerror", (error) => errors.push(error.message));
      },
    });
    const { page } = harness;
    await setLayoutViewport(page, 1600, 1000);
    await openPt(page);
    await page.locator(`[data-pt-run="${BASE.id}"]`).click();
    for (const [metric, seconds] of Object.entries(METRICS)) {
      await expect(page.locator(`[data-pt-stat-value="${metric}"]`)).toHaveText(cardText(seconds));
    }
    for (const [index, seconds] of ["51.001", "60.729", "99.922", "112.971"].entries()) {
      await expect(
        page.locator(`[data-pt-phase="${index + 1}"] [data-pt-phase-elapsed]`),
      ).toContainText(seconds);
    }
    for (const [index, seconds] of ["39.662", "9.728", "39.193", "13.049"].entries()) {
      await expect(
        page.locator(`[data-pt-phase="${index + 1}"] [data-pt-phase-duration]`),
      ).toContainText(seconds);
    }
    await expect(page.locator("[data-pt-phase]")).toHaveCount(4);
    await page.screenshot({ path: testInfo.outputPath("pt-recorded-detail.png"), fullPage: true });
    const baseline = page.locator("[data-pt-baseline]");
    const options = await baseline
      .locator("option")
      .evaluateAll((nodes) => nodes.map((node) => (node as HTMLOptionElement).value));
    expect(options.filter(Boolean)).toEqual([SLOWER.id]);
    await baseline.selectOption(SLOWER.id);
    await expect(page.locator('[data-pt-stat="total"] [data-pt-delta]')).toContainText("-22.594");
    await expect(page.locator('[data-pt-stat="total"] [data-pt-delta]')).toContainText("-16.7%");
    await page.screenshot({
      path: testInfo.outputPath("pt-baseline-comparison.png"),
      fullPage: true,
    });
    await page.locator("[data-pt-notes]").fill("Driver note for the recorded run");
    const direction = (await page.locator("[data-pt-prev]").isEnabled()) ? "prev" : "next";
    await page.locator(`[data-pt-${direction}]`).click();
    await expect(page.locator('[data-pt-stat-value="total"]')).not.toHaveText(
      cardText(METRICS.total),
    );
    await page.locator(`[data-pt-${direction === "prev" ? "next" : "prev"}]`).click();
    await expect(page.locator('[data-pt-stat-value="total"]')).toHaveText(cardText(METRICS.total));
    await expect(page.locator("[data-pt-notes]")).toHaveValue("Driver note for the recorded run");
    await setDisplayLanguage(page, "de");
    await openPt(page);
    await page.locator(`[data-pt-run="${BASE.id}"]`).click();
    await setLayoutViewport(page, 1100, 800);
    await expect(page.locator("[data-pt-stat]")).toHaveCount(6);
    await expect(page.locator('[data-pt-phase="4"] [data-pt-phase-elapsed]')).toHaveText("112.971");
    await expect(page.locator("[data-pt-notes]")).toHaveValue("Driver note for the recorded run");
    expect(await page.locator("#content").innerText()).not.toMatch(
      /pt\.(phase|comparison|metric)\./,
    );
    await page.screenshot({
      path: testInfo.outputPath("pt-detail-german-1100.png"),
      fullPage: true,
    });
    expect(errors).toEqual([]);
  });

  test("eligible filtered means, chart navigation and exclusions use one pool", async ({
    browserName: _browserName,
  }, testInfo) => {
    errors.length = 0;
    harness = await launchElectronTestHarness("wfh-pt-analytics-", {
      userDataFiles: { "pt-runs.json": { schemaVersion: 1, runs: RUNS } },
      onPage: (page) => {
        page.on("pageerror", (error) => errors.push(error.message));
      },
    });
    const { page } = harness;
    await setLayoutViewport(page, 1600, 1000);
    await openPt(page);
    await expect(page.locator("[data-pt-run]")).toHaveCount(9);
    await expect(page.locator(`[data-pt-run="${BASE.id}"] [data-pt-pb]`)).toBeVisible();
    await expect(page.locator(`[data-pt-run="${PARTIAL.id}"] [data-pt-pb]`)).toBeVisible();
    await expect(page.locator("[data-pt-recorded-roster]")).toBeVisible();
    for (const run of [UNKNOWN, BUGGED, MISSING, MIGRATED, UNRELIABLE, ABORTED]) {
      await expect(page.locator(`[data-pt-run="${run.id}"] [data-pt-pb]`)).toHaveCount(0);
    }
    await expect(page.locator(`[data-pt-run="${BUGGED.id}"] [data-pt-bugged]`)).toBeVisible();
    await page.locator("[data-pt-show-duplicates]").check();
    await expect(page.locator("[data-pt-run]")).toHaveCount(10);
    await expect(page.locator(`[data-pt-run="${DUPLICATE.id}"] [data-pt-duplicate]`)).toBeVisible();
    await expect(page.locator(`[data-pt-run="${DUPLICATE.id}"] [data-pt-pb]`)).toHaveCount(0);
    await page.locator("[data-pt-show-duplicates]").uncheck();
    await page.locator("[data-pt-filter-tag]").selectOption("Recorded");
    await expect(page.locator("[data-pt-run]")).toHaveCount(1);
    await page.locator("[data-pt-filter-tag]").selectOption("");
    await page.locator('[data-pt-subtab="analytics"]').click();
    for (const [metric, seconds] of Object.entries(METRICS)) {
      await expect(page.locator(`[data-pt-mean="${metric}"]`)).toHaveText(
        cardText((Number(seconds) * 0.875).toFixed(3)),
      );
    }
    await expect(page.locator("[data-pt-unknown-squad]")).toBeVisible();
    await expect(page.locator("[data-pt-analytics-scope]")).toHaveAttribute(
      "data-pt-eligible-count",
      "4",
    );
    await expect(page.locator("[data-pt-analytics-scope]")).toHaveAttribute(
      "data-pt-excluded-count",
      "5",
    );
    const firstPoint = page.locator(`[data-pt-chart-run="${BASE.id}"]`);
    await expect(firstPoint.locator("[data-pt-chart-point]")).toHaveCount(6);
    for (const metric of Object.keys(METRICS)) {
      const toggle = page.locator(`[data-pt-chart-metric="${metric}"]`);
      await expect(toggle).toHaveAttribute("aria-pressed", "true");
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-pressed", "false");
      await expect(page.locator(`[data-pt-chart-series="${metric}"]`)).toHaveCount(0);
      await toggle.click();
    }
    await page.screenshot({
      path: testInfo.outputPath("pt-analytics-combined.png"),
      fullPage: true,
    });
    await page.locator("[data-pt-filter-squad]").selectOption("4");
    for (const [metric, seconds] of Object.entries(METRICS)) {
      const expected = (Number(seconds) * 1.1).toFixed(3);
      await expect(page.locator(`[data-pt-mean="${metric}"]`)).toHaveText(cardText(expected));
    }
    await page.locator("[data-pt-filter-from]").fill("2026-09-02");
    await page.locator("[data-pt-filter-to]").fill("2026-09-02");
    await expect(page.locator('[data-pt-mean="total"]')).toHaveText(cardText("135.565"));
    await expect(page.locator(`[data-pt-chart-run="${BASE.id}"]`)).toHaveCount(0);
    const point = page.locator(`[data-pt-chart-run="${SLOWER.id}"]`).first();
    await expect(point).toBeVisible();
    await point.focus();
    await point.press("Enter");
    await expect(page.locator('[data-pt-stat-value="total"]')).toHaveText(cardText("135.565"));
    await expect(page.locator(`[data-pt-baseline] option[value="${BASE.id}"]`)).toHaveCount(1);
    await page.locator("[data-pt-detail-back]").click();
    await expect(page.locator("[data-pt-analytics-scope]")).toBeVisible();
    await page.locator("[data-pt-filter-from]").fill("");
    await page.locator("[data-pt-filter-to]").fill("");
    await page.locator("[data-pt-filter-squad]").selectOption("solo");
    await expect(page.locator('[data-pt-mean="total"]')).toHaveText(cardText("90.377"));
    await expect(page.locator("[data-pt-chart-run]")).toHaveCount(1);
    await page.locator("[data-pt-filter-squad]").selectOption("unknown");
    await expect(page.locator('[data-pt-mean="total"]')).toHaveText(
      cardText(UNKNOWN.durationSec.toFixed(3)),
    );
    await expect(page.locator("[data-pt-chart-run]")).toHaveCount(1);
    await expect(page.locator("[data-pt-unknown-squad]")).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("pt-analytics-unknown-squad.png"),
      fullPage: true,
    });
    await page.locator('[data-pt-subtab="runs"]').click();
    await expect(page.locator("[data-pt-run]")).toHaveCount(1);
    await page.locator(`[data-pt-run="${UNKNOWN.id}"]`).click();
    await expect(page.locator("[data-pt-exclusion]")).toBeVisible();
    await expect(page.locator("[data-pt-baseline]")).toHaveCount(0);
    await page.locator("[data-pt-detail-back]").click();
    await page.locator("[data-pt-filter-squad]").selectOption("all");
    await page.locator("[data-pt-filter-status]").selectOption("bugged");
    await expect(page.locator("[data-pt-run]")).toHaveCount(1);
    await page.locator(`[data-pt-run="${BUGGED.id}"]`).click();
    await expect(page.locator("[data-pt-exclusion]")).toBeVisible();
    await expect(page.locator("[data-pt-baseline]")).toHaveCount(0);
    await expect(page.locator('[data-pt-phase="3"] [data-pt-phase-pylon]')).not.toHaveText(/\d/);
    await expect(page.locator('[data-pt-stat-value="pylon"]')).toHaveText("—");
    await expect(page.locator('[data-pt-stat="pylon"]')).not.toHaveText(/—\s*s/);
    await page.screenshot({ path: testInfo.outputPath("pt-bugged-detail.png"), fullPage: true });
    await page.locator("[data-pt-detail-back]").click();
    await page.locator("[data-pt-filter-status]").selectOption("all");
    await page.locator(`[data-pt-run="${MISSING.id}"]`).click();
    await expect(page.locator("[data-pt-exclusion]")).toBeVisible();
    await expect(page.locator("[data-pt-baseline]")).toHaveCount(0);
    await expect(page.locator('[data-pt-phase="3"] [data-pt-phase-duration]')).not.toHaveText(/\d/);
    await page.locator("[data-pt-detail-back]").click();
    await page.locator("[data-pt-filter-status]").selectOption("eligible");
    await expect(page.locator("[data-pt-run]")).toHaveCount(4);
    await page.locator('[data-pt-subtab="analytics"]').click();
    await page.locator('#sidebar [data-view="inventory"]').click();
    await page.locator('#sidebar [data-view="arbi"]').click();
    await expect(page.locator("[data-pt-analytics-scope]")).toBeVisible();
    await setLayoutViewport(page, 1100, 800);
    await expect(page.locator("[data-pt-chart-run]")).toHaveCount(4);
    const chart = page.locator('[data-pt-analytics] svg[role="group"]');
    const bounds = await chart.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(1100);
    await page.locator(`[data-pt-chart-run="${BASE.id}"] [data-pt-chart-point="total"]`).click();
    await expect(page.locator('[data-pt-stat-value="total"]')).toHaveText(cardText(METRICS.total));
    expect(await page.locator("#content").innerText()).not.toMatch(/NaN|Infinity/);
    expect(errors).toEqual([]);
  });

  test("an empty index offers analytics without invalid numbers", async ({
    browserName: _browserName,
  }, testInfo) => {
    errors.length = 0;
    harness = await launchElectronTestHarness("wfh-pt-empty-", {
      userDataFiles: { "pt-runs.json": { schemaVersion: 1, runs: [] } },
      onPage: (page) => {
        page.on("pageerror", (error) => errors.push(error.message));
      },
    });
    const { page } = harness;
    await setLayoutViewport(page, 1600, 1000);
    await openPt(page);
    await page.locator('[data-pt-subtab="analytics"]').click();
    await expect(page.locator("[data-pt-analytics-empty]")).toBeVisible();
    await expect(page.locator("[data-pt-chart-run]")).toHaveCount(0);
    expect(await page.locator("#content").innerText()).not.toMatch(/NaN|Infinity/);
    await page.screenshot({ path: testInfo.outputPath("pt-analytics-empty.png"), fullPage: true });
    expect(errors).toEqual([]);
  });

  test("persisted analytics waits for the initial run response before showing empty", async () => {
    harness = await launchElectronTestHarness("wfh-pt-loading-", {
      storage: { "pt-subtab": "analytics" },
      userDataFiles: { "pt-runs.json": { schemaVersion: 1, runs: [] } },
    });
    await evaluateInMain(
      harness.app,
      ({ ipcMain }, channel) => {
        const state = globalThis as unknown as {
          ptDriverPending?: boolean;
          ptDriverRelease?: () => void;
        };
        ipcMain.removeHandler(channel);
        ipcMain.handle(channel, async () => {
          state.ptDriverPending = true;
          await new Promise<void>((resolve) => {
            state.ptDriverRelease = resolve;
          });
          return { runs: [], diskUsageBytes: 0 };
        });
      },
      PT_GET_RUNS,
    );
    const { page } = harness;
    await openPt(page);
    await expect
      .poll(() =>
        evaluateInMain(
          harness!.app,
          () => (globalThis as unknown as { ptDriverPending?: boolean }).ptDriverPending,
        ),
      )
      .toBe(true);
    await expect(page.locator('[data-pt-subtab="analytics"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.locator("[data-pt-analytics-empty]")).toHaveCount(0);
    await expect(page.locator("[data-pt-analytics-scope]")).toHaveCount(0);
    await evaluateInMain(harness.app, () => {
      (globalThis as unknown as { ptDriverRelease?: () => void }).ptDriverRelease?.();
    });
    await expect(page.locator("[data-pt-analytics-empty]")).toBeVisible();
  });
});
