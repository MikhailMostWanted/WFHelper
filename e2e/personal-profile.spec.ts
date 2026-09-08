import fs from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { INVENTORY_UPDATED, PERSONAL_PROFILE_GET } from "../config/shared/ipcChannels";
import type { PersonalProfile, PersonalProfileResult } from "../config/shared/personalProfile";
import {
  closeElectronTestHarness,
  evaluateInMain,
  launchElectronTestHarness,
  openView,
  setLayoutViewport,
  type ElectronTestHarness,
} from "./electronTestHarness";

const accountA = "a".repeat(24);
const accountB = "b".repeat(24);
const fixture: PersonalProfile = {
  displayName: "Profile Fixture A",
  masteryRank: 12,
  registeredAt: 1700000000000,
  career: {
    TimePlayedSec: 7200,
    Income: 0,
    MissionsCompleted: 42,
    CiphersSolved: 4,
    CipherTime: 20,
  },
  equipment: Array.from({ length: 55 }, (_, index) => ({
    type: `/Fixture/Equipment/TestWeapon${String(index).padStart(2, "0")}`,
    equipTime: index * 3600,
    kills: index,
    xp: index * 100,
  })),
  enemies: [],
  abilities: null,
  missions: [],
  appearance: [
    {
      category: "Suits",
      type: "/Fixture/Suits/TestWarframe",
      activeConfig: 1,
      configs: [
        {
          name: "First look",
          skins: [{ slot: 0, type: "/Fixture/Cosmetics/FirstHelmet" }],
          colors: { pricol: { t0: "#112233ff", en: "#12345680" } },
        },
        {
          name: "Active look",
          skins: [{ slot: 7, type: "/Fixture/Cosmetics/SecondSkin" }],
          colors: { pricol: { t0: "#abcdefFF" }, attcol: { t0: "#00000000" } },
        },
      ],
    },
  ],
};

interface ProfileTestMain {
  profileRefreshes: number;
  releaseProfileRefresh?: () => void;
}

test("personal profile renders cached data and follows refresh failures and account changes", async () => {
  test.setTimeout(180_000);
  const testInfo = test.info();
  const pageErrors: string[] = [];
  let harness: ElectronTestHarness | undefined;
  const fetchedAt = Date.now() - 120_000;
  try {
    harness = await launchElectronTestHarness("wfh-personal-profile-", {
      userDataFiles: {
        "codex-profile.json": { accountId: accountA },
        "personal-profile.json": { accountId: accountA, fetchedAt, profile: fixture },
      },
      onPage: (page) => {
        page.on("pageerror", (error) => pageErrors.push(error.message));
      },
    });
    const { app, page } = harness;
    await setLayoutViewport(page, 1440, 1000);
    await openView(page, "stats");
    const stats = page.locator("#content .view.active");
    await expect(stats.locator('[data-tour-tab="tracking"][data-active]')).toBeVisible();
    await expect(page.locator("[data-personal-profile]")).toHaveCount(0);
    const header = stats.locator("[data-stats-header]");
    const trackingTitle = await header.locator("h2").boundingBox();
    const trackingTabs = await header.locator('[data-tour-tab="personal"]').boundingBox();
    await page.screenshot({ path: testInfo.outputPath("stats-tracking-header.png") });
    await stats.locator('[data-tour-tab="personal"]').click();
    expect(await header.locator("h2").boundingBox()).toEqual(trackingTitle);
    expect(await header.locator('[data-tour-tab="personal"]').boundingBox()).toEqual(trackingTabs);
    const panel = page.locator("[data-personal-profile]");
    await expect(panel.locator("[data-profile-name]")).toHaveText(fixture.displayName!);
    const income = panel.locator('[data-profile-career="Income"]');
    const deaths = panel.locator('[data-profile-career="Deaths"]');
    await expect(income.locator("span").last()).toHaveText("0");
    await expect(deaths.locator("span").last()).toHaveText("Not reported");
    await expect(panel.locator('[data-profile-career="TimePlayedSec"]')).toContainText("2 h");
    await expect(panel.locator("[data-profile-name]")).toHaveCSS(
      "font-family",
      "Barlow, sans-serif",
    );
    const strip = panel.locator('[data-summary-strip="grid"]');
    const inspectGrid = () =>
      strip.evaluate((grid) => {
        const bounds = grid.getBoundingClientRect();
        const cells = Array.from(grid.querySelectorAll<HTMLElement>("[data-summary-item]"));
        return {
          overflow: getComputedStyle(grid).overflow,
          rowGap: Number.parseFloat(getComputedStyle(grid).rowGap),
          rows: new Set(cells.map((cell) => cell.offsetTop)).size,
          withinWidth: cells.every(
            (cell) => cell.getBoundingClientRect().right <= bounds.right + 1,
          ),
          dividers: cells.map((cell) => {
            const before = getComputedStyle(cell, "::before");
            const after = getComputedStyle(cell, "::after");
            return {
              width: before.width,
              left: before.left,
              color: before.backgroundColor,
              alignment: getComputedStyle(cell).textAlign,
              paddingLeft: getComputedStyle(cell).paddingLeft,
              paddingRight: getComputedStyle(cell).paddingRight,
              height: after.height,
              top: after.top,
            };
          }),
        };
      });
    const wideGrid = await inspectGrid();
    expect(wideGrid.rows).toBe(1);
    expect(wideGrid.overflow).toBe("hidden");
    expect(wideGrid.withinWidth).toBe(true);
    for (const divider of wideGrid.dividers) {
      expect(divider.alignment).toBe("center");
      expect(divider.paddingLeft).toBe(divider.paddingRight);
      expect(divider.width).toBe("1px");
      expect(divider.left).toBe("-1px");
      expect(divider.color).not.toBe("rgba(0, 0, 0, 0)");
      expect(divider.height).toBe("1px");
      expect(Number.parseFloat(divider.top)).toBeCloseTo(-wideGrid.rowGap / 2, 1);
    }
    await page.screenshot({ path: testInfo.outputPath("personal-career.png") });
    await setLayoutViewport(page, 800, 1000);
    await expect.poll(async () => (await inspectGrid()).rows).toBeGreaterThan(1);
    expect((await inspectGrid()).withinWidth).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("personal-career-narrow.png") });
    const narrowTitle = await header.locator("h2").boundingBox();
    const narrowTabs = await header.locator('[data-tour-tab="personal"]').boundingBox();
    await stats.locator('[data-tour-tab="tracking"]').click();
    expect(await header.locator("h2").boundingBox()).toEqual(narrowTitle);
    expect(await header.locator('[data-tour-tab="personal"]').boundingBox()).toEqual(narrowTabs);
    await page.screenshot({ path: testInfo.outputPath("stats-tracking-header-narrow.png") });
    await stats.locator('[data-tour-tab="personal"]').click();
    await setLayoutViewport(page, 1440, 1000);

    await panel.locator('[data-profile-section="equipment"]').click();
    const table = panel.locator('[data-profile-table="equipment"]');
    const rows = table.locator("[data-profile-row]");
    await expect(rows).toHaveCount(50);
    await expect(panel.locator("[data-profile-previous]")).toBeDisabled();
    await panel.locator("[data-profile-next]").click();
    await expect(rows).toHaveCount(5);
    await expect(panel.locator("[data-profile-next]")).toBeDisabled();
    await panel.locator("[data-profile-previous]").click();
    await table.locator('[data-profile-sort="kills"]').click();
    await expect(rows.first()).toHaveAttribute("data-profile-row", fixture.equipment![54].type);
    await table.locator('[data-profile-sort="kills"]').click();
    await expect(rows.first()).toHaveAttribute("data-profile-row", fixture.equipment![0].type);
    await expect(rows.first().locator("td").nth(2)).toHaveText("0");
    await expect(rows.first().locator("td").nth(3)).toHaveText("Not reported");
    const search = panel.locator("input[data-search-focus]");
    await search.fill("Test Weapon54");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveAttribute("data-profile-row", fixture.equipment![54].type);
    await search.fill("");
    await expect(rows).toHaveCount(50);
    await page.screenshot({ path: testInfo.outputPath("personal-equipment.png") });

    await panel.locator('[data-profile-section="appearance"]').click();
    await expect(panel.locator('[data-profile-config="1"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(panel.locator('[data-profile-cosmetic-slot="7"]')).toContainText("Second Skin");
    const primary = panel.locator('[data-profile-color="pricol-t0"]');
    await expect(primary.locator("code")).toHaveText("#abcdefff");
    await expect(primary.locator('[aria-hidden="true"]')).toHaveCSS(
      "background-color",
      "rgb(171, 205, 239)",
    );
    await expect(panel.locator('[data-profile-color="attcol-t0"] code')).toHaveText("#00000000");
    await panel.locator('[data-profile-config="0"]').click();
    await expect(panel.locator('[data-profile-cosmetic-slot="0"]')).toContainText("First Helmet");
    await expect(panel.locator('[data-profile-cosmetic-slot="7"]')).toHaveCount(0);
    await expect(primary.locator("code")).toHaveText("#112233ff");
    await expect(panel.locator('[data-profile-color="pricol-en"] code')).toHaveText("#12345680");
    await page.screenshot({ path: testInfo.outputPath("personal-appearance.png") });

    await openView(page, "settings");
    await openView(page, "stats");
    await expect(stats.locator('[data-tour-tab="personal"][data-active]')).toBeVisible();
    await expect(panel.locator("[data-profile-name]")).toHaveText(fixture.displayName!);

    await evaluateInMain(
      app,
      ({ app, ipcMain }, channel) => {
        const moduleApi = process.getBuiltinModule("module") as {
          createRequire: (filename: string) => (id: string) => unknown;
        };
        const load = moduleApi.createRequire(`${app.getAppPath()}/.electron-build/main.js`);
        const service = load("./services/codexProfile.js") as {
          getPersonalProfile: (refresh: boolean) => Promise<PersonalProfileResult>;
        };
        const scope = globalThis as unknown as ProfileTestMain;
        scope.profileRefreshes = 0;
        ipcMain.removeHandler(channel);
        ipcMain.handle(channel, async (_event, force: unknown) => {
          const cached = await service.getPersonalProfile(false);
          if (force !== true) return cached;
          scope.profileRefreshes += 1;
          if (scope.profileRefreshes === 1)
            return { ...cached, status: "fetch-failed", nextRefreshAt: 0 };
          await new Promise<void>((resolve) => {
            scope.releaseProfileRefresh = resolve;
          });
          return cached;
        });
      },
      PERSONAL_PROFILE_GET,
    );

    await panel.locator("[data-profile-refresh]").click();
    await expect(panel.locator("[data-profile-status]")).toContainText(
      "Showing the last saved data",
    );
    await expect(panel.locator("[data-profile-name]")).toHaveText(fixture.displayName!);
    await panel.locator('[data-profile-section="career"]').click();
    await expect(income.locator("span").last()).toHaveText("0");
    const cached = await page.evaluate(() => window.api.getPersonalProfile(false));
    expect(cached.fetchedAt).toBe(fetchedAt);

    await panel.locator("[data-profile-refresh]").click();
    await expect(panel.locator("[data-profile-refresh]")).toBeDisabled();
    await expect
      .poll(() =>
        evaluateInMain(
          app,
          () => typeof (globalThis as unknown as ProfileTestMain).releaseProfileRefresh,
        ),
      )
      .toBe("function");
    fs.writeFileSync(
      path.join(harness.sandboxDir, "user-data", "personal-profile.json"),
      JSON.stringify({
        accountId: accountB,
        fetchedAt,
        profile: { ...fixture, displayName: "Profile Fixture B", career: { Income: 123 } },
      }),
    );
    await page.evaluate(() => {
      const scope = window as unknown as { profileInventoryEvent: Promise<void> };
      scope.profileInventoryEvent = new Promise<void>((resolve) => {
        const unsubscribe = window.api.onInventoryUpdated(() => {
          unsubscribe();
          resolve();
        });
      });
    });
    await evaluateInMain(
      app,
      ({ app, BrowserWindow }, { accountId, channel }) => {
        const moduleApi = process.getBuiltinModule("module") as {
          createRequire: (filename: string) => (id: string) => unknown;
        };
        const load = moduleApi.createRequire(`${app.getAppPath()}/.electron-build/main.js`);
        const service = load("./services/codexProfile.js") as {
          noteAuthz: (authz: string) => void;
        };
        service.noteAuthz(`?accountId=${accountId}&nonce=1`);
        for (const win of BrowserWindow.getAllWindows()) {
          if (win.webContents.getURL().includes("renderer/dist/index.html")) {
            win.webContents.send(channel, { Suits: [] });
          }
        }
      },
      { accountId: accountB, channel: INVENTORY_UPDATED },
    );
    await page.evaluate(
      () => (window as unknown as { profileInventoryEvent: Promise<void> }).profileInventoryEvent,
    );
    await evaluateInMain(app, () => {
      (globalThis as unknown as ProfileTestMain).releaseProfileRefresh!();
    });
    await expect(panel.locator("[data-profile-name]")).toHaveText("Profile Fixture B");
    await expect(income.locator("span").last()).toHaveText("123");
    await expect(panel.locator("[data-profile-status]")).toHaveCount(0);
    expect(
      await evaluateInMain(app, () => (globalThis as unknown as ProfileTestMain).profileRefreshes),
    ).toBe(2);
    expect(pageErrors).toEqual([]);
  } finally {
    await closeElectronTestHarness(harness);
  }
});
