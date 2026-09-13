import { expect, test, type Page } from "@playwright/test";

import { DB_GET_RELIC_DATABASE } from "../config/shared/ipcChannels";
import type { RelicDatabase } from "../src/types/relics";
import {
  closeElectronTestHarness,
  evaluateInMain,
  launchElectronTestHarness,
  openView,
  setLayoutViewport,
  writeHarnessInventory,
  type ElectronTestHarness,
} from "./electronTestHarness";

interface SeededReward {
  uniqueName: string;
  name: string;
  relicLocation: string;
}

/** The reward and the relic it drops from both come from the shipped database,
 *  so the fixture cannot drift from whatever the drop tables say today. */
async function readRewardWithRelicDrop(page: Page): Promise<SeededReward> {
  const reward = await page.evaluate(async () => {
    const db = (await window.api.getItemDatabase()) as unknown as Record<
      string,
      { name?: string; drops?: Array<{ location?: string }> }
    >;
    for (const [uniqueName, entry] of Object.entries(db)) {
      if (!entry?.name) continue;
      const relic = entry.drops?.find((drop) =>
        /^(Lith|Meso|Neo|Axi) [A-Z]+\d+ Relic/.test(String(drop.location ?? "")),
      );
      if (relic?.location) return { uniqueName, name: entry.name, relicLocation: relic.location };
    }
    return null;
  });

  expect(reward, "nothing in the item database drops from a relic").not.toBeNull();
  return reward as SeededReward;
}

function relicFixture(reward: SeededReward) {
  const [tier, code] = reward.relicLocation.replace(/\s*Relic.*$/i, "").split(/\s+/);
  const key = `${tier} ${code}`;
  const intact = `/Lotus/Types/Game/Projections/${code}_intact`;
  const radiant = `/Lotus/Types/Game/Projections/${code}_radiant`;
  const rewards = [
    {
      name: reward.name,
      uniqueName: reward.uniqueName,
      rarity: "common",
      chance: 25.33,
      urlName: null,
      ducats: 15,
    },
  ];
  const db: RelicDatabase = {
    groups: {
      [key]: {
        key,
        name: key,
        tier,
        code,
        imageUrl: null,
        // Unvaulted on purpose: the badge has to say so rather than stay blank.
        vaulted: false,
        qualities: {
          intact: { uniqueName: intact, rewards },
          radiant: { uniqueName: radiant, rewards },
        },
      },
    },
    byUniqueName: {
      [intact]: { groupKey: key, quality: "intact" },
      [radiant]: { groupKey: key, quality: "radiant" },
    },
  };
  return { db, key, intact, radiant };
}

test("a drop source names the relic's vault state and how many are held", async () => {
  test.setTimeout(240_000);
  let harness: ElectronTestHarness | undefined;
  try {
    harness = await launchElectronTestHarness("wfh-drop-relics-", { inventory: { Suits: [] } });
    const page = harness.page;
    const reward = await readRewardWithRelicDrop(page);
    const relic = relicFixture(reward);

    writeHarnessInventory(harness, {
      Suits: [],
      LevelKeys: [
        { ItemType: relic.intact, ItemCount: 3 },
        { ItemType: relic.radiant, ItemCount: 2 },
      ],
    });
    await evaluateInMain(
      harness.app,
      ({ ipcMain }, payload) => {
        ipcMain.removeHandler(payload.channel);
        ipcMain.handle(payload.channel, () => payload.data);
      },
      { channel: DB_GET_RELIC_DATABASE, data: relic.db },
    );
    await page.reload();
    await setLayoutViewport(page, 1440, 900);
    await openView(page, "relics");

    // Reward row to component panel is the path a player takes from a missing
    // part, and that panel is where the drop sources are listed.
    await page.locator(".relic-compact-head").first().click();
    const rewardRows = page.locator(".relic-rewards-list");
    await expect(rewardRows).toBeVisible({ timeout: 30_000 });
    await rewardRows.locator("button").first().click();

    const panel = page.locator(".relic-reward-item-panel");
    // A prime part drops from dozens of relics and the list starts capped.
    const showAll = panel.locator("[data-drops-show-all]");
    await expect(panel.locator(".detail-acquisition")).toBeVisible({ timeout: 30_000 });
    if (await showAll.count()) await showAll.click();
    const row = panel.locator(".detail-acquisition button", { hasText: relic.key }).first();
    await expect(row).toBeVisible({ timeout: 30_000 });

    // Unvaulted reads as U, and only the refinements actually held get a chip.
    await expect(row.locator("[data-relic-vault]")).toHaveAttribute(
      "data-relic-vault",
      "unvaulted",
    );
    await expect(row.locator('[data-relic-owned="intact"]')).toHaveText(/3/);
    await expect(row.locator('[data-relic-owned="radiant"]')).toHaveText(/2/);
    await expect(row.locator('[data-relic-owned="exceptional"]')).toHaveCount(0);
    await expect(row.locator('[data-relic-owned="flawless"]')).toHaveCount(0);
    const chips = await row.locator("[data-relic-owned]").allInnerTexts();
    expect(chips.join(" ")).not.toContain("relics.qualityShort.");

    await row.scrollIntoViewIfNeeded();
    await panel.screenshot({
      animations: "disabled",
      path: test.info().outputPath("drop-source-relics.png"),
    });

    // The popover behind the row repeats both, and no longer calls a relic the
    // player does not own vaulted.
    await row.click();
    const popover = panel.locator("[data-relic-popover-vault]");
    await expect(popover).toHaveAttribute("data-relic-popover-vault", "unvaulted");
    await popover.scrollIntoViewIfNeeded();
    await panel.screenshot({
      animations: "disabled",
      path: test.info().outputPath("drop-source-relics-popover.png"),
    });
  } finally {
    await closeElectronTestHarness(harness);
  }
});
