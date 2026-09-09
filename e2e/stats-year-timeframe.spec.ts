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
      const ducatsDelta = index < 10 ? 0 : 15 * (1 + Math.floor(index / 40));
      ducats += ducatsDelta;
      return {
        date: dayKey(199 - index),
        platDelta: 0,
        creditsDelta: 0,
        endoDelta: 0,
        ducatsDelta,
        ayaDelta: 0,
        vitusDelta: 0,
        relicsOpened: index === 0 ? 1234 : 1,
        daysPlayed: 1,
        dailyTrades: index === 0 ? 47 : 0,
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
    const oldest = seededHistory.entries[10]!;
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

  test("shows the initial balance and exact daily counts on hover in both chart sizes", async () => {
    const page = harness!.page;
    const first = seededHistory.entries[0]!;
    await page.locator('#sidebar [data-view="stats"]').click();
    await page.locator("[data-stats-timeframe] select").selectOption("365");

    for (const expanded of [false, true]) {
      for (const [key, value] of [
        ["ducats", "100"],
        ["dailyTrades", "47"],
        ["relicsOpened", "1,234"],
      ]) {
        if (expanded) await page.locator(`[data-stats-expand="${key}"]`).click();
        const scope = expanded ? page.locator('[role="dialog"]') : page.locator("body");
        const target =
          key === "ducats"
            ? scope.locator(`[data-stats-point="${key}"][data-stats-date="${first.date}"]`)
            : scope.locator(
                `[${expanded ? "data-stats-chart-expanded" : "data-stats-chart"}="${key}"] rect[data-stats-date="${first.date}"]`,
              );
        await target.hover();
        await expect(page.locator("[data-stats-tooltip]")).toHaveText(new RegExp(`\\| ${value}$`));
        if (expanded) {
          await page.screenshot({ path: test.info().outputPath(`stats-${key}-hover.png`) });
          await page.keyboard.press("Escape");
        }
      }
    }
  });
});
