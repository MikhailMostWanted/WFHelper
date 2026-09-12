import { test, expect, type Page } from "@playwright/test";

import {
  closeElectronTestHarness,
  launchElectronTestHarness,
  openView,
  type ElectronTestHarness,
} from "./electronTestHarness";

// Akbronco Prime reserves two built Bronco Primes, so three receivers leave one
// the queue is allowed to offer.
const RECEIVER = "/Lotus/Types/Recipes/Weapons/WeaponParts/BroncoPrimeReceiver";

function inventory(): unknown {
  return { Suits: [], MiscItems: [{ ItemType: RECEIVER, ItemCount: 3 }] };
}

test.describe("Bulk sell filters", () => {
  test.setTimeout(180_000);

  let harness: ElectronTestHarness | undefined;
  let page: Page;

  test.beforeAll(async () => {
    harness = await launchElectronTestHarness("wfh-bulk-sell-filters-", { inventory: inventory() });
    page = harness.page;
    await openView(page, "inventory");
    await page.locator('[data-tour-tab="all_parts"]').click();
    await expect(page.locator(`[data-inventory-card="${RECEIVER}"]`)).toBeVisible({
      timeout: 30_000,
    });
    await page.locator("[data-inventory-select-toggle]").click();
    await page.locator("[data-inventory-select-all]").click();
    await page.locator("[data-bulk-sell-open]").click();
  });

  test.afterAll(async () => {
    await closeElectronTestHarness(harness);
  });

  test("the queue toolbar offers plat bounds, a listing filter and bulk ticks", async () => {
    const min = page.locator("[data-workbench-min-plat]");
    await expect(min).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("[data-workbench-max-plat]")).toBeVisible();
    await expect(page.locator("[data-workbench-listed]")).toBeVisible();
    await expect(page.locator("[data-workbench-select-all]")).toBeVisible();
    await expect(page.locator("[data-workbench-select-none]")).toBeVisible();
    await expect(page.locator("[data-workbench-select-invert]")).toBeVisible();

    // The bar renders whether or not the queue found a sellable row, so the
    // labels are asserted as translated text rather than as raw message keys.
    for (const selector of [
      "[data-workbench-select-all]",
      "[data-workbench-select-none]",
      "[data-workbench-select-invert]",
    ]) {
      expect(await page.locator(selector).innerText()).not.toContain("workbench.");
    }
    expect(await min.getAttribute("placeholder")).not.toContain("workbench.");

    await page.screenshot({ path: test.info().outputPath("bulk-sell-toolbar.png") });
  });

  test("a plat bound hides the rows whose price is not loaded yet", async () => {
    const rows = page.locator("[data-workbench-row]");
    // The queue fills after the safety snapshot lands, so wait for the row
    // instead of counting a list that has not been built yet.
    await expect(rows.first()).toBeVisible({ timeout: 30_000 });
    const before = await rows.count();

    await page.locator("[data-workbench-min-plat]").fill("5");
    await expect(page.locator("[data-workbench-no-price-hidden]")).toBeVisible();
    await expect(rows).toHaveCount(0);

    await page.locator("[data-workbench-min-plat]").fill("");
    await expect(rows).toHaveCount(before);
    await expect(page.locator("[data-workbench-no-price-hidden]")).toHaveCount(0);
  });
});
