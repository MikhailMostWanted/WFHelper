import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { test, expect } from "@playwright/test";
import {
  closeElectronTestHarness,
  launchElectronTestHarness,
  openView,
} from "./electronTestHarness";

const inventory = { Suits: [] };
test.setTimeout(180_000);

test("an unreadable update keeps the previous file and recovers on the next valid write", async () => {
  const harness = await launchElectronTestHarness("wfh-inventory-freshness-", { inventory });
  try {
    const file = path.join(harness.helperDir, "inventory.json");
    await openView(harness.page, "inventory");
    const status = harness.page.locator("[data-inventory-source-status]");
    await expect(status).toHaveAttribute("data-state", "loaded");
    const old = new Date(Date.now() - 2 * 60 * 60 * 1_000);
    await fs.utimes(file, old, old);
    await expect(status).toHaveAttribute("data-state", "old");
    const oldTimestamp = await status.locator("time").getAttribute("datetime");

    await fs.writeFile(file, "{");
    await expect(status).toHaveAttribute("data-state", "invalid");
    await expect(status).toContainText("Showing the last readable file");
    await expect(status.locator("time")).toHaveAttribute("datetime", oldTimestamp!);

    await fs.unlink(file);
    await expect(status).toHaveAttribute("data-state", "missing");
    await fs.writeFile(file, JSON.stringify(inventory));
    await expect(status).toHaveAttribute("data-state", "loaded");
    await expect(status.locator("time")).not.toHaveAttribute("datetime", oldTimestamp!);
  } finally {
    await closeElectronTestHarness(harness);
  }
});

test("a missing manual source stays selected until its file returns", async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "wfh-inventory-selected-"));
  const selected = path.join(folder, "picked.json");
  let harness: Awaited<ReturnType<typeof launchElectronTestHarness>> | undefined;
  try {
    harness = await launchElectronTestHarness("wfh-inventory-manual-", {
      inventory,
      userDataFiles: {
        "inventory-reload-state.json": { inventoryPath: selected, inventorySource: "manual" },
      },
    });
    await openView(harness.page, "inventory");
    const status = harness.page.locator("[data-inventory-source-status]");
    await expect(status).toHaveAttribute("data-state", "missing");
    await expect(status).toContainText("picked.json");
    await expect(status.locator("time")).toHaveCount(0);

    await fs.writeFile(selected, JSON.stringify(inventory));
    await expect(status).toHaveAttribute("data-state", "loaded");
    await expect(status).toContainText("picked.json");
  } finally {
    await closeElectronTestHarness(harness);
    await fs.rm(folder, { recursive: true, force: true });
  }
});
