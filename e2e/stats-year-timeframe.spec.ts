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
  let ducats = 100;
  return {
    schemaVersion: 2,
    entries: Array.from({ length: 200 }, (_, index) => {
      const ducatsDelta = 15 * (1 + Math.floor(index / 40));
      ducats += ducatsDelta;
      return {
        date: dayKey(199 - index),
        platDelta: 0,
        creditsDelta: 0,
        endoDelta: 0,
        ducatsDelta,
        ayaDelta: 0,
        vitusDelta: 0,
        relicsOpened: 1,
        daysPlayed: 1,
        dailyTrades: 0,
        absDucats: ducats,
      };
    }),
  };
}

test.describe("Stats year timeframe", () => {
  test.setTimeout(180_000);

  let harness: ElectronTestHarness | undefined;
  const seededHistory = history();

  test.beforeAll(async () => {
    harness = await launchElectronTestHarness("wfh-stats-year-", {
      inventory: {
        MiscItems: [
          {
            ItemType: "/Lotus/Types/Items/MiscItems/PrimeBucks",
            ItemCount: seededHistory.entries[199]!.absDucats,
          },
        ],
      },
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
    await page
      .locator('[data-stats-chart="ducats"]')
      .locator("xpath=ancestor::div[contains(@class, 'group/chart')]")
      .screenshot({ path: test.info().outputPath("stats-ducats-year.png") });
    await page.screenshot({ path: test.info().outputPath("stats-year.png"), fullPage: false });
  });
});
