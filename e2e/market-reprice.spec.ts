import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";

import { mainWindow } from "./mainWindow";

function fixtureOrders(): { sell: unknown[]; buy: unknown[] } {
  // Ids must satisfy the IPC validator's 24-hex WFM ObjectId shape.
  const sell = Array.from({ length: 3 }, (_, index) => ({
    id: (index + 1).toString(16).padStart(24, "0"),
    orderType: "sell",
    platinum: 10 + index,
    quantity: 1,
    visible: true,
    modRank: null,
    itemId: `fixture-item-${index + 1}`,
    itemName: `Fixture Item ${index + 1}`,
    itemUrlName: `fixture_item_${index + 1}`,
    itemThumb: null,
  }));
  return { sell, buy: [] };
}

test.describe("Market reprice (fixture mode)", () => {
  test.setTimeout(240_000);

  let app: ElectronApplication;
  let page: Page;
  let sandboxDir: string;

  test.beforeAll(async () => {
    sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), "wfh-reprice-e2e-"));
    const localAppData = path.join(sandboxDir, "local");
    fs.mkdirSync(localAppData, { recursive: true });
    const fixturePath = path.join(sandboxDir, "wfm-orders.json");
    fs.writeFileSync(fixturePath, JSON.stringify(fixtureOrders()));
    const helperDir = path.join(sandboxDir, "user-data", "api-helper");
    fs.mkdirSync(helperDir, { recursive: true });
    fs.writeFileSync(path.join(helperDir, "inventory.json"), JSON.stringify({ Suits: [] }));

    const env = { ...process.env } as Record<string, string>;
    delete env.ELECTRON_RUN_AS_NODE;
    env.WFHELPER_DISABLE_KEYBOARD_HOOK = "1";
    env.LOCALAPPDATA = localAppData;
    env.WFHELPER_USER_DATA = path.join(sandboxDir, "user-data");
    env.WFHELPER_WFM_FIXTURES = fixturePath;

    app = await electron.launch({ args: ["--no-sandbox", "--lang=en-US", "."], env });
    page = await mainWindow(app);

    await expect(page.locator("#app")).toBeVisible({ timeout: 90_000 });
    await page.evaluate(() => {
      localStorage.setItem("setup-completed-v2", "1");
    });
    await page.reload();
    await expect(page.locator("#sidebar")).toBeVisible({ timeout: 90_000 });
    await page.locator('#sidebar [data-view="market"]').click();
    await expect(page.locator('[data-market-orders-heading="orders"]')).toBeVisible({
      timeout: 20_000,
    });
  });

  test.afterAll(async () => {
    await app?.close();
    fs.rmSync(sandboxDir, { recursive: true, force: true });
  });

  test("selected listings open a reprice preview at their current prices", async () => {
    await expect(page.locator("[data-market-reprice]")).toHaveCount(0);

    await page.locator("[data-market-select-all]").first().click();
    const reprice = page.locator("[data-market-reprice]");
    await expect(reprice).toBeVisible();
    await reprice.click();

    const modal = page.locator("[data-reprice-modal]");
    await expect(modal).toBeVisible({ timeout: 20_000 });
    await expect(modal.locator("[data-reprice-row]")).toHaveCount(3);
    await expect(modal.locator("[data-reprice-strategy]")).toBeVisible();

    await expect(modal.locator("[data-reprice-apply]")).toBeDisabled();
  });
});
