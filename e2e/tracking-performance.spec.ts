import { expect, test } from "@playwright/test";
import {
  closeElectronTestHarness,
  evaluateInMain,
  launchElectronTestHarness,
  openView,
  setLayoutViewport,
  type ElectronTestHarness,
} from "./electronTestHarness";

const trades = Array.from({ length: 2000 }, (_, index) => ({
  id: `tracking-${index}`,
  date: new Date(Date.now() - index * 60000).toISOString(),
  type: "sale",
  platChange: 10,
  partner: `Partner ${index}`,
  items: [{ internalName: "", displayName: `Fixture ${index}`, count: 1, direction: "given" }],
}));

test("Tracking retains its mounted trade history and search across sub-tabs", async () => {
  test.setTimeout(180000);
  let harness: ElectronTestHarness | undefined;
  const pageErrors: string[] = [];
  try {
    harness = await launchElectronTestHarness("wfh-tracking-performance-", {
      userDataFiles: { "trade-log.json": trades },
      onPage: (page) => {
        page.on("pageerror", (error) => pageErrors.push(error.message));
      },
    });
    const { page } = harness;
    await openView(page, "stats");
    const panel = page.locator("[data-stats-trade-panel]");
    await expect(panel).toBeVisible();
    await expect(panel.locator("[data-trade-filters]")).toContainText("2000");
    const original = await panel.elementHandle();
    const switchTimes: number[] = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.locator('[data-stats-header] [data-tour-tab="personal"]').click();
      switchTimes.push(
        await page.evaluate(async () => {
          const started = performance.now();
          document
            .querySelector<HTMLButtonElement>('[data-stats-header] [data-tour-tab="tracking"]')!
            .click();
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          );
          return performance.now() - started;
        }),
      );
      await expect(panel).toBeVisible();
    }
    await test.info().attach("tracking-switch-ms", {
      body: JSON.stringify(switchTimes),
      contentType: "application/json",
    });
    expect(await original!.evaluate((node) => node.isConnected)).toBe(true);
    // The list renders 300 rows at a time; the last trade needs every window expanded.
    const more = panel.locator("[data-stats-trades-more]");
    while ((await more.count()) > 0) await more.click();
    const lastTrade = panel.locator('[data-trade-row="tracking-1999"]');
    await lastTrade.scrollIntoViewIfNeeded();
    await expect(lastTrade).toBeInViewport();
    await page.screenshot({
      path: test.info().outputPath("tracking-last-trade.png"),
      animations: "disabled",
    });
    await page.locator('[data-stats-header] [data-tour-tab="personal"]').click();
    await page.locator('[data-stats-header] [data-tour-tab="tracking"]').click();
    await expect(lastTrade).toBeInViewport();
    await panel.locator("input").fill("Fixture 1999");
    await page.locator('[data-stats-header] [data-tour-tab="personal"]').click();
    await expect(panel).toBeHidden();
    await evaluateInMain(harness.app, (electron) => {
      for (const window of electron.BrowserWindow.getAllWindows()) {
        window.webContents.send("trade-recorded", {
          trade: {
            id: "tracking-live",
            date: new Date().toISOString(),
            type: "sale",
            platChange: 25,
            items: [
              { internalName: "", displayName: "Fixture 1999 live", count: 1, direction: "given" },
            ],
          },
        });
      }
    });
    await page.locator('[data-stats-header] [data-tour-tab="tracking"]').click();
    await expect(panel.locator("input")).toHaveValue("Fixture 1999");
    await expect(panel).toContainText("Fixture 1999 live");
    await page.locator("[data-stats-resource-picker]").click();
    await expect(page.locator("[data-stat-resource-picker]")).toHaveCSS("box-shadow", "none");
    await page.screenshot({
      path: test.info().outputPath("chart-resources.png"),
      animations: "disabled",
    });
    expect(pageErrors).toEqual([]);
  } finally {
    await closeElectronTestHarness(harness);
  }
});

test("hidden Tracking preserves its measured layout breakpoint", async () => {
  test.setTimeout(180000);
  let harness: ElectronTestHarness | undefined;
  const pageErrors: string[] = [];
  const sections = (hidden: boolean) => ({
    version: 1,
    sections: [
      { id: "stats.summary", span: "full", hidden: false, collapsed: false },
      { id: "stats.charts", span: "full", hidden: false, collapsed: false },
      { id: "stats.trades", span: "full", hidden, collapsed: false },
    ],
  });
  try {
    harness = await launchElectronTestHarness("wfh-tracking-breakpoint-", {
      userDataFiles: { "trade-log.json": trades.slice(0, 2) },
      storage: {
        wf_layout_v1: JSON.stringify({
          version: 1,
          views: {
            stats: { narrow: sections(false), wide: sections(true) },
          },
        }),
      },
      onPage: (page) => {
        page.on("pageerror", (error) => pageErrors.push(error.message));
      },
    });
    const { page } = harness;
    await setLayoutViewport(page, 1000, 900);
    await openView(page, "stats");
    const grid = page.locator('[data-layout-grid="stats"]');
    const panel = page.locator("[data-stats-trade-panel]");
    await expect(grid).toHaveAttribute("data-layout-breakpoint", "narrow");
    await expect(panel).toBeVisible();
    await panel.locator("input").fill("Fixture 1");
    const original = await panel.elementHandle();
    await page.locator('[data-stats-header] [data-tour-tab="personal"]').click();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(grid).toHaveAttribute("data-layout-breakpoint", "narrow");
    expect(await original!.evaluate((node) => node.isConnected)).toBe(true);
    await page.locator('[data-stats-header] [data-tour-tab="tracking"]').click();
    await expect(panel).toBeVisible();
    await expect(panel.locator("input")).toHaveValue("Fixture 1");
    expect(await original!.evaluate((node) => node.isConnected)).toBe(true);
    expect(pageErrors).toEqual([]);
  } finally {
    await closeElectronTestHarness(harness);
  }
});
