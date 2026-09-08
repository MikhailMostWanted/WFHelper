import { expect, test } from "@playwright/test";
import {
  DB_GET_CODEX_SCANS,
  DROP_SEARCH,
  INVENTORY_UPDATED,
  PROFILE_ACCOUNT_CHANGED,
} from "../config/shared/ipcChannels";
import type { CodexScansResult } from "../config/shared/codexTypes";
import {
  closeElectronTestHarness,
  evaluateInMain,
  launchElectronTestHarness,
  openView,
  setLayoutViewport,
  type ElectronTestHarness,
} from "./electronTestHarness";

const butcherType = "/Lotus/Types/Enemies/Grineer/AIWeek/BladeSawman";
const turretType = "/Lotus/Types/Enemies/Grineer/Eidolon/EidolonAutoTurretAgent";
const fragmentType = "/Lotus/Types/Lore/Fragments/AlbrectFragments/AlbrectLoreFragmentA";
interface CodexTestMain {
  codexResult: CodexScansResult;
  codexMode: "failure" | "pending";
  releaseCodex?: () => void;
}

test("Codex retains stale evidence and local details, and discards an old account response", async () => {
  test.setTimeout(180_000);
  let harness: ElectronTestHarness | undefined;
  const errors: string[] = [];
  const fetchedAt = Date.now() - 120_000;
  const scans = [
    { type: `${butcherType}Avatar`, count: 20 },
    { type: turretType.replace(/Agent$/, "AvatarLeader"), count: 3 },
  ];
  try {
    harness = await launchElectronTestHarness("wfh-codex-recovery-", {
      inventory: { Suits: [], LoreFragmentScans: [{ ItemType: fragmentType, Progress: 1 }] },
      userDataFiles: {
        "codex-profile.json": { accountId: "a".repeat(24) },
        "codex-scans.json": { accountId: "a".repeat(24), fetchedAt, scans },
      },
      onPage: (page) => {
        page.on("pageerror", (error) => errors.push(error.message));
      },
    });
    const { app, page } = harness;
    await setLayoutViewport(page, 1440, 1000);
    await openView(page, "mastery");
    await page.locator('[data-tour-tab="codex"]').click();
    const butcher = page.locator(`[data-codex-entry="${butcherType}"]`);
    await expect(butcher).toContainText("20 / 20");
    await expect(page.locator("[data-codex-updated]")).toContainText(
      String(new Date(fetchedAt).getFullYear()),
    );
    await expect(page.locator("[data-codex-sort]")).toHaveAttribute("aria-label");

    const fragment = page.locator(`[data-codex-entry="${fragmentType}"]`);
    await expect(fragment).toContainText("0 / 6");
    await evaluateInMain(app, ({ app }) => {
      const moduleApi = process.getBuiltinModule("module") as {
        createRequire: (filename: string) => (id: string) => unknown;
      };
      const load = moduleApi.createRequire(`${app.getAppPath()}/.electron-build/main.js`);
      const service = load("./services/codexProfile.js") as {
        noteInventorySnapshot: (authz: string, raw: Uint8Array) => void;
      };
      const fs = process.getBuiltinModule("fs") as typeof import("node:fs");
      service.noteInventorySnapshot(
        `accountId=${"a".repeat(24)}`,
        fs.readFileSync(`${app.getPath("userData")}/api-helper/inventory.json`),
      );
    });
    await expect(fragment).toContainText("1 / 6");

    await evaluateInMain(
      app,
      ({ ipcMain }, channel) => {
        ipcMain.removeHandler(channel);
        ipcMain.handle(channel, () => {
          throw new Error("fixture drop failure");
        });
      },
      DROP_SEARCH,
    );
    await butcher.click();
    await expect(page.locator("[data-enemy-faction-planets]")).toBeVisible();
    await expect(page.locator("[data-enemy-drops-error]")).toBeVisible();
    await expect(page.locator("[data-enemy-modal] .detail-muted").first()).toContainText(
      "20 of 20",
    );
    await page.screenshot({ path: test.info().outputPath("codex-partial-drop-failure.png") });
    await page.locator(".detail-close").click();
    await page.locator(`[data-codex-entry="${turretType}#leader"]`).click();
    await expect(page.locator("[data-enemy-modal] .detail-muted").first()).toContainText(
      "3 scans recorded",
    );
    await page.locator(".detail-close").click();

    await evaluateInMain(
      app,
      ({ ipcMain }, fixture) => {
        const scope = globalThis as unknown as CodexTestMain;
        scope.codexResult = fixture.result;
        scope.codexMode = "failure";
        ipcMain.removeHandler(fixture.channel);
        ipcMain.handle(fixture.channel, async (_event, force) => {
          const snapshot = scope.codexResult;
          if (!force) return snapshot;
          if (scope.codexMode === "failure")
            return { ...snapshot, error: "fetch-failed", nextRefreshAt: Date.now() + 60_000 };
          await new Promise<void>((resolve) => {
            scope.releaseCodex = resolve;
          });
          return snapshot;
        });
      },
      { channel: DB_GET_CODEX_SCANS, result: { fetchedAt, scans } },
    );
    await page.locator("[data-codex-refresh]").click();
    await expect(page.locator("[data-codex-error]")).toBeVisible();
    await expect(butcher).toContainText("20 / 20");
    await expect(page.locator("[data-codex-refresh]")).toBeDisabled();
    await expect(page.locator("[data-codex-refresh]")).toContainText("Refresh available in");
    await page.screenshot({ path: test.info().outputPath("codex-stale-refresh.png") });

    await evaluateInMain(
      app,
      ({ BrowserWindow }, channel) => {
        (globalThis as unknown as CodexTestMain).codexMode = "pending";
        for (const window of BrowserWindow.getAllWindows())
          window.webContents.send(channel, { Suits: [] });
      },
      INVENTORY_UPDATED,
    );
    await expect(page.locator("[data-codex-refresh]")).toBeEnabled();
    await page.locator("[data-codex-refresh]").click();
    await expect
      .poll(() =>
        evaluateInMain(app, () => typeof (globalThis as unknown as CodexTestMain).releaseCodex),
      )
      .toBe("function");
    await evaluateInMain(
      app,
      ({ BrowserWindow }, fixture) => {
        const scope = globalThis as unknown as CodexTestMain;
        scope.codexResult = {
          fetchedAt: fixture.fetchedAt,
          scans: [{ type: fixture.type, count: 1 }],
        };
        for (const window of BrowserWindow.getAllWindows())
          window.webContents.send(fixture.channel);
      },
      { channel: PROFILE_ACCOUNT_CHANGED, type: `${butcherType}Avatar`, fetchedAt },
    );
    await expect(butcher).toHaveCount(0);
    await evaluateInMain(app, () => {
      (globalThis as unknown as CodexTestMain).releaseCodex?.();
    });
    await expect(butcher).toContainText("1 / 20");
    await expect(page.locator("[data-codex-error]")).toHaveCount(0);
    await butcher.click();
    await expect(page.locator("[data-enemy-modal] .detail-muted").first()).toContainText("1 of 20");
    await evaluateInMain(
      app,
      ({ BrowserWindow }, channel) => {
        (globalThis as unknown as CodexTestMain).codexResult = { error: "no-account" };
        for (const window of BrowserWindow.getAllWindows()) window.webContents.send(channel);
      },
      PROFILE_ACCOUNT_CHANGED,
    );
    await expect(page.locator("[data-enemy-scan-error]")).toBeVisible();
    await expect(page.locator("[data-enemy-modal] .detail-muted").first()).not.toContainText(
      "1 of 20",
    );
    expect(errors).toEqual([]);
  } finally {
    await closeElectronTestHarness(harness);
  }
});
