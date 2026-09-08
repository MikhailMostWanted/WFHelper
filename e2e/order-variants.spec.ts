import { expect, test } from "@playwright/test";
import {
  closeElectronTestHarness,
  evaluateInMain,
  launchElectronTestHarness,
  setLayoutViewport,
  type ElectronTestHarness,
} from "./electronTestHarness";

test("mod variants survive create and edit, and stale item details cannot change the next item", async () => {
  test.setTimeout(180_000);
  let harness: ElectronTestHarness | undefined;
  try {
    harness = await launchElectronTestHarness("wfh-order-variants-");
    const { app, page } = harness;
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      const originalFetch = window.fetch;
      window.fetch = async (input, init) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (!url.startsWith("https://api.warframe.market/")) return originalFetch(input, init);
        const data = url.includes("/orders/item/")
          ? [
              {
                type: "sell",
                platinum: 80,
                quantity: 2,
                rank: 10,
                subtype: "regular",
                user: { ingameName: "RegularSeller", status: "ingame" },
              },
              {
                type: "sell",
                platinum: 150,
                quantity: 2,
                rank: 10,
                subtype: "atragraph",
                user: { ingameName: "FoilSeller", status: "ingame" },
              },
            ]
          : { subtypes: ["regular", "atragraph"], tradingTax: 8000 };
        return new Response(JSON.stringify({ data }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      };
    });
    await evaluateInMain(app, ({ app, ipcMain }) => {
      const load = process
        .getBuiltinModule("module")
        .createRequire(`${app.getAppPath()}/.electron-build/main.js`);
      const client = load("./services/wfmClient.js") as {
        requestV2: (
          method: string,
          path: string,
          options?: { json?: Record<string, unknown> },
        ) => Promise<unknown>;
      };
      const items = [
        {
          id: "675c61ff7b18977f6e645418",
          slug: "spectral_serration",
          item_name: "Spectral Serration",
          maxRank: 10,
          subtypes: ["regular", "atragraph"],
        },
        {
          id: "675c61ff7b18977f6e645419",
          slug: "slow_mod",
          item_name: "Slow Mod",
          maxRank: 10,
          subtypes: ["regular", "atragraph"],
        },
        {
          id: "675c61ff7b18977f6e645420",
          slug: "forma_blueprint",
          item_name: "Forma Blueprint",
          maxRank: null,
          subtypes: [],
        },
        {
          id: "675c61ff7b18977f6e645421",
          slug: "offline_mod",
          item_name: "Offline Mod",
          maxRank: 10,
          subtypes: [],
        },
        {
          id: "675c61ff7b18977f6e645422",
          slug: "variant_only",
          item_name: "Variant Only",
          maxRank: null,
          subtypes: ["foil", "etched"],
        },
      ];
      let saved: Record<string, unknown> | null = null;
      client.requestV2 = async (method, path, options) => {
        if (method === "GET" && path.startsWith("/item/")) {
          const item = items.find((entry) => path === `/item/${entry.slug}`);
          if (item?.slug === "offline_mod") throw new Error("Fixture details unavailable");
          if (item?.slug === "slow_mod") await new Promise((resolve) => setTimeout(resolve, 1800));
          return { data: item };
        }
        if (method === "POST" && path === "/order") {
          const body = options?.json ?? {};
          const item = items.find((entry) => entry.id === body.itemId);
          saved = {
            id: "111111111111111111111111",
            orderType: body.type,
            platinum: body.platinum,
            quantity: body.quantity,
            modRank: body.rank,
            subtype: body.subtype,
            visible: true,
            itemId: body.itemId,
            itemName: item?.item_name,
            itemUrlName: item?.slug,
            itemThumb: null,
          };
          return { data: { id: saved.id, ...body } };
        }
        if (method === "PATCH" && saved) {
          Object.assign(saved, options?.json);
          return { data: saved };
        }
        throw new Error(`Unexpected fixture request ${method} ${path}`);
      };
      for (const channel of ["wfm:session", "wfm:search-items", "wfm:get-orders"])
        ipcMain.removeHandler(channel);
      ipcMain.handle("wfm:session", () => ({
        loggedIn: true,
        userName: "Fixture",
        platform: "pc",
      }));
      ipcMain.handle("wfm:search-items", (_event, payload: { query: string }) =>
        items
          .filter((item) => item.item_name.toLowerCase().includes(payload.query.toLowerCase()))
          .map((item) => ({ ...item, url_name: item.slug })),
      );
      ipcMain.handle("wfm:get-orders", () => ({ sell: saved ? [saved] : [], buy: [] }));
      ipcMain.removeHandler("get-wfm-items");
      ipcMain.handle("get-wfm-items", () =>
        Object.fromEntries(
          items.map((item) => [item.item_name.toLowerCase(), { ...item, url_name: item.slug }]),
        ),
      );
    });
    await page.reload();
    await setLayoutViewport(page, 1280, 900);
    await page.locator('#sidebar [data-view="market"]').click();
    await page.locator("[data-market-new-order]").click();
    await page.locator("#order-item-search").fill("Spectral");
    await page.locator('[data-order-item="spectral_serration"]').click();
    await expect(page.locator("[data-order-subtype]")).toHaveValue("regular");
    await expect(page.locator("[data-order-details-loading]")).toHaveCount(0);
    await page.locator("#order-platinum").fill("80");
    await page.locator("#order-quantity").fill("2");
    await page.locator("#order-rank").fill("10");
    await page.locator("[data-order-subtype]").selectOption("atragraph");
    await page.screenshot({ path: "test-results/order-variants-create.png" });
    await page.locator('[data-order-modal="create"] button[type="submit"]').click();
    await expect(page.locator("[data-order-modal]")).toHaveCount(0);
    const orders = await page.evaluate(() => window.api.wfmGetOrders());
    expect(orders).toMatchObject({
      sell: [{ subtype: "atragraph", platinum: 80, quantity: 2, modRank: 10 }],
    });
    await expect(page.locator("[data-order-subtype-chip]").first()).toHaveText("Atragraph");
    await page.locator("[data-order-edit]").first().click();
    await expect(page.locator("[data-order-subtype]")).toHaveValue("atragraph");
    await expect(page.locator("[data-order-details-loading]")).toHaveCount(0);
    await page.locator("#order-platinum").fill("90");
    await page.locator('[data-order-modal="edit"] button[type="submit"]').click();
    await expect(page.locator("[data-order-modal]")).toHaveCount(0);
    expect(await page.evaluate(() => window.api.wfmGetOrders())).toMatchObject({
      sell: [{ subtype: "atragraph", platinum: 90 }],
    });
    await page.locator("[data-market-new-order]").click();
    await page.locator("#order-item-search").fill("Offline");
    await page.locator('[data-order-item="offline_mod"]').click();
    await expect(page.locator("[data-order-details-error]")).toBeVisible();
    await page.locator("#order-platinum").fill("90");
    await expect(page.locator('[data-order-modal="create"] button[type="submit"]')).toBeDisabled();
    await page.locator("[data-order-clear-item]").click();
    await page.locator("#order-item-search").fill("Variant");
    await page.locator('[data-order-item="variant_only"]').click();
    await expect(page.locator("[data-order-details-loading]")).toHaveCount(0);
    await expect(page.locator("[data-order-subtype]")).toHaveValue("");
    await page.locator('[data-order-modal="create"] button[type="submit"]').click();
    await expect(page.locator('[data-order-modal="create"]')).toBeVisible();
    expect(await page.evaluate(() => window.api.wfmGetOrders())).toMatchObject({
      sell: [{ subtype: "atragraph", platinum: 90 }],
    });
    await page.keyboard.press("Escape");
    await page.locator("[data-market-new-order]").click();
    await page.locator("#order-item-search").fill("Slow");
    await page.locator('[data-order-item="slow_mod"]').click();
    await expect(page.locator("[data-order-details-loading]")).toBeVisible();
    await page.locator("[data-order-clear-item]").click();
    await page.locator("#order-item-search").fill("Forma");
    await page.locator('[data-order-item="forma_blueprint"]').click();
    await expect(page.locator("[data-order-details-loading]")).toHaveCount(0);
    await page.waitForTimeout(2000);
    await expect(page.locator("[data-order-subtype]")).toHaveCount(0);
    await expect(page.locator("#order-rank")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.locator('[data-tour-tab="browse"]').click();
    const browse = page.locator('[data-tour="market-browse"]');
    await browse.locator('input[role="combobox"]').fill("Spectral");
    await expect(browse.locator('[role="option"]')).toHaveCount(1);
    await browse.locator('input[role="combobox"]').press("Enter");
    await expect(browse.locator("[data-browse-variant]")).toHaveValue("regular");
    await expect(browse.locator("tbody")).toContainText("RegularSeller");
    await expect(browse.locator("tbody")).not.toContainText("FoilSeller");
    await browse.locator("[data-browse-variant]").selectOption("atragraph");
    await expect(browse.locator("tbody")).toContainText("FoilSeller");
    await expect(browse.locator("tbody")).not.toContainText("RegularSeller");
    await page.screenshot({ path: "test-results/order-variants-browse.png" });
    expect(errors).toEqual([]);
  } catch (error) {
    if (harness) {
      await harness.page.screenshot({ path: "test-results/order-variants-failure.png" });
      await test.info().attach("browse-failure", {
        contentType: "text/plain",
        body: await harness.page
          .locator('[data-tour="market-browse"]')
          .innerText()
          .catch(() => "Browse not mounted"),
      });
    }
    throw error;
  } finally {
    await closeElectronTestHarness(harness);
  }
});
