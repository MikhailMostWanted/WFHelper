import fs from "node:fs";

import { test, expect } from "@playwright/test";

import { launchElectronTestHarness, openView, selectOptionValues } from "./electronTestHarness";

const SEED_RULE_ID = "seed-riven-rule";

const SEEDED_RULES = {
  schema: 1,
  rules: [
    {
      id: SEED_RULE_ID,
      name: "Seeded Boar",
      kind: "riven",
      enabled: false,
      cooldownMinutes: 60,
      riven: {
        weaponUrlName: "boar",
        requirePositive: ["multishot"],
        excludeAttributes: [],
        statBounds: [],
        positiveCount: 2,
      },
    },
  ],
  bindings: { [SEED_RULE_ID]: { native: true } },
  ownedCounts: {},
};

test("the riven alert editor offers stat layouts and clamps the rank fields", async () => {
  const harness = await launchElectronTestHarness("wfh-alert-editor-", {
    userDataFiles: { "market-alert-rules.json": SEEDED_RULES },
  });
  const page = harness.page;
  const rendererErrors: string[] = [];
  page.on("pageerror", (err) => rendererErrors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") rendererErrors.push(msg.text());
  });

  try {
    await openView(page, "market");
    await page.locator('#content [data-tour-tab="alerts"]').first().click();

    const cards = page.locator("[data-alert-card]");
    await expect(cards).toHaveCount(1, { timeout: 30_000 });
    const buffCountChip = page.locator('[data-alert-chip="positiveCount"]');
    await expect(buffCountChip).toHaveCount(1);

    await page.locator(`[data-alert-edit="${SEED_RULE_ID}"]`).click();
    await expect(page.locator('[data-testid="alert-rule-editor"]')).toBeVisible({
      timeout: 30_000,
    });
    await page.locator("[data-alert-save]").click();
    await expect(cards).toHaveCount(1);
    await expect(buffCountChip).toHaveCount(1);

    await page.locator(`[data-alert-duplicate="${SEED_RULE_ID}"]`).click();
    await expect(cards).toHaveCount(2);
    await expect(buffCountChip).toHaveCount(2);

    await page.locator("[data-alert-new-rule]").click();
    const editor = page.locator('[data-testid="alert-rule-editor"]');
    await expect(editor).toBeVisible({ timeout: 30_000 });

    const layout = page.locator("[data-alert-stat-layout]");
    await expect(layout).toBeVisible();
    // Values, not labels: the option text is translated.
    expect(await selectOptionValues(layout)).toEqual(["", "2p1n", "3p1n", "2p", "3p"]);

    await layout.selectOption("2p1n");
    expect(await layout.inputValue()).toBe("2p1n");
    await expect(editor.locator("[data-alert-negative-mode]")).toHaveValue("required");

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
