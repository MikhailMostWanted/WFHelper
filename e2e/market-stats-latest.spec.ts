import { test, expect, type Page } from "@playwright/test";

import {
  closeElectronTestHarness,
  evaluateInMain,
  launchElectronTestHarness,
  type ElectronTestHarness,
} from "./electronTestHarness";

// A tradable part gets its slug locally, so the order-book panel opens with no catalogue.
const BRATON_PRIME_BARREL = "/Lotus/Types/Recipes/Weapons/WeaponParts/BratonPrimeBarrel";
const DAY = 86_400_000;

function priceAt(day: number): number {
  return Number((7 + Math.sin(day * 0.17) + Math.sin(day * 1.3) * 0.45).toFixed(1));
}

function dailySample(time: number) {
  const day = Math.floor(time / DAY);
  const median = priceAt(day);
  const recent = Array.from({ length: 7 }, (_, back) => priceAt(day - back));
  const open = priceAt(day - 1);
  const close = Number((median + Math.sin(day * 1.7) * 0.4).toFixed(1));
  return {
    datetime: new Date(time).toISOString(),
    volume: 80 + ((day * 47) % 97) + (day % 13 === 0 ? 120 : 0),
    median,
    moving_avg: recent.reduce((sum, price) => sum + price, 0) / recent.length,
    avg_price: Number((median + Math.sin(day * 0.8) * 0.2).toFixed(1)),
    open_price: open,
    closed_price: close,
    min_price: Math.min(open, close, median) - 0.8,
    max_price: Math.max(open, close, median) + 1.2,
    donch_top: Math.max(...recent) + 1.5,
    donch_bot: Math.min(...recent) - 1,
  };
}

function dailyRows(days: number, endOffsetDays: number) {
  const today = Date.UTC(2026, 8, 8);
  return Array.from({ length: days }, (_, index) => {
    const time = today - (days - 1 - index + endOffsetDays) * DAY;
    return dailySample(time);
  });
}

// Backend price-history rows, all older than the 90-day window so they only add days.
const BACKEND_HISTORY_DAYS = 30;
function backendHistoryRows() {
  const today = Date.UTC(2026, 8, 8);
  return Array.from({ length: BACKEND_HISTORY_DAYS }, (_, index) => {
    const time = today - (91 + BACKEND_HISTORY_DAYS - 1 - index) * DAY;
    const sample = dailySample(time);
    return [sample.datetime.slice(0, 10), null, sample.median, sample.volume];
  });
}

async function serveStatistics(page: Page, rows: unknown[]): Promise<void> {
  await page.evaluate((fixture) => {
    (window as unknown as { marketStatsFixtureRows: unknown[] }).marketStatsFixtureRows = fixture;
  }, rows);
}

async function openStatistics(page: Page): Promise<void> {
  await page.locator('#sidebar [data-view="inventory"]').click();
  await page.locator('[data-tour-tab="everything"]').click();
  await page.locator(".item-card").filter({ hasText: "Braton Prime Barrel" }).first().click();
  const statsButton = page.locator("[data-orderbook-stats]");
  await expect(statsButton).toBeVisible({ timeout: 15_000 });
  await statsButton.click();
  await expect(page.locator("[data-market-stats-modal]")).toBeVisible();
}

test.describe("Market statistics rolling year", () => {
  test.setTimeout(180_000);

  let harness: ElectronTestHarness | undefined;

  test.beforeAll(async () => {
    harness = await launchElectronTestHarness("wfh-market-stats-", {
      inventory: { MiscItems: [{ ItemType: BRATON_PRIME_BARREL, ItemCount: 2 }] },
      userDataFiles: { "overlay-settings.json": { uiScale: 1 } },
      onPage: async (page) => {
        // Electron exposes route.fulfill responses as status 0, so the fetch itself is patched.
        await page.addInitScript((history) => {
          const nativeFetch = window.fetch.bind(window);
          const scope = window as unknown as {
            marketStatsFixtureRows?: unknown[];
            releaseMarketArchive?: () => void;
          };
          const archiveReady = new Promise<void>((resolve) => {
            scope.releaseMarketArchive = resolve;
          });
          const json = (body: unknown): Promise<Response> =>
            Promise.resolve(
              new Response(JSON.stringify(body), {
                status: 200,
                headers: { "content-type": "application/json" },
              }),
            );
          window.fetch = (input, init) => {
            const url =
              typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
            const pathname = new URL(url, location.href).pathname;
            if (pathname.startsWith("/v1/price-history/")) {
              const slug = pathname.slice("/v1/price-history/".length);
              return archiveReady.then(() =>
                json({ ok: true, slug, generatedAt: Date.now(), rows: history }),
              );
            }
            if (!pathname.endsWith("/statistics")) return nativeFetch(input, init);
            return json({
              payload: {
                statistics_closed: { "48hours": [], "90days": scope.marketStatsFixtureRows ?? [] },
              },
            });
          };
        }, backendHistoryRows());
      },
    });
  });

  test.afterAll(async () => {
    await closeElectronTestHarness(harness);
  });

  test("Latest keeps the days that later 90-day fetches no longer carry", async () => {
    const page = harness!.page;
    await serveStatistics(page, dailyRows(90, 1));
    await openStatistics(page);
    const points = page.locator("[data-market-stats-points]");
    await expect(points).toHaveAttribute("data-market-stats-points", "90");

    await page.evaluate(() =>
      (window as unknown as { releaseMarketArchive: () => void }).releaseMarketArchive(),
    );

    // First open already reaches past the 90-day window: the backend archive fills the rest.
    await page.locator('[data-market-stats-period="latest"]').click();
    await expect(points).toHaveAttribute("data-market-stats-points", "120");
    await page.locator("[data-market-stats-candles]").check();
    await expect(page.locator("[data-market-stats-candle-series] rect")).toHaveCount(90);
    await page.keyboard.press("Escape");

    // The next day's window drops the oldest day; the stored year keeps it.
    await page.reload();
    await expect(page.locator("#sidebar")).toBeVisible({ timeout: 90_000 });
    await serveStatistics(page, dailyRows(90, 0));
    await page.evaluate(() =>
      (window as unknown as { releaseMarketArchive: () => void }).releaseMarketArchive(),
    );
    await openStatistics(page);
    await expect(points).toHaveAttribute("data-market-stats-points", "90");
    await page.locator('[data-market-stats-period="latest"]').click();
    await expect(points).toHaveAttribute("data-market-stats-points", "121");
    await page.locator("[data-market-stats-candles]").check();
    const readZoom = () =>
      evaluateInMain(harness!.app, ({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((win) => win.webContents.getURL().includes("renderer/dist/index.html"))!
          .webContents.getZoomFactor(),
      );
    const baseZoom = await readZoom();
    for (const scale of [1, 0.8]) {
      await page.keyboard.press("Escape");
      await page.evaluate((uiScale) => window.api.setOverlaySettings({ uiScale }), scale);
      await expect.poll(readZoom).toBeCloseTo(baseZoom * scale, 2);
      await page.locator("[data-orderbook-stats]").click();
      await page.locator('[data-market-stats-period="latest"]').click();
      await expect(points).toHaveAttribute("data-market-stats-points", "121");
      await page.locator("[data-market-stats-candles]").check();
      await page.screenshot({
        path: test.info().outputPath(`market-stats-fixture-${scale}.png`),
      });
      await expect
        .poll(() =>
          page.locator("[data-market-stats-points]").evaluate((element) => {
            const axis = element
              .querySelector("[data-market-stats-volume-axis]")!
              .getBoundingClientRect();
            const marks = element.querySelectorAll(
              "[data-market-stats-volume-series] rect, [data-market-stats-candle-series] rect, [data-market-stats-date-labels] text",
            );
            return Array.from(marks).flatMap((mark) => {
              const bounds = mark.getBoundingClientRect();
              return bounds.left >= axis.left - 0.1 && bounds.right <= axis.right + 0.1
                ? []
                : [
                    {
                      tag: mark.tagName,
                      text: mark.textContent,
                      left: bounds.left,
                      right: bounds.right,
                      axisLeft: axis.left,
                      axisRight: axis.right,
                    },
                  ];
            });
          }),
        )
        .toEqual([]);
      const labels = page.locator("[data-market-stats-date-labels] text");
      await expect(labels.first()).toHaveText("May 11");
      await expect(labels.last()).toHaveText("Sep 8");
    }
  });
});
