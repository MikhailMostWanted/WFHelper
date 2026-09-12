import { expect, test } from "@playwright/test";

import { DB_GET_MASTERY } from "../config/shared/ipcChannels";
import {
  closeElectronTestHarness,
  evaluateInMain,
  launchElectronTestHarness,
  openView,
  setLayoutViewport,
  type ElectronTestHarness,
} from "./electronTestHarness";

// A roadmap card needs a whole mastery payload, so the DB handler is stubbed the
// way mastery-breakdown.spec.ts does it rather than seeding an inventory.
function masterable(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    name: "Item",
    internalName: "/Item",
    imageUrl: null,
    category: "Primary",
    categoryLabel: "Primary",
    status: "missing",
    rank: 0,
    maxRank: 30,
    isPrime: false,
    masteryReq: 0,
    vaulted: false,
    tradable: true,
    description: "",
    masteryXpRemaining: 3_000,
    currentlyOwned: false,
    components: [],
    drops: [],
    wikiaUrl: null,
    ...overrides,
  };
}

const BLUEPRINT = [{ name: "Blueprint", itemCount: 1, ownedCount: 0 }];

const mastery = {
  items: [
    // MR 13 against a rank 12 account, so the badge has to read as locked.
    masterable({
      name: "Kompressa",
      internalName: "/Kompressa",
      masteryReq: 13,
      marketBuyable: true,
      marketCredits: 15_000,
      components: BLUEPRINT,
    }),
    masterable({
      name: "Boltor",
      internalName: "/Boltor",
      marketBuyable: true,
      marketCredits: 25_000,
      components: BLUEPRINT,
    }),
    masterable({
      name: "Ignis",
      internalName: "/Ignis",
      dojoResearch: true,
      marketBuyable: true,
      marketCredits: 30_000,
      components: BLUEPRINT,
    }),
  ],
  stats: {
    total: 3,
    mastered: 0,
    inProgress: 0,
    missing: 3,
    byCategory: { Primary: { total: 3, mastered: 0, inProgress: 0, missing: 3 } },
    profileMastery: { rank: 12, totalXp: 1_000_000 },
  },
};

test("the roadmap marks the mastery rank, Market blueprints and dojo research", async () => {
  test.setTimeout(180_000);
  let harness: ElectronTestHarness | undefined;
  try {
    harness = await launchElectronTestHarness("wfh-mastery-roadmap-");
    const { app, page } = harness;
    await evaluateInMain(
      app,
      ({ ipcMain }, payload) => {
        ipcMain.removeHandler(payload.channel);
        ipcMain.handle(payload.channel, () => payload.data);
      },
      { channel: DB_GET_MASTERY, data: mastery },
    );
    await page.reload();
    await setLayoutViewport(page, 1440, 1100);
    await openView(page, "mastery");
    await page.locator('[data-tour-tab="roadmap"]').first().click();

    const cards = page.locator("[data-roadmap-mr]");
    await expect(cards.first()).toBeVisible({ timeout: 30_000 });

    // MR 13 on a rank 12 account is the locked case; MR 0 items carry no badge.
    const locked = page.locator("[data-roadmap-mr-locked]");
    await expect(locked).toHaveCount(1);
    await expect(locked).toHaveAttribute("data-roadmap-mr", "13");

    // Both Market blueprints and the dojo tag live on the same shared card.
    await expect(page.locator('[data-roadmap-dojo="true"]')).toHaveCount(1);
    const easyText = await page.locator("#content").innerText();
    expect(easyText).not.toContain("mastery.roadmap.");
    expect(easyText).toMatch(/25[.,\s]?000/);

    await page.screenshot({ path: test.info().outputPath("mastery-roadmap.png") });
  } finally {
    await closeElectronTestHarness(harness);
  }
});
