import { test, expect } from "@playwright/test";

import {
  closeElectronTestHarness,
  launchElectronTestHarness,
  openView,
  setLayoutViewport,
} from "./electronTestHarness";

test("quest acquisition is searchable without a random drop percentage", async () => {
  const harness = await launchElectronTestHarness("wf-drop-acquisition-", {
    userDataFiles: {
      "drop-data-cache.json": {
        version: 2,
        hash: "acquisition-fixture",
        updatedAt: "2026-09-08T00:00:00.000Z",
        rows: [],
      },
    },
  });
  try {
    const { page } = harness;
    await setLayoutViewport(page, 1400, 900);
    await openView(page, "wiki");
    await page.locator("[data-search-focus]").fill("helminth archon");
    const row = page
      .locator("tr")
      .filter({ has: page.locator('[data-acquisition-method="quest"]') });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("Helminth Archon Shard Segment Blueprint");
    await expect(row).toContainText("Veilbreaker");
    await expect(row).not.toContainText("%");
    await expect(row.locator("[data-acquisition-source]")).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("helminth-quest-source.png") });
    await page.locator('[data-wiki-mode="place"]').click();
    await page.locator("[data-search-focus]").fill("veilbreaker");
    await expect(row).toHaveCount(1);
    await page.locator('[data-wiki-mode="enemy"]').click();
    await expect(row).toHaveCount(0);
  } finally {
    await closeElectronTestHarness(harness);
  }
});
