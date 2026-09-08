import { expect, test } from "@playwright/test";

import {
  closeElectronTestHarness,
  evaluateInMain,
  launchElectronTestHarness,
  openView,
  setLayoutViewport,
  type ElectronTestHarness,
} from "./electronTestHarness";

const ranks = [undefined, 4, 8];
const inventory = {
  Suits: [],
  Upgrades: ranks.map((rank, index) => ({
    ItemId: { $oid: `aaaaaaaaaaaaaaaaaaaaaaa${index}` },
    ItemType: "/Lotus/Upgrades/Mods/Randomized/LotusRifleRandomModRare",
    UpgradeFingerprint: JSON.stringify({
      compat: "/Lotus/Weapons/Tenno/Rifle/Rifle",
      lvl: rank,
      lvlReq: 9,
      pol: "AP_ATTACK",
      buffs: [
        { Tag: "WeaponCritChanceMod", Value: 600_000_000 },
        { Tag: "WeaponFireDamageMod", Value: 700_000_000 },
      ],
      curses: [],
    }),
  })),
};

test("inventory riven cards and details keep omitted, partial and max ranks distinct", async () => {
  test.setTimeout(180_000);
  let harness: ElectronTestHarness | undefined;
  const errors: string[] = [];
  try {
    harness = await launchElectronTestHarness("wfh-riven-ranks-", {
      inventory,
      onPage: (page) => {
        page.on("pageerror", (error) => errors.push(error.message));
      },
    });
    const { page } = harness;
    await evaluateInMain(harness.app, ({ app, ipcMain }) => {
      const load = process
        .getBuiltinModule("module")
        .createRequire(`${app.getAppPath()}/.electron-build/main.js`);
      const client = load("./services/wfmClient.js") as {
        request: (
          method: string,
          path: string,
          options?: { json?: Record<string, unknown> },
        ) => Promise<unknown>;
      };
      const state = globalThis as typeof globalThis & {
        rankFixtureBodies: Record<string, unknown>[];
      };
      state.rankFixtureBodies = [];
      client.request = async (method, path, options) => {
        if (method === "POST" && path === "/auctions/create") {
          state.rankFixtureBodies.push(options?.json ?? {});
          if (state.rankFixtureBodies.length === 1) throw new Error("Fixture listing failure");
          return { payload: { auction: { id: "fixture" } } };
        }
        return { payload: { auctions: [] } };
      };
      ipcMain.removeHandler("wfm:session");
      ipcMain.handle("wfm:session", () => ({
        loggedIn: true,
        userName: "Fixture",
        platform: "pc",
      }));
    });
    await setLayoutViewport(page, 1440, 900);
    await openView(page, "rivens");
    await expect(page.locator("[data-riven-card]")).toHaveCount(3);
    for (const [index, rank] of ranks.entries()) {
      const card = page.locator(`[data-riven-card="aaaaaaaaaaaaaaaaaaaaaaa${index}"]`);
      await expect(card.locator("span.bg-riven-pip")).toHaveCount(rank ?? 0);
      await card.locator("button").first().click();
      await expect(page.locator("[data-riven-detail-rank]")).toHaveAttribute(
        "data-riven-detail-rank",
        String(rank ?? 0),
      );
      const listingRank = page.locator("[data-riven-listing-rank]");
      await expect(listingRank).toHaveValue(String(rank ?? 0));
      await expect(listingRank.locator("option:not([disabled])")).toHaveCount(9);
      const selectedRank = index === 2 ? 2 : index === 1 ? 8 : 0;
      await listingRank.selectOption(String(selectedRank));
      await page.locator("[data-riven-listing-price]").fill("100");
      await page.locator("[data-riven-listing-submit]").click();
      if (index === 0) {
        await expect(page.locator("[data-riven-listing-error]")).toContainText(
          "Fixture listing failure",
        );
        await expect(page.locator("[data-riven-listing-submit]")).toBeEnabled();
        await page.locator("[data-riven-listing-submit]").click();
        await expect(page.locator("[data-riven-listing-error]")).toHaveCount(0);
      }
      await expect(page.locator("[data-riven-listing-submit]")).toBeEnabled();
      const body = await evaluateInMain(harness.app, () => {
        return (
          globalThis as typeof globalThis & { rankFixtureBodies: Record<string, unknown>[] }
        ).rankFixtureBodies.at(-1);
      });
      expect(body).toMatchObject({ item: { mod_rank: selectedRank }, buyout_price: 100 });
      const values = await evaluateInMain(
        harness.app,
        ({ app }, fixture) => {
          const load = process
            .getBuiltinModule("module")
            .createRequire(`${app.getAppPath()}/.electron-build/main.js`);
          const decoder = load("./services/rivenFingerprint.js") as {
            decodeAllRivens: (inventory: unknown) => {
              unveiled: { stats: { rankValues: number[] }[] }[];
            };
          };
          return decoder
            .decodeAllRivens(fixture.inventory)
            .unveiled[0].stats.map((stat) => stat.rankValues[fixture.rank]);
        },
        { inventory, rank: selectedRank },
      );
      expect(
        (body?.item as { attributes: { value: number }[] }).attributes.map((stat) => stat.value),
      ).toEqual(values);
      if (index === 0) {
        await page.screenshot({
          animations: "disabled",
          path: test.info().outputPath("riven-unranked-detail.png"),
        });
      }
      await page.keyboard.press("Escape");
      await expect(page.locator("[data-riven-detail-rank]")).toHaveCount(0);
    }
    await page.screenshot({
      animations: "disabled",
      path: test.info().outputPath("riven-distinct-ranks.png"),
    });
    expect(errors).toEqual([]);
  } finally {
    if (harness) await closeElectronTestHarness(harness);
  }
});
