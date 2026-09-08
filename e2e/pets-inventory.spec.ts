import { expect, test } from "@playwright/test";

import { DB_GET_ITEM_DATABASE } from "../config/shared/ipcChannels";
import {
  closeElectronTestHarness,
  evaluateInMain,
  launchElectronTestHarness,
  openView,
  setLayoutViewport,
  type ElectronTestHarness,
} from "./electronTestHarness";

const species = "/Lotus/Types/Game/KubrowPet/HunterKubrowPetPowerSuit";
const kavat = "/Lotus/Types/Game/CatbrowPet/CheshireCatbrowPetPowerSuit";
const baseColor = "/Lotus/Types/Game/KubrowPet/Colors/KubrowPetColorMundaneA";
const recessiveColor = "/Lotus/Types/Game/KubrowPet/Colors/KubrowPetColorVibrantG";
const inventory = {
  Suits: [],
  KubrowPets: [
    {
      ItemType: species,
      ItemId: { $oid: "fixture-pet-1" },
      Details: {
        Name: "Ash",
        Status: "STATUS_AVAILABLE",
        IsMale: true,
        PrintsRemaining: 2,
        Size: 1.0625,
        DominantTraits: {
          BaseColor: baseColor,
          FurPattern: "/Lotus/Types/Game/KubrowPet/Patterns/KubrowPetPatternA",
        },
        RecessiveTraits: { BaseColor: recessiveColor },
      },
    },
    { ItemType: kavat, ItemId: { $oid: "fixture-pet-2" }, Details: { Name: "Moon" } },
    { ItemType: species, ItemId: { $oid: "fixture-pet-3" } },
  ],
  KubrowPetPrints: [
    {
      ItemId: { $oid: "fixture-imprint-1" },
      Name: "Ash",
      IsMale: true,
      Size: 1.0625,
      DominantTraits: { Personality: species, BaseColor: baseColor },
    },
  ],
};

test("Pets lists owned instances, genetics and imprints without fabricating missing details", async () => {
  test.setTimeout(180_000);
  let harness: ElectronTestHarness | undefined;
  const errors: string[] = [];
  try {
    harness = await launchElectronTestHarness("wfh-pets-", {
      inventory,
      onPage: (page) => {
        page.on("pageerror", (error) => errors.push(error.message));
      },
    });
    const { app, page } = harness;
    await evaluateInMain(
      app,
      ({ ipcMain }, payload) => {
        ipcMain.removeHandler(payload.channel);
        ipcMain.handle(payload.channel, () => payload.database);
      },
      {
        channel: DB_GET_ITEM_DATABASE,
        database: {
          [species]: {
            name: "Huras Kubrow",
            category: "Companion",
            imageUrl:
              "data:image/svg+xml," +
              encodeURIComponent(
                '<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="2000"><rect width="2000" height="2000" fill="#486a89"/></svg>',
              ),
          },
          [kavat]: { name: "Smeeta Kavat", category: "Companion" },
        },
      },
    );
    await page.reload();
    await setLayoutViewport(page, 1440, 1000);
    await openView(page, "inventory");
    await page.locator('[data-tour="inventory-tabs"] [data-tour-tab="pets"]').click();
    const panel = page.locator("[data-pets-inventory]");
    await expect(panel.locator("[data-pet-card]")).toHaveCount(3);
    await expect(panel.locator("[data-pet-imprint]")).toHaveCount(1);
    const ash = panel.locator('[data-pet-card="fixture-pet-1"]');
    await expect(ash.locator("img")).toBeVisible();
    expect(
      await ash.locator("img").evaluate((node) => node.getBoundingClientRect().width),
    ).toBeLessThanOrEqual(80);
    expect(
      await ash.locator("h3").evaluate((node) => node.getBoundingClientRect().width),
    ).toBeGreaterThan(100);
    await expect(ash.locator('[data-pet-swatch="#868f8c"]')).toHaveCount(1);
    await expect(ash.locator('[data-pet-swatch="#486a89"]')).toHaveCount(1);
    await expect(panel.locator('[data-pet-card="fixture-pet-3"]')).not.toContainText("Female");
    await expect(panel.locator('[data-pet-card="fixture-pet-3"]')).not.toContainText("Size ");
    await expect(page.locator("[data-inventory-select-toggle]")).toHaveCount(0);
    await page.screenshot({
      animations: "disabled",
      path: test.info().outputPath("pets-inventory.png"),
    });
    await panel.locator("[data-pets-search]").fill("smeeta");
    await expect(panel.locator("[data-pet-card]")).toHaveCount(1);
    await expect(panel.locator("[data-pet-imprint]")).toHaveCount(0);
    await panel.locator("[data-pets-search]").fill("nothing-matches");
    await expect(panel.locator("[data-pets-empty]")).toBeVisible();
    await page.reload();
    await openView(page, "inventory");
    await expect(page.locator('[data-tour-tab="pets"][data-active]')).toBeVisible();
    await expect(page.locator("[data-pet-card]")).toHaveCount(3);
    await setLayoutViewport(page, 800, 1000);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
    await page.screenshot({
      animations: "disabled",
      path: test.info().outputPath("pets-inventory-narrow.png"),
    });
    expect(errors).toEqual([]);
  } finally {
    if (harness) await closeElectronTestHarness(harness);
  }
});
