import fs from "node:fs";
import path from "node:path";

import { test, expect } from "@playwright/test";

import {
  closeElectronTestHarness,
  launchElectronTestHarness,
  type ElectronTestHarness,
} from "./electronTestHarness";

function dayKey(offsetDays: number): string {
  const date = new Date();
  date.setDate(date.getDate() - offsetDays);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Two hundred days of ducat income, more than the old 90-day cap kept.
function history() {
  return {
    schemaVersion: 2,
    entries: Array.from({ length: 200 }, (_, index) => ({
      date: dayKey(199 - index),
      platDelta: 0,
      creditsDelta: 0,
      endoDelta: 0,
      ducatsDelta: 15 + (index % 7),
      ayaDelta: 0,
      vitusDelta: 0,
      relicsOpened: 1,
      daysPlayed: 1,
      dailyTrades: 0,
      absDucats: 100 + index * 15,
    })),
  };
}

test.describe("Stats year timeframe", () => {
  test.setTimeout(180_000);

  let harness: ElectronTestHarness | undefined;
  const seededHistory = history();

  test.beforeAll(async () => {
    harness = await launchElectronTestHarness("wfh-stats-year-", {
      inventory: { MiscItems: [] },
      userDataFiles: { "stats-history.json": seededHistory },
    });
  });

  test.afterAll(async () => {
    await closeElectronTestHarness(harness);
  });

  test("charts a saved datum older than 90 days before and after reload", async () => {
    const page = harness!.page;
    const oldest = seededHistory.entries[0]!;
    const assertOldDatum = async () => {
      await page.locator('#sidebar [data-view="stats"]').click();
      const timeframe = page.locator("[data-stats-timeframe] select");
      await expect(timeframe).toBeVisible({ timeout: 15_000 });
      await timeframe.selectOption("365");
      const bar = page.locator(
        `[data-stats-chart="ducats"] rect[data-stats-date="${oldest.date}"]`,
      );
      await expect(bar).toHaveAttribute("data-stats-value", String(oldest.ducatsDelta));
      expect(Number(await bar.getAttribute("height"))).toBeGreaterThan(0);
    };
    await assertOldDatum();
    await page.reload();
    await assertOldDatum();
    const saved = JSON.parse(
      fs.readFileSync(path.join(harness!.sandboxDir, "user-data", "stats-history.json"), "utf8"),
    ) as { entries: Array<{ date: string; ducatsDelta: number }> };
    expect(saved.entries.find((entry) => entry.date === oldest.date)?.ducatsDelta).toBe(
      oldest.ducatsDelta,
    );
    await page.screenshot({ path: test.info().outputPath("stats-year.png"), fullPage: false });
  });
});
