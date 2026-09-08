import { expect, test, type Page } from "@playwright/test";

import { DB_GET_WORLD_STATE, INVENTORY_UPDATED } from "../config/shared/ipcChannels";
import { NIGHTWAVE_PERMANENT_SHOP } from "../config/shared/nightwaveShop";
import type { WorldState } from "../src/types/world";
import {
  closeElectronTestHarness,
  evaluateInMain,
  launchElectronTestHarness,
  openView,
  setLayoutViewport,
  type ElectronTestHarness,
} from "./electronTestHarness";

interface FixtureMain {
  overviewWorld: WorldState;
}

function buildWorld(now: number): WorldState {
  const expiry = new Date(now + 4 * 86_400_000).toISOString();
  return {
    archonHunt: {
      id: "overview-archon",
      boss: "Archon Boreal",
      activation: new Date(now - 86_400_000).toISOString(),
      expiry,
      missions: [],
    },
    duviriCycle: {
      expiry,
      choices: [
        { category: "normal", choices: ["Excalibur", "Trinity", "Ember"] },
        { category: "hard", choices: ["Braton", "Lato", "Skana", "Paris", "Kunai"] },
      ],
    },
    steelPath: {
      currentReward: { name: "Umbra Forma", cost: 150 },
      expiry,
      rotation: [],
      evergreens: [],
    },
    nightwave: {
      activation: new Date(now - 86_400_000).toISOString(),
      expiry,
      season: 18,
      phase: 0,
      affiliationTag: NIGHTWAVE_PERMANENT_SHOP.seasonAffiliationTag,
      challenges: [],
    },
  };
}

// page.route reaches Electron as status 0, so the backend answer is patched into fetch.
async function mockNightwaveOfferings(
  page: Page,
  payload: { status: number; body: unknown },
): Promise<void> {
  await page.addInitScript((answer) => {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (new URL(url, location.href).pathname !== "/v1/nightwave-offerings")
        return nativeFetch(input, init);
      return Promise.resolve(
        new Response(JSON.stringify(answer.body), {
          status: answer.status,
          headers: { "content-type": "application/json" },
        }),
      );
    };
  }, payload);
}

const OFFERINGS_DOC = {
  ok: true,
  generatedAt: Date.parse("2026-09-08T10:00:00.000Z"),
  source: "wiki",
  tabs: [
    {
      name: "Auras",
      sections: [
        {
          name: "Auras",
          creds: 20,
          items: [
            { name: "Corrosive Projection", always: true, creds: 20 },
            { name: "Dead Eye", always: true, creds: 20 },
            { name: "Energy Siphon", always: true, creds: 20 },
            { name: "Physique", always: true, creds: 20 },
            { name: "Rejuvenation", always: true, creds: 20 },
          ],
        },
      ],
    },
    {
      name: "Weapon Skins",
      sections: [
        {
          name: "Weapon Skin Blueprints",
          creds: null,
          items: [
            { name: "Atomos Solstice Skin Blueprint", always: true, creds: 35 },
            { name: "Fragor Brokk Skin Blueprint", always: false, creds: 30 },
          ],
        },
        {
          name: "Weapon Skins",
          creds: null,
          items: [{ name: "Cedo Daybreak Skin", always: true, creds: 50 }],
        },
      ],
    },
    {
      name: "Recovered Artifacts (Always Available)",
      sections: [
        {
          name: "Recovered Artifacts (Always Available)",
          creds: null,
          items: [
            { name: "5x Nitain Extract", always: true, creds: 15 },
            { name: "10,000x Kuva", always: true, creds: 50 },
            { name: "Orokin Catalyst (built)", always: true, creds: 75 },
            { name: "Nightwave Landing Craft Blueprint", always: true, creds: 35 },
          ],
        },
      ],
    },
  ],
};

test("Nightwave offerings render the wiki tabs, prices and always-available marks", async () => {
  test.setTimeout(180_000);
  const world = buildWorld(Date.now());
  let harness: ElectronTestHarness | undefined;
  const errors: string[] = [];
  try {
    harness = await launchElectronTestHarness("wfh-nightwave-offerings-", {
      inventory: { Suits: [] },
      storage: { "world-tab": "world" },
      onPage: async (page) => {
        page.on("pageerror", (error) => errors.push(error.message));
        await mockNightwaveOfferings(page, { status: 200, body: OFFERINGS_DOC });
      },
    });
    const { page, app } = harness;
    await evaluateInMain(
      app,
      ({ ipcMain }, fixture) => {
        const scope = globalThis as unknown as FixtureMain;
        scope.overviewWorld = fixture.world;
        ipcMain.removeHandler(fixture.channel);
        ipcMain.handle(fixture.channel, () => scope.overviewWorld);
      },
      { world, channel: DB_GET_WORLD_STATE },
    );
    await setLayoutViewport(page, 1440, 1100);
    await openView(page, "world");

    const shop = page.locator("[data-nightwave-shop]");
    await expect(shop.locator("[data-nightwave-tab]")).toHaveCount(3);
    await expect(shop.locator("[data-nightwave-offer]")).toHaveCount(5);
    await expect(shop.locator('[data-nightwave-always="true"]')).toHaveCount(5);
    await expect(shop.locator('[data-nightwave-section="Auras"]')).toBeVisible();
    await expect(shop.locator('[data-nightwave-cost-verified="false"]')).toHaveCount(0);
    await shop.screenshot({
      path: test.info().outputPath("nightwave-offerings-auras.png"),
      animations: "disabled",
    });

    await shop.locator('[data-nightwave-tab="Weapon Skins"]').click();
    await expect(shop.locator("[data-nightwave-section]")).toHaveCount(2);
    await expect(shop.locator("[data-nightwave-offer]")).toHaveCount(3);
    await expect(shop.locator('[data-nightwave-always="true"]')).toHaveCount(2);
    await shop.screenshot({
      path: test.info().outputPath("nightwave-offerings-skins.png"),
      animations: "disabled",
    });

    await shop.locator("[data-nightwave-search]").fill("Cedo");
    await expect(shop.locator("[data-nightwave-offer]")).toHaveCount(1);
    await expect(shop.locator("[data-nightwave-section]")).toHaveCount(1);
    await shop.locator("[data-nightwave-search]").fill("");
    await expect(shop.locator("[data-nightwave-offer]")).toHaveCount(3);

    await shop.locator('[data-nightwave-tab="Recovered Artifacts (Always Available)"]').click();
    await expect(shop.locator("[data-nightwave-offer]")).toHaveCount(4);
    await expect(
      shop.locator('[data-nightwave-offer="5x Nitain Extract"] [data-nightwave-quantity="5"]'),
    ).toBeVisible();
    await expect(
      shop.locator('[data-nightwave-offer="10,000x Kuva"] [data-nightwave-quantity="10000"]'),
    ).toBeVisible();
    await expect(shop.locator('[data-nightwave-always="true"]')).toHaveCount(4);
    await expect(shop.locator("[data-nightwave-rotation-unavailable]")).toBeVisible();

    await setLayoutViewport(page, 900, 900);
    await shop.scrollIntoViewIfNeeded();
    const overflow = await shop.evaluate(
      (element) => element.scrollWidth > element.clientWidth + 1,
    );
    expect(overflow).toBe(false);
    await shop.screenshot({
      path: test.info().outputPath("nightwave-offerings-narrow.png"),
      animations: "disabled",
    });
    expect(errors).toEqual([]);
  } finally {
    await closeElectronTestHarness(harness);
  }
});

test("World overview shares completion and scopes permanent Nightwave offers to the active season", async () => {
  test.setTimeout(180_000);
  const now = Date.now();
  const world = buildWorld(now);
  let harness: ElectronTestHarness | undefined;
  const errors: string[] = [];
  try {
    harness = await launchElectronTestHarness("wfh-world-overview-", {
      inventory: {
        Suits: [],
        LastLiteSortieReward: [{ SortieId: { $oid: "overview-archon" } }],
        EntratiVaultCountLastPeriod: 3,
        EntratiVaultCountResetDate: { $date: now + 4 * 86_400_000 },
      },
      storage: { "world-tab": "world" },
      onPage: async (page) => {
        page.on("pageerror", (error) => errors.push(error.message));
        // No published doc: the built-in permanent list has to carry the section.
        await mockNightwaveOfferings(page, {
          status: 404,
          body: { ok: false, error: "nightwave_offerings_not_ready" },
        });
      },
    });
    const { page, app } = harness;
    await evaluateInMain(
      app,
      ({ ipcMain }, fixture) => {
        const scope = globalThis as unknown as FixtureMain;
        scope.overviewWorld = fixture.world;
        ipcMain.removeHandler(fixture.channel);
        ipcMain.handle(fixture.channel, () => scope.overviewWorld);
      },
      { world, channel: DB_GET_WORLD_STATE },
    );
    await setLayoutViewport(page, 1440, 1100);
    await openView(page, "world");
    const overview = page.locator("[data-world-week-overview]");
    const shop = page.locator("[data-nightwave-shop]");
    await expect(overview).toBeVisible();
    await expect(overview.locator("h3")).toHaveText("This week");
    await expect(overview.locator("[data-world-week-task]")).toHaveCount(5);
    await expect(overview.locator('[data-world-week-task="archonHunt"]')).toHaveAttribute(
      "data-world-task-done",
      "true",
    );
    await expect(
      overview.locator('[data-world-week-task="netracells"] [data-world-task-progress]'),
    ).toHaveText("3/5");
    await expect(shop).toHaveAttribute("data-nightwave-season-verified", "true");
    await expect(shop.locator("[data-nightwave-tab]")).toHaveCount(0);
    await expect(shop.locator("[data-nightwave-offer]")).toHaveCount(83);
    await expect(shop.locator('[data-nightwave-cost-verified="false"]')).toHaveCount(4);
    await shop.locator("[data-nightwave-search]").fill("Corrosive Projection");
    await expect(shop.locator("[data-nightwave-offer]")).toHaveCount(1);
    await shop.locator("[data-nightwave-search]").fill("");
    await expect(shop.locator("[data-nightwave-rotation-unavailable]")).toBeVisible();
    await overview.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: test.info().outputPath("world-week-overview.png"),
      animations: "disabled",
    });
    await shop.screenshot({
      path: test.info().outputPath("nightwave-permanent-shop.png"),
      animations: "disabled",
    });

    await overview.locator("[data-world-open-dailies]").click();
    await expect(page.locator('[data-task="archonHunt"]')).toBeChecked();
    await page.locator('[data-task="circuitNormal"]').check();
    await page.locator('[data-tour-tab="world"]').click();
    await expect(overview.locator('[data-world-week-task="circuitNormal"]')).toHaveAttribute(
      "data-world-task-done",
      "true",
    );

    await page.locator('[data-layout-edit-toggle="world"]').click();
    await page.locator('[data-layout-move-up="world.nightwaveShop"]').click();
    await page.locator('[data-layout-hide="world.nightwaveShop"]').click();
    await expect(shop).toHaveCount(0);
    await page.locator('[data-layout-restore="world.nightwaveShop"]').click();
    await expect(shop).toBeVisible();
    await page.locator('[data-layout-edit-toggle="world"]').click();

    await evaluateInMain(
      app,
      ({ BrowserWindow }, channel) => {
        for (const win of BrowserWindow.getAllWindows()) {
          if (win.webContents.getURL().includes("renderer/dist/index.html"))
            win.webContents.send(channel, null);
        }
      },
      INVENTORY_UPDATED,
    );
    await expect(
      overview.locator('[data-world-week-task="netracells"] [data-world-task-progress]'),
    ).toHaveText("0/5");
    await expect(overview.locator('[data-world-week-task="circuitNormal"]')).toHaveAttribute(
      "data-world-task-done",
      "true",
    );

    await setLayoutViewport(page, 900, 900);
    await shop.scrollIntoViewIfNeeded();
    const overflow = await shop.evaluate(
      (element) => element.scrollWidth > element.clientWidth + 1,
    );
    expect(overflow).toBe(false);
    await shop.screenshot({
      path: test.info().outputPath("nightwave-permanent-narrow.png"),
      animations: "disabled",
    });

    for (const season of ["RadioLegionIntermission17Syndicate", null]) {
      await evaluateInMain(
        app,
        (_electron, tag) => {
          const scope = globalThis as unknown as FixtureMain;
          scope.overviewWorld = {
            ...scope.overviewWorld,
            nightwave:
              tag && scope.overviewWorld.nightwave
                ? { ...scope.overviewWorld.nightwave, affiliationTag: tag }
                : null,
          };
        },
        season,
      );
      await openView(page, "settings");
      await openView(page, "world");
      await expect(shop.locator("[data-nightwave-offer]")).toHaveCount(0);
      await expect(shop.locator("[data-nightwave-shop-unavailable]")).toBeVisible();
    }
    expect(errors).toEqual([]);
  } finally {
    await closeElectronTestHarness(harness);
  }
});
