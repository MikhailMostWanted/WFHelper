import { expect, test } from "@playwright/test";

import { DB_GET_RELIC_DATABASE } from "../config/shared/ipcChannels";
import type { RelicDatabase, RelicQuality, RelicReward } from "../src/types/relics";
import {
  closeElectronTestHarness,
  evaluateInMain,
  launchElectronTestHarness,
  openView,
  setLayoutViewport,
  type ElectronTestHarness,
} from "./electronTestHarness";

const SOURCE_REWARDS: RelicReward[] = [
  { name: "Rare Drop", rarity: "Rare", chance: 2, urlName: "rare_drop", ducats: 100 },
  { name: "Uncommon A", rarity: "Uncommon", chance: 11, urlName: "uncommon_a", ducats: 45 },
  { name: "Uncommon B", rarity: "Uncommon", chance: 11, urlName: "uncommon_b", ducats: 45 },
  { name: "Common A", rarity: "Common", chance: 25.33, urlName: "common_a", ducats: 15 },
  { name: "Common B", rarity: "Common", chance: 25.33, urlName: "common_b", ducats: 15 },
  { name: "Common C", rarity: "Common", chance: 25.33, urlName: "common_c", ducats: 15 },
];

const relics: RelicDatabase = { groups: {}, byUniqueName: {} };
const inventory = { Suits: [], LevelKeys: [] as { ItemType: string; ItemCount: number }[] };
const key = "Lith Z9";
relics.groups[key] = { key, name: key, tier: "Lith", code: "Z9", imageUrl: null, qualities: {} };
for (const quality of ["intact", "exceptional", "flawless", "radiant"] as RelicQuality[]) {
  const uniqueName = `/Lotus/Types/Game/Projections/Z9_${quality}`;
  relics.groups[key].qualities[quality] = { uniqueName, rewards: SOURCE_REWARDS };
  relics.byUniqueName[uniqueName] = { groupKey: key, quality };
  inventory.LevelKeys.push({ ItemType: uniqueName, ItemCount: 4 });
}

test("a relic card lists its drops common to rare, the way the game does", async () => {
  test.setTimeout(180_000);
  let harness: ElectronTestHarness | undefined;
  try {
    harness = await launchElectronTestHarness("wfh-relic-reward-order-", { inventory });
    const { app, page } = harness;
    await evaluateInMain(
      app,
      ({ ipcMain }, payload) => {
        ipcMain.removeHandler(payload.channel);
        ipcMain.handle(payload.channel, () => payload.data);
      },
      { channel: DB_GET_RELIC_DATABASE, data: relics },
    );
    await page.reload();
    await setLayoutViewport(page, 1440, 900);
    await openView(page, "relics");

    const icons = page.locator(".relic-reward-preview-icon");
    await expect(icons).toHaveCount(6, { timeout: 30_000 });
    // The tooltip leads with the reward name, so the order reads off the titles.
    const titles = await icons.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("title") ?? ""),
    );
    expect(titles).toEqual([
      "Common A (Common, 25.33%)",
      "Common B (Common, 25.33%)",
      "Common C (Common, 25.33%)",
      "Uncommon A (Uncommon, 11%)",
      "Uncommon B (Uncommon, 11%)",
      "Rare Drop (Rare, 2%)",
    ]);

    await page.screenshot({
      animations: "disabled",
      path: test.info().outputPath("relic-reward-order.png"),
    });
  } finally {
    await closeElectronTestHarness(harness);
  }
});
