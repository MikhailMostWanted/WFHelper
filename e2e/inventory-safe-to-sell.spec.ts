import { test, expect, type Page } from "@playwright/test";

import {
  closeElectronTestHarness,
  launchElectronTestHarness,
  openView,
  type ElectronTestHarness,
} from "./electronTestHarness";

// Bronco Prime Receiver builds Bronco Prime, and Akbronco Prime eats two built
// Bronco Primes. With neither weapon owned, three receivers leave exactly one
// spare - a rule that only looked one level up would call two of them spare.
const RECEIVER = "/Lotus/Types/Recipes/Weapons/WeaponParts/BroncoPrimeReceiver";
const OWNED = 3;

function inventory(): unknown {
  return {
    Suits: [],
    MiscItems: [{ ItemType: RECEIVER, ItemCount: OWNED }],
  };
}

test.describe("Inventory safe-to-sell", () => {
  test.setTimeout(180_000);

  let harness: ElectronTestHarness | undefined;
  let page: Page;

  test.beforeAll(async () => {
    harness = await launchElectronTestHarness("wfh-safe-to-sell-", { inventory: inventory() });
    page = harness.page;
    await openView(page, "inventory");
    await page.locator('[data-tour-tab="all_parts"]').click();
    await expect(page.locator(`[data-inventory-card="${RECEIVER}"]`)).toBeVisible({
      timeout: 30_000,
    });
  });

  test.afterAll(async () => {
    await closeElectronTestHarness(harness);
  });

  test("the card badges the copies that are free to sell", async () => {
    // The badge waits on the mastery pass, which lands after the inventory does.
    await expect(
      page.locator(`[data-inventory-card="${RECEIVER}"] [data-safe-to-sell]`),
    ).toHaveAttribute("data-safe-to-sell", String(OWNED - 2), { timeout: 60_000 });
  });

  test("the detail modal explains every reservation with its build chain", async () => {
    await page.locator(`[data-inventory-card="${RECEIVER}"] .expand-link`).click();
    const section = page.locator("[data-reserved-section]");
    await expect(section).toBeVisible({ timeout: 15_000 });
    await expect(section).toContainText(/Akbronco Prime/i);

    await page.locator(".detail-close").click();
    await expect(page.locator("[data-reserved-section]")).toHaveCount(0);
  });
});
