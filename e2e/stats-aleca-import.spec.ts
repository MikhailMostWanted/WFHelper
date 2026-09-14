import fs from "node:fs";
import path from "node:path";

import { test, expect, type Page } from "@playwright/test";

import {
  closeElectronTestHarness,
  launchElectronTestHarness,
  openView,
  type ElectronTestHarness,
} from "./electronTestHarness";

// Rows must land inside the default year-to-date window whatever day CI runs on,
// so they sit two days back but never before the second of January.
const NOW = new Date();
const BASE = Math.max(NOW.getTime() - 2 * 86_400_000, new Date(NOW.getFullYear(), 0, 2).getTime());
const SOLD_AT = new Date(BASE).toISOString();
const SWAPPED_AT = new Date(BASE + 60_000).toISOString();
const BOUGHT_AT = new Date(BASE + 120_000).toISOString();

const SOBEK = {
  name: "/AF_Special/Riven/Sobek/Visi-toxican",
  displayName: "Sobek Visi-toxican",
  cnt: 1,
};
const CRONICAN = {
  name: "/AF_Special/Riven/Sobek/Cronican",
  displayName: "Sobek Cronican",
  cnt: 1,
};
const LOHK = { name: "/Lotus/Upgrades/Mods/Immortal/ImmortalOneMod", displayName: "Lohk", cnt: 1 };

// What an older build wrote: the sale under a positional id, the swap as a 0p sale.
const LEGACY_ROWS = [
  {
    id: `af-${SOLD_AT}-1500-ZeusPrime22-23`,
    date: SOLD_AT,
    type: "sale",
    platChange: 1500,
    partner: "ZeusPrime22",
    items: [
      { internalName: SOBEK.name, displayName: SOBEK.displayName, count: 1, direction: "given" },
    ],
  },
  {
    id: `af-${SWAPPED_AT}-0-Ainikki`,
    date: SWAPPED_AT,
    type: "sale",
    platChange: 0,
    partner: "Ainikki",
    items: [
      {
        internalName: CRONICAN.name,
        displayName: CRONICAN.displayName,
        count: 1,
        direction: "given",
      },
      { internalName: LOHK.name, displayName: LOHK.displayName, count: 1, direction: "received" },
    ],
  },
];

// A fresh AlecaFrame export: one new purchase on top of the two trades above.
const EXPORT = {
  generalDataPoints: [
    { ts: SOLD_AT, plat: 100, credits: 0, endo: 0, ducats: 0, aya: 0, vitus: 0, trades: 3 },
  ],
  trades: [
    {
      ts: BOUGHT_AT,
      type: 1,
      totalPlat: 40,
      user: "Nova",
      rx: [
        {
          name: "/Lotus/Upgrades/Mods/Warframe/AvatarEnergyMaxModExpert",
          displayName: "Primed Flow",
          cnt: 1,
        },
      ],
    },
    { ts: SOLD_AT, type: 0, totalPlat: 1500, user: "ZeusPrime22", tx: [SOBEK] },
    { ts: SWAPPED_AT, type: 2, totalPlat: 0, user: "Ainikki", tx: [CRONICAN], rx: [LOHK] },
  ],
};

test.describe("AlecaFrame trade import", () => {
  test.setTimeout(180_000);

  let harness: ElectronTestHarness;
  let page: Page;
  let exportPath: string;

  test.beforeAll(async () => {
    harness = await launchElectronTestHarness("wfh-aleca-import-", {
      userDataFiles: { "trade-log.json": LEGACY_ROWS },
    });
    page = harness.page;
    exportPath = path.join(harness.sandboxDir, "alecaframe-export.json");
    fs.writeFileSync(exportPath, JSON.stringify(EXPORT));
  });

  test.afterAll(async () => {
    await closeElectronTestHarness(harness);
  });

  async function importExport(): Promise<void> {
    await openView(page, "stats");
    await page.locator('section.view.active input[type="file"]').setInputFiles(exportPath);
  }

  test("a re-import adds only the trades the ledger does not hold yet", async () => {
    await openView(page, "stats");
    const rows = page.locator("[data-stats-trade-panel] [data-trade-row]");
    await expect(rows).toHaveCount(2, { timeout: 30_000 });

    await importExport();
    await expect(page.getByText("1 trade imported.")).toBeVisible({ timeout: 30_000 });
    await expect(rows).toHaveCount(3);

    await openView(page, "analytics");
    const sold = page.locator('[data-analysis-top-items="sold"]');
    await expect(sold).toContainText("Sobek Riven", { timeout: 30_000 });
    await expect(sold).toContainText("1,500");
    await expect(sold).toContainText("1 units");
    await page.screenshot({
      path: test.info().outputPath("aleca-import-analytics.png"),
      animations: "disabled",
    });

    await importExport();
    await expect(page.getByText("Imported/updated 1 day.", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText("trade imported")).toHaveCount(0);
    await expect(rows).toHaveCount(3);
    await page.screenshot({
      path: test.info().outputPath("aleca-import-second-run.png"),
      animations: "disabled",
    });
  });
});
