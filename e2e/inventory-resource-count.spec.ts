import { test, expect } from "@playwright/test";

import {
  closeElectronTestHarness,
  launchElectronTestHarness,
  type ElectronTestHarness,
} from "./electronTestHarness";

const VOID_TRACES = "/Lotus/Types/Items/MiscItems/VoidTearDrop";
const NEURODES = "/Lotus/Types/Items/MiscItems/Neurode";

test.describe("Resource counts", () => {
  test.setTimeout(180_000);

  let harness: ElectronTestHarness | undefined;

  test.beforeAll(async () => {
    harness = await launchElectronTestHarness("wfh-resource-count-", {
      inventory: {
        Suits: [],
        MiscItems: [
          { ItemType: VOID_TRACES, ItemCount: 1234 },
          { ItemType: NEURODES, ItemCount: 42 },
        ],
      },
    });
    await harness.page.locator('#sidebar [data-view="inventory"]').click();
    await harness.page.locator('#content [data-tour-tab="resources"]').click();
    await expect(harness.page.locator(".resource-card").first()).toBeVisible({ timeout: 90_000 });
  });

  test.afterAll(async () => {
    await closeElectronTestHarness(harness);
  });

  test("a four-digit resource count is exact, not rounded to the hundred", async () => {
    const page = harness!.page;
    const rows = page.locator(".resource-card");
    const names = await rows.locator(".resource-name").allTextContents();
    const counts = await rows.locator(".resource-count").allTextContents();
    const traces = counts[names.findIndex((name) => name === "Void Traces")];

    expect(traces).toBe("1,234");
    expect(traces).not.toMatch(/K$/);
  });
});
