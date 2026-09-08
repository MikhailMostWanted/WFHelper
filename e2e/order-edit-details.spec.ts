import { expect, test } from "@playwright/test";
import {
  closeElectronTestHarness,
  evaluateInMain,
  launchElectronTestHarness,
  openView,
  setLayoutViewport,
  type ElectronTestHarness,
} from "./electronTestHarness";

test("price edits preserve ranks and variants when item details fail", async () => {
  test.setTimeout(180_000);
  let harness: ElectronTestHarness | undefined;
  try {
    harness = await launchElectronTestHarness("wfh-order-edit-details-");
    const { app, page } = harness;
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      const originalFetch = window.fetch;
      window.fetch = async (input, init) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (!url.startsWith("https://api.warframe.market/")) return originalFetch(input, init);
        return new Response(
          JSON.stringify({
            data: [
              {
                type: "sell",
                subtype: "atragraph",
                platinum: 150,
                quantity: 1,
                user: { ingameName: "Fixture", status: "ingame" },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
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
      const state = globalThis as typeof globalThis & {
        orderEditRequests: { method: string; path: string; body?: Record<string, unknown> }[];
      };
      state.orderEditRequests = [];
      const orders = [null, 4, null, null, null].map((rank, index) => ({
        id: `11111111111111111111111${index}`,
        orderType: "sell",
        platinum: 80,
        quantity: 2,
        visible: true,
        modRank: rank,
        subtype: index === 1 || index === 2 ? "atragraph" : null,
        itemId: `22222222222222222222222${index}`,
        itemName: index >= 3 ? `Fixture ${index} Relic` : `Fixture Mod ${index}`,
        itemUrlName:
          index >= 3
            ? `${index === 4 ? "offline" : "fixture"}_relic_${index}`
            : index === 0
              ? "rankless_mod"
              : `offline_mod_${index}`,
        itemThumb: null,
      }));
      client.requestV2 = async (method, path, options) => {
        state.orderEditRequests.push({
          method,
          path,
          ...(options?.json ? { body: options.json } : {}),
        });
        if (method === "GET" && path.startsWith("/item/")) {
          if (path.includes("offline")) throw new Error("Fixture item details unavailable");
          return {
            data: {
              id: orders[0].itemId,
              slug: path.split("/").pop(),
              i18n: { en: { name: path.includes("relic") ? "Fixture 3 Relic" : "Rankless Mod" } },
              maxRank: path.includes("relic") ? null : 10,
              subtypes: path.includes("relic")
                ? ["intact", "exceptional", "flawless", "radiant"]
                : ["regular", "atragraph"],
            },
          };
        }
        if (method === "PATCH") {
          const order = orders.find((entry) => path.endsWith(entry.id));
          if (!order) throw new Error("Unexpected fixture order");
          Object.assign(order, options?.json);
          return { data: order };
        }
        throw new Error(`Unexpected fixture request ${method} ${path}`);
      };
      ipcMain.removeHandler("wfm:session");
      ipcMain.handle("wfm:session", () => ({
        loggedIn: true,
        userName: "Fixture",
        platform: "pc",
      }));
      ipcMain.removeHandler("wfm:get-orders");
      ipcMain.handle("wfm:get-orders", () => ({ sell: orders, buy: [] }));
      ipcMain.removeHandler("wfm:search-items");
      ipcMain.handle("wfm:search-items", () => [
        {
          id: orders[3].itemId,
          item_name: orders[3].itemName,
          url_name: orders[3].itemUrlName,
          thumb: null,
          maxRank: null,
        },
      ]);
    });
    await page.reload();
    await setLayoutViewport(page, 1280, 900);
    await openView(page, "market");
    await expect(page.locator("[data-order-edit]")).toHaveCount(5);
    // Rankless variants still show their live order-book price.
    await expect(
      page.locator(".market-summary-line strong").filter({ hasText: "150p" }).first(),
    ).toBeVisible();
    for (let index = 0; index < 5; index += 1) {
      await page.locator(`[data-order-edit="11111111111111111111111${index}"]`).click();
      await expect(page.locator("[data-order-details-loading]")).toHaveCount(0);
      await expect(page.locator("#order-rank")).toHaveCount(index === 1 ? 1 : 0);
      if (index === 1) await expect(page.locator("#order-rank")).toHaveValue("4");
      if (index === 1 || index === 2) {
        await expect(page.locator("[data-order-details-error]")).toBeVisible();
        await expect(page.locator("[data-order-subtype]")).toHaveValue("atragraph");
        await page.screenshot({
          animations: "disabled",
          path: test.info().outputPath(`order-edit-offline-${index}.png`),
        });
      }
      if (index >= 3) {
        await expect(page.locator("[data-order-subtype]")).toHaveValue("");
        if (index === 4) await expect(page.locator("[data-order-details-error]")).toBeVisible();
        await page.screenshot({
          animations: "disabled",
          path: test.info().outputPath(`order-edit-unspecified-refinement-${index}.png`),
        });
      }
      await page.locator("#order-platinum").fill("90");
      await page.locator('[data-order-modal="edit"] button[type="submit"]').click();
      await expect(page.locator("[data-order-modal]")).toHaveCount(0);
    }
    const requests = await evaluateInMain(
      app,
      () =>
        (
          globalThis as typeof globalThis & {
            orderEditRequests: { method: string; body?: Record<string, unknown> }[];
          }
        ).orderEditRequests,
    );
    expect(requests.filter((request) => request.method === "GET")).toHaveLength(5);
    const patches = requests.filter((request) => request.method === "PATCH");
    expect(patches).toHaveLength(5);
    for (const patch of patches) {
      expect(patch.body).toMatchObject({ platinum: 90, quantity: 2, visible: true });
      expect(patch.body).not.toHaveProperty("rank");
      expect(patch.body).not.toHaveProperty("subtype");
    }
    await page.locator('[data-order-edit="111111111111111111111113"]').click();
    await expect(page.locator("[data-order-details-loading]")).toHaveCount(0);
    await page.locator("[data-order-subtype]").selectOption("radiant");
    await page.locator('[data-order-modal="edit"] button[type="submit"]').click();
    await expect(page.locator("[data-order-modal]")).toHaveCount(0);
    const selectedPatch = await evaluateInMain(app, () => {
      const requests = (
        globalThis as typeof globalThis & {
          orderEditRequests: { method: string; body?: Record<string, unknown> }[];
        }
      ).orderEditRequests;
      return requests.filter((request) => request.method === "PATCH").at(-1)?.body;
    });
    expect(selectedPatch).toMatchObject({ subtype: "radiant" });
    await page.locator("[data-market-new-order]").click();
    await page.locator("#order-item-search").fill("Fixture");
    await page.locator('[data-order-item="fixture_relic_3"]').click();
    await expect(page.locator("[data-order-details-loading]")).toHaveCount(0);
    await expect(page.locator("[data-order-subtype]")).toHaveValue("");
    await page.locator("#order-platinum").fill("90");
    await page.locator('[data-order-modal="create"] button[type="submit"]').click();
    await expect(page.locator("[data-order-validation-error]")).toBeVisible();
    const posts = await evaluateInMain(app, () =>
      (
        globalThis as typeof globalThis & { orderEditRequests: { method: string }[] }
      ).orderEditRequests.filter((request) => request.method === "POST"),
    );
    expect(posts).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await closeElectronTestHarness(harness);
  }
});
