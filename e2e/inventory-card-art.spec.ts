import { test, expect } from "@playwright/test";

import {
  closeElectronTestHarness,
  launchElectronTestHarness,
  type ElectronTestHarness,
} from "./electronTestHarness";

const ACCELERATED_ISOTOPE = "/Lotus/Upgrades/Mods/Pistol/DualStat/RadiationFireratePistolMod";
const ARCANE_BELLICOSE = "/Lotus/Upgrades/CosmeticEnhancers/Offensive/AbilityStrengthForMaxHealth";

// Loose shards sit in MiscItems named after the Archon that drops them, and
// `Mythic` is tauforged.
const SHARD_PATH = "/Lotus/Types/Gameplay/NarmerSorties/";
const TAUFORGED_SHARDS = [
  "ArchonCrystalAmarMythic",
  "ArchonCrystalBorealMythic",
  "ArchonCrystalGreenMythic",
  "ArchonCrystalNiraMythic",
  "ArchonCrystalOrangeMythic",
  "ArchonCrystalVioletMythic",
].map((leaf) => `${SHARD_PATH}${leaf}`);

function inventory() {
  return {
    Suits: [],
    RawUpgrades: [{ ItemType: ACCELERATED_ISOTOPE, ItemCount: 23 }],
    Arcanes: [{ ItemType: ARCANE_BELLICOSE, ItemCount: 1 }],
  };
}

// Tab labels are translated; data-tour-tab carries the stable filter key.
async function tabImages(page: ElectronTestHarness["page"], tab: string): Promise<string[]> {
  await page.locator(`[data-tour="inventory-tabs"] [data-tour-tab="${tab}"]`).click();
  await expect(page.locator(".item-name").first()).toBeVisible({ timeout: 15_000 });
  return page
    .locator(".item-img")
    .evaluateAll((els) => els.map((el) => (el as HTMLImageElement).src));
}

test("mods and arcanes render the framed wiki card, not the market thumbnail", async () => {
  test.setTimeout(180_000);
  let harness: ElectronTestHarness | undefined;
  try {
    harness = await launchElectronTestHarness("wfh-cardart-", { inventory: inventory() });
    const { page } = harness;
    await page.locator('#sidebar [data-view="inventory"]').click();

    // Ranked listings, which is every mod and arcane, must not let the WFM thumb win.
    const mods = await tabImages(page, "mods");
    expect(mods.some((src) => src.includes("/mod-art/AcceleratedIsotopeMod.webp"))).toBe(true);
    expect(mods.some((src) => src.includes("/wfm/"))).toBe(false);

    const arcanes = await tabImages(page, "arcanes");
    expect(arcanes.some((src) => src.includes("/mod-art/ArcaneBellicose.webp"))).toBe(true);
    expect(arcanes.some((src) => src.includes("/wfm/"))).toBe(false);
  } finally {
    await closeElectronTestHarness(harness);
  }
});

test("every tauforged archon shard takes the wiki art over DE's faint plate", async () => {
  test.setTimeout(180_000);
  let harness: ElectronTestHarness | undefined;
  try {
    harness = await launchElectronTestHarness("wfh-shard-art-", {
      inventory: {
        Suits: [],
        MiscItems: TAUFORGED_SHARDS.map((ItemType) => ({ ItemType, ItemCount: 4 })),
      },
    });
    const { page } = harness;
    await page.locator('#sidebar [data-view="inventory"]').click();

    // Resources draw their own card, so the shared .item-img reader misses them.
    await page.locator('[data-tour="inventory-tabs"] [data-tour-tab="resources"]').click();
    await expect(page.locator(".resource-card").first()).toBeVisible({ timeout: 15_000 });
    const resources = await page
      .locator(".resource-card img")
      .evaluateAll((els) => els.map((el) => (el as HTMLImageElement).src));

    // DE's Green, Orange and Violet tauforged plates are near-transparent haze
    // and read as a smudge at thumbnail size, so all six take the wiki art.
    const art = resources.filter((src) => src.includes("/item-art/"));

    expect(art).toHaveLength(TAUFORGED_SHARDS.length);
    for (const colour of ["Amber", "Azure", "Crimson", "Emerald", "Topaz", "Violet"]) {
      expect(art.some((src) => src.endsWith(`/item-art/Tauforged${colour}ArchonShard.webp`))).toBe(
        true,
      );
    }
  } finally {
    await closeElectronTestHarness(harness);
  }
});
