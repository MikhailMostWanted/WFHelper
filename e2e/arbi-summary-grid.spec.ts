import fs from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

import type { ArbiRunRecord } from "../config/shared/arbiTypes";
import { createArbiParser } from "../services/arbiRunParser";
import {
  closeElectronTestHarness,
  launchElectronTestHarness,
  setLayoutViewport,
  type ElectronTestHarness,
} from "./electronTestHarness";

function recordedRun(): ArbiRunRecord {
  const parser = createArbiParser();
  for (const line of fs
    .readFileSync(path.resolve("tests/fixtures/arbi/stoefler-defense-ee.log"), "utf8")
    .split(/\r?\n/)) {
    if (parser.feedLine(line)?.type === "run-end") break;
  }
  const parsed = parser.finalize();
  if (!parsed?.stats) throw new Error("Recorded defense fixture has no full stats");
  const startedAt = new Date(2026, 8, 8, 12).getTime();
  return {
    ...parsed,
    id: "2026-09-08_12-00-00",
    startedAt,
    endedAt: startedAt + parsed.durationSec * 1000,
    vitusActual: null,
    logFile: null,
    logSizeBytes: 0,
    endReason: "mission-end",
    source: "imported",
  };
}

test("arbitration summary grid wraps with visible dividers and no overflow", async ({
  browserName: _browserName,
}, testInfo) => {
  let harness: ElectronTestHarness | undefined;
  const errors: string[] = [];
  try {
    const run = recordedRun();
    harness = await launchElectronTestHarness("wfh-arbi-summary-", {
      userDataFiles: { "arbi-runs.json": { schemaVersion: 1, runs: [run] } },
      onPage: (page) => {
        page.on("pageerror", (error) => errors.push(error.message));
      },
    });
    const { page } = harness;
    await page.locator('#sidebar [data-view="arbi"]').click();
    await page.locator("#content table tbody tr").first().click();
    const strip = page.locator('[data-summary-strip="grid"]');
    await expect(strip).toBeVisible();
    await expect(strip.locator("[data-summary-item]")).toHaveCount(6);
    await expect(strip.locator('[data-summary-item="drones"]')).toContainText(String(run.drones));
    let wideRows = 0;
    for (const width of [1600, 800]) {
      await setLayoutViewport(page, width, 1000);
      await strip.scrollIntoViewIfNeeded();
      await page.evaluate(() => document.fonts.ready);
      const geometry = await strip.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          left: bounds.left,
          right: bounds.right,
          width: bounds.width,
          overflow: style.overflow,
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          items: Array.from(element.querySelectorAll<HTMLElement>("[data-summary-item]")).map(
            (item) => {
              const box = item.getBoundingClientRect();
              const before = getComputedStyle(item, "::before");
              const after = getComputedStyle(item, "::after");
              return {
                left: box.left,
                right: box.right,
                top: box.top,
                height: box.height,
                scrollWidth: item.scrollWidth,
                clientWidth: item.clientWidth,
                dividerWidth: before.width,
                dividerHeight: before.height,
                dividerColor: before.backgroundColor,
                rowDividerHeight: after.height,
                rowDividerColor: after.backgroundColor,
              };
            },
          ),
        };
      });
      expect(geometry.width).toBeGreaterThan(0);
      expect(geometry.left).toBeGreaterThanOrEqual(0);
      expect(geometry.right).toBeLessThanOrEqual(width + 1);
      expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
      expect(geometry.overflow).toBe("hidden");
      const rows = new Set(geometry.items.map((item) => Math.round(item.top))).size;
      if (width === 1600) wideRows = rows;
      else expect(rows).toBeGreaterThan(wideRows);
      for (const item of geometry.items) {
        expect(item.left).toBeGreaterThanOrEqual(geometry.left - 1);
        expect(item.right).toBeLessThanOrEqual(geometry.right + 1);
        expect(item.scrollWidth).toBeLessThanOrEqual(item.clientWidth + 1);
        expect(item.dividerWidth).toBe("1px");
        expect(parseFloat(item.dividerHeight)).toBeCloseTo(item.height, 0);
        expect(item.dividerColor).not.toBe("rgba(0, 0, 0, 0)");
        expect(item.rowDividerHeight).toBe("1px");
        expect(item.rowDividerColor).not.toBe("rgba(0, 0, 0, 0)");
      }
      await page.screenshot({ path: testInfo.outputPath(`arbi-summary-${width}.png`) });
    }
    expect(errors).toEqual([]);
  } finally {
    await closeElectronTestHarness(harness);
  }
});
