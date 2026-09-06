import { test, expect, type Page } from "@playwright/test";

// The view draws one card per generated row, so the table is the expected count.
import { SYNDICATE_RANKS } from "../src/data/syndicateRanks";
import {
  closeElectronTestHarness,
  launchElectronTestHarness,
  openView,
  writeHarnessInventory,
  type ElectronTestHarness,
} from "./electronTestHarness";

const GALLIUM = "/Lotus/Types/Items/MiscItems/Gallium";
const FORMA = "/Lotus/Types/Items/MiscItems/Forma";

// Each test is self-contained: a failed test restarts the worker, which re-runs
// beforeAll with a fresh sandbox and empty localStorage.
test.describe("Syndicate rank-up assistant", () => {
  test.setTimeout(180_000);

  let harness: ElectronTestHarness;
  let page: Page;

  test.beforeAll(async () => {
    harness = await launchElectronTestHarness("wfh-syndicates-e2e-");
    page = harness.page;
    // Rank 1 with one Gallium leaves the rank 2 Forma and the rank 3 Gallium short.
    writeHarnessInventory(harness, {
      PlayerLevel: 20,
      RegularCredits: 5000,
      DailyAffiliation: 2000,
      Affiliations: [{ Tag: "ArbitersSyndicate", Standing: 10000, Title: 1, Initiated: true }],
      MiscItems: [{ ItemType: GALLIUM, ItemCount: 1 }],
      Suits: [],
    });
  });

  test.afterAll(async () => {
    await closeElectronTestHarness(harness);
  });

  const card = () => page.locator('[data-syndicate-card="ArbitersSyndicate"]');

  test.beforeEach(async () => {
    await page.evaluate(() => localStorage.removeItem("wf_syndicate_goals_v1"));
    await openView(page, "syndicates");
  });

  test("the sidebar opens the tab and lists every syndicate", async () => {
    await expect(page.locator("[data-syndicates-view]")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("[data-syndicate-card]")).toHaveCount(SYNDICATE_RANKS.length);
    await expect(card()).toBeVisible();
  });

  test("picking a target rank lists what is still missing", async () => {
    await expect(card()).toBeVisible({ timeout: 30_000 });
    await expect(card().locator("[data-item-tile-missing]")).toHaveCount(0);

    await card().locator('[data-syndicate-goal="3"]').click();

    await expect(card().locator('[data-syndicate-step="2"]')).toBeVisible();
    await expect(card().locator('[data-syndicate-step="3"]')).toBeVisible();
    await expect(card().locator("[data-item-tile-missing]").first()).toBeVisible();

    // Rank 2 costs credits plus one Forma, and each cost draws its own tile.
    const step2 = card().locator('[data-syndicate-step="2"]');
    await expect(step2.locator('[data-item-tile="credits"]')).toBeVisible();
    await expect(step2.locator(`[data-item-tile="${FORMA}"]`)).toBeVisible();

    const totals = page.locator("[data-syndicates-totals]");
    await expect(totals.locator("[data-syndicate-total-item]")).toHaveCount(2);
    await expect(totals.locator('[data-syndicate-pool="NORMAL"]')).toBeVisible();
  });

  test("a cost tile that is a button opens the item detail modal", async () => {
    await card().locator('[data-syndicate-goal="2"]').click();

    // Credits have nothing to open, so that tile stays a plain div.
    const step2 = card().locator('[data-syndicate-step="2"]');
    await expect(step2.locator('div[data-item-tile="credits"]')).toBeVisible();

    const forma = step2.locator(`button[data-item-tile="${FORMA}"]`);
    await expect(forma).toBeVisible();
    await forma.click();

    await expect(page.locator('[role="dialog"] .detail-panel').first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator('[role="dialog"] .detail-panel')).toHaveCount(0);

    // Goals live in the renderer as well as in storage, so clear the one this test set.
    await card().locator('[data-syndicate-goal="2"]').click();
    await expect(card().locator("[data-syndicate-step]")).toHaveCount(0);
  });

  test("a goal survives a renderer reload and clears on demand", async () => {
    await card().locator('[data-syndicate-goal="2"]').click();
    await expect(card().locator('[data-syndicate-step="2"]')).toBeVisible();

    await page.reload();
    await expect(page.locator("#sidebar")).toBeVisible({ timeout: 90_000 });
    await openView(page, "syndicates");
    await expect(card().locator('[data-syndicate-step="2"]')).toBeVisible();

    await page.locator("[data-syndicates-view] .view-header button").last().click();
    await expect(card().locator("[data-syndicate-step]")).toHaveCount(0);
  });
});
