import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  INVENTORY_GET_STATUS,
  INVENTORY_STATUS_UPDATED,
  PROFILE_ACCOUNT_CHANGED,
} from "../config/shared/ipcChannels";
import type { PersonalProfileResult } from "../config/shared/personalProfile";
import {
  closeElectronTestHarness,
  evaluateInMain,
  launchElectronTestHarness,
  openView,
  setLayoutViewport,
  type ElectronTestHarness,
} from "./electronTestHarness";

const account = "a".repeat(24);
const suit = "b".repeat(24);
const gun = "c".repeat(24);
const upgrade = "d".repeat(24);
const missing = "e".repeat(24);
interface LoadoutFixtureMain {
  releaseLoadoutRefresh?: () => void;
}
const inventory = {
  Suits: [
    {
      ItemId: { $oid: suit },
      ItemType: "/Lotus/Powersuits/FixtureWarframe",
      Configs: [
        { Name: "Crimson", Skins: [], pricol: { t0: 0xff990000 }, Upgrades: [] },
        { Name: "Azure", Skins: [], pricol: { t0: 0xff000099 }, Upgrades: [upgrade, "", missing] },
      ],
    },
  ],
  LongGuns: [
    {
      ItemId: { $oid: gun },
      ItemType: "/Lotus/Weapons/FixturePrimary",
      Configs: [{ Skins: [], Upgrades: ["/Lotus/Upgrades/Mods/DirectFixture"] }],
    },
  ],
  Upgrades: [
    {
      ItemId: { $oid: upgrade },
      ItemType: "/Lotus/Upgrades/Mods/FixtureVitality",
      UpgradeFingerprint: '{"lvl":7}',
    },
  ],
  LoadOutPresets: {
    NORMAL: [
      {
        n: "Crimson fixture",
        s: { ItemId: { $oid: suit }, cus: 0, mod: 1 },
        l: { ItemId: { $oid: gun }, cus: 0, mod: 0 },
      },
      { n: "Azure fixture", s: { ItemId: { $oid: suit }, cus: 1, mod: 0 } },
    ],
  },
};

test("saved loadouts resolve gear and mods, switch configurations and hide on source changes", async () => {
  test.setTimeout(180_000);
  let harness: ElectronTestHarness | undefined;
  const errors: string[] = [];
  try {
    harness = await launchElectronTestHarness("wfh-personal-loadouts-", {
      inventory,
      userDataFiles: {
        "codex-profile.json": { accountId: account },
        "inventory-profile-binding.json": {
          accountId: account,
          hash: createHash("sha256").update(JSON.stringify(inventory)).digest("hex"),
        },
      },
      onPage: (page) => {
        page.on("pageerror", (error) => errors.push(error.message));
      },
    });
    const { app, page } = harness;
    await setLayoutViewport(page, 1200, 1000);
    await openView(page, "stats");
    await page.locator('[data-tour-tab="personal"]').click();
    const panel = page.locator("[data-personal-profile]");
    const selector = panel.locator("[data-profile-loadout]");
    await expect(selector).toHaveValue("0");
    await expect(selector.locator("option")).toHaveCount(2);
    await expect(panel.locator("[data-profile-source-warning]")).toHaveCount(0);
    await expect(panel.locator('[data-profile-config="0"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(panel.locator('[data-profile-mod-config="1"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(panel.locator("[data-profile-mod-slot]")).toHaveCount(2);
    await expect(panel.locator('[data-profile-mod-slot="0"]')).toContainText("Rank 7");
    await expect(panel.locator('[data-profile-mod-slot="2"]')).toContainText(
      "Unresolved mod or arcane",
    );
    await expect(panel.locator('[data-profile-slot-unavailable="Pistols"]')).toHaveCount(0);
    await page.screenshot({
      path: test.info().outputPath("saved-loadout-mods.png"),
      fullPage: true,
    });
    await panel.locator('[data-profile-config="1"]').click();
    await expect(panel.locator('[data-profile-mod-config="1"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await selector.selectOption("1");
    await expect(panel.locator('[data-profile-config="1"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(panel.locator('[data-profile-mod-config="0"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(panel.locator("[data-profile-mod-slot]")).toHaveCount(0);
    await panel.locator('[data-profile-config="0"]').click();
    await panel.locator('[data-profile-mod-config="1"]').click();
    await evaluateInMain(
      app,
      ({ app, BrowserWindow }, channel) => {
        const moduleApi = process.getBuiltinModule("module") as {
          createRequire: (filename: string) => (id: string) => unknown;
        };
        const load = moduleApi.createRequire(`${app.getAppPath()}/.electron-build/main.js`);
        const service = load("./services/codexProfile.js") as {
          getPersonalProfile: (refresh: boolean) => Promise<PersonalProfileResult>;
        };
        const original = service.getPersonalProfile;
        service.getPersonalProfile = (refresh) => {
          service.getPersonalProfile = original;
          return new Promise((resolve) => {
            (globalThis as unknown as LoadoutFixtureMain).releaseLoadoutRefresh = () => {
              void original(refresh).then(resolve);
            };
          });
        };
        for (const window of BrowserWindow.getAllWindows())
          window.webContents.send(channel, { source: "helper" });
      },
      INVENTORY_STATUS_UPDATED,
    );
    await expect(panel.locator("[data-profile-refresh]")).toBeDisabled();
    await expect(selector).toHaveValue("1");
    await evaluateInMain(app, () => {
      (globalThis as unknown as LoadoutFixtureMain).releaseLoadoutRefresh?.();
    });
    await expect(panel.locator("[data-profile-refresh]")).toBeEnabled();
    await expect(selector).toHaveValue("1");
    await expect(panel.locator('[data-profile-config="0"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(panel.locator('[data-profile-mod-config="1"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.screenshot({
      path: test.info().outputPath("saved-loadout-after-inventory-poll.png"),
    });
    await evaluateInMain(
      app,
      ({ BrowserWindow }, channel) => {
        for (const window of BrowserWindow.getAllWindows()) window.webContents.send(channel);
      },
      PROFILE_ACCOUNT_CHANGED,
    );
    await expect(selector).toHaveValue("0");
    await expect(panel.locator('[data-profile-config="0"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await selector.selectOption("1");
    await evaluateInMain(
      app,
      ({ app, BrowserWindow }, channel) => {
        const moduleApi = process.getBuiltinModule("module") as {
          createRequire: (filename: string) => (id: string) => unknown;
        };
        const load = moduleApi.createRequire(`${app.getAppPath()}/.electron-build/main.js`);
        const service = load("./services/personalLoadouts.js") as {
          parsePersonalLoadouts: (
            payload: unknown,
          ) => NonNullable<PersonalProfileResult["savedLoadouts"]>;
        };
        const original = service.parsePersonalLoadouts;
        service.parsePersonalLoadouts = (payload) => original(payload).slice(0, 1);
        for (const window of BrowserWindow.getAllWindows())
          window.webContents.send(channel, { source: "helper" });
      },
      INVENTORY_STATUS_UPDATED,
    );
    await expect(selector.locator("option")).toHaveCount(1);
    await expect(selector).toHaveValue("0");
    await selector.selectOption("0");
    await panel.locator('[data-profile-appearance-item="LongGuns"]').click();
    await expect(panel.locator("[data-profile-mod-slot]")).toHaveCount(1);
    await expect(panel.locator("[data-profile-mod-slot]")).toContainText("Rank not reported");
    await setLayoutViewport(page, 800, 1000);
    await page.screenshot({
      path: test.info().outputPath("saved-loadout-weapon-narrow.png"),
      fullPage: true,
    });
    for (const source of ["none", "manual"] as const) {
      await evaluateInMain(
        app,
        ({ app, BrowserWindow }, { source, channel }) => {
          const moduleApi = process.getBuiltinModule("module") as {
            createRequire: (filename: string) => (id: string) => unknown;
          };
          const load = moduleApi.createRequire(`${app.getAppPath()}/.electron-build/main.js`);
          const inventoryIpc = load("./ipc/inventoryIpc.js") as {
            getInventorySource: () => string;
          };
          inventoryIpc.getInventorySource = () => source;
          for (const window of BrowserWindow.getAllWindows())
            window.webContents.send(channel, { source });
        },
        { source, channel: INVENTORY_STATUS_UPDATED },
      );
      await expect(selector).toHaveCount(0);
      await expect(panel.locator("[data-profile-source-warning]")).toHaveCount(
        source === "manual" ? 1 : 0,
      );
    }
    expect(errors).toEqual([]);
  } finally {
    await closeElectronTestHarness(harness);
  }
});

test("Mastery distinguishes source none from a cold renderer awaiting inventory", async () => {
  let harness: ElectronTestHarness | undefined;
  const errors: string[] = [];
  try {
    harness = await launchElectronTestHarness("wfh-source-none-", {
      userDataFiles: { "inventory-reload-state.json": { inventorySource: "none" } },
      onPage: (page) => {
        page.on("pageerror", (error) => errors.push(error.message));
      },
    });
    const { app, page } = harness;
    expect(await page.evaluate(() => window.api.getInventoryStatus())).toMatchObject({
      source: "none",
    });
    await openView(page, "mastery");
    const view = page.locator("#content .view.active");
    await expect(view.locator(".empty-state")).toHaveText("No inventory loaded");
    await expect(view.locator("[data-mastery-summary]")).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath("mastery-no-inventory.png") });
    await openView(page, "stats");
    await page.locator('[data-tour-tab="personal"]').click();
    await expect(page.locator("[data-personal-profile] .empty-state")).toBeVisible();
    expect(await page.evaluate(() => window.api.getPersonalProfile(false))).toMatchObject({
      inventorySource: "none",
      profile: null,
      savedLoadouts: [],
    });
    await expect(page.locator("[data-profile-source-warning]")).toHaveCount(0);
    await expect(page.locator("[data-profile-loadout]")).toHaveCount(0);
    await evaluateInMain(
      app,
      ({ ipcMain }, channel) => {
        ipcMain.removeHandler(channel);
        ipcMain.handle(channel, () => ({
          source: "helper",
          // A missing file opens setup; this fixture isolates the pending payload.
          found: true,
          path: "fixture-inventory.json",
          modifiedAt: null,
          lastError: null,
        }));
      },
      INVENTORY_GET_STATUS,
    );
    await page.reload();
    expect(await page.evaluate(() => window.api.getInventory())).toBeNull();
    await openView(page, "mastery");
    await expect(page.locator("#content .view.active .empty-state")).toHaveText(
      "Loading mastery data...",
    );
    await page.screenshot({ path: test.info().outputPath("mastery-awaiting-inventory.png") });
    expect(errors).toEqual([]);
  } finally {
    await closeElectronTestHarness(harness);
  }
});
