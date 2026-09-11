import fs from "node:fs";

import { test, expect } from "@playwright/test";

import { launchElectronTestHarness } from "./electronTestHarness";

test("the riven alert editor offers stat layouts and clamps the rank fields", async () => {
  const harness = await launchElectronTestHarness("wfh-alert-editor-");
  const page = harness.page;
  const rendererErrors: string[] = [];
  page.on("pageerror", (err) => rendererErrors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") rendererErrors.push(msg.text());
  });

  try {
    await page.locator('#sidebar [data-view="market"]').click();
    await page.locator("#content button", { hasText: "Alerts" }).first().click();
    await page.locator("button", { hasText: "New rule" }).first().click();

    const editor = page.locator('[data-testid="alert-rule-editor"]');
    await expect(editor).toBeVisible({ timeout: 30_000 });

    const layout = page.locator("[data-alert-stat-layout]");
    await expect(layout).toBeVisible();
    expect(await layout.locator("option").allTextContents()).toEqual([
      "Any",
      "2p1n",
      "3p1n",
      "2p",
      "3p",
    ]);

    // Picking a layout that names a curse implies the curse gate.
    await layout.selectOption("2p1n");
    expect(await layout.inputValue()).toBe("2p1n");
    await expect(editor.locator("select").first()).toHaveValue("required");

    // A rank no riven can reach must not reach the save, which refuses it.
    const rank = editor.locator('input[type="number"][max="8"]').first();
    await rank.fill("7908");
    await expect(rank).toHaveValue("8");

    const mastery = editor.locator('input[type="number"][max="16"]').first();
    await mastery.fill("99");
    await expect(mastery).toHaveValue("16");

    expect(rendererErrors).toEqual([]);
  } finally {
    await harness.app.close();
    fs.rmSync(harness.sandboxDir, { recursive: true, force: true });
  }
});
