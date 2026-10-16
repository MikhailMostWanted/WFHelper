import fs from "node:fs/promises";
import path from "node:path";
import { test, expect } from "@playwright/test";
import {
  launchElectronTestHarness,
  closeElectronTestHarness,
  type ElectronTestHarness,
} from "./electronTestHarness";

const type = "/Lotus/Types/Gameplay/Events/RoadToTauEvent/RoadToTauEventResource";
let harness: ElectronTestHarness | undefined;
test.setTimeout(180_000);

test.afterEach(async () => {
  await closeElectronTestHarness(harness);
  harness = undefined;
});

test("event balances survive a stale catalogue and live inventory updates without inventing mission loot", async () => {
  harness = await launchElectronTestHarness("wfh-event-resources-", {
    inventory: { Suits: [], MiscItems: [{ ItemType: type, ItemCount: 111 }] },
    storage: { "app-language": "ru" },
  });
  const page = harness.page;
  await page.locator('#sidebar [data-view="inventory"]').click();
  await page.locator('#content [data-tour-tab="resources"]').click();
  const panel = page.locator("[data-event-resources]");
  const card = panel.locator(`[data-event-resource="${type}"]`);
  await expect(card).toContainText("Лунная плоть", { timeout: 60_000 });
  await expect(card.locator("[data-event-balance]")).toHaveText("111");
  await expect(card.locator("[data-event-delta]")).toHaveText("—");
  await expect(card).toContainText("Не подтверждено");
  await fs.writeFile(
    path.join(harness.helperDir, "inventory.json"),
    JSON.stringify({ Suits: [], MiscItems: [{ ItemType: type, ItemCount: 41 }] }),
    "utf8",
  );
  await expect(card.locator("[data-event-balance]")).toHaveText("41", { timeout: 30_000 });
  // The sandbox account is unbound, so it must not claim that 70 was spent by this owner.
  await expect(card.locator("[data-event-delta]")).toHaveText("—");
  await expect(panel).toContainText("траты");
  await page.locator('#sidebar [data-view="stats"]').click();
  await expect(page.locator("[data-stats-tracking] [data-event-balance]")).toHaveText("41");
});
