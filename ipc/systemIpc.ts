import ctx from "./context";
import { assertMainRendererSender, handleAuthorized, onAuthorized } from "./ipcSecurity";
import { unwrapInventoryPayload } from "../config/shared/inventoryPayload";
import { getLogDirectory, withScope } from "../services/logger";
import * as itemDb from "../services/itemDatabase";
import { getGameLocale, setGameLocale } from "../services/gameLocale";
import * as wfmCatalog from "../services/wfmCatalog";
import * as masteryHelper from "../services/masteryHelper";
import * as codexProfile from "../services/codexProfile";
import { getInventorySource, getInventoryStatus, getLoadedInventoryHash } from "./inventoryIpc";
import { mergeCodexInventoryScans } from "../config/shared/codexInventory";
import { broadcastToRenderers } from "./popoutIpc";
import * as relicService from "../services/relicService";
import * as dropData from "../services/dropData";
import * as autoUpdater from "../services/autoUpdater";
import { REFERENCE_WARFRAME_UI_SCALE } from "../config/runtime/overlaySettings";
import { normalizeErrorMessage } from "../config/shared/errors";
import { isAllowedExternalHost } from "../config/runtime/security";
import { app, BrowserWindow, dialog, shell } from "electron";
import {
  DB_GET_ITEM_DATABASE,
  GAME_LOCALE_UPDATED,
  ITEM_DB_UPDATED,
  DB_GET_WFM_ITEMS,
  DB_GET_MASTERY,
  DB_GET_CODEX_SCANS,
  PERSONAL_PROFILE_GET,
  PROFILE_ACCOUNT_CHANGED,
  INVENTORY_STATUS_UPDATED,
  DB_GET_RELIC_DATABASE,
  DROP_SEARCH,
  APP_UPDATE_CHECK,
  SYSTEM_CONFIRM,
  APP_UPDATE_STATE,
  APP_UPDATE_DOWNLOAD,
  APP_UPDATE_INSTALL,
  APP_RUNTIME_INFO,
  SCAN_DEBUG_OPEN_FOLDER,
  REWARD_OCR_DIAGNOSTIC_RUN,
  LOGS_OPEN_FOLDER,
  LINUX_DISPLAY_GET,
  LINUX_DISPLAY_SET,
  WINDOW_MINIMIZE,
  WINDOW_MAXIMIZE,
  WINDOW_CLOSE,
  LOG_WARN,
  OPEN_EXTERNAL,
} from "../config/shared/ipcChannels";
import fs from "node:fs";
import {
  areOcrDebugDumpsEnabled,
  getScanDebugDir,
  setOcrDebugDumpsEnabled,
} from "../services/rewardScanDebug";
import * as rewardScanner from "../services/rewardScanner";
import { getRussianRewardOcrHealth } from "../services/rewardRussianOcr";
import { resolveWarframeUiScale } from "../services/eeLogPath";
import * as linuxDisplay from "../services/linuxDisplayBackend";
import { isObject } from "./ipcValidators";
import { toNonEmptyString } from "../config/shared/stringValidation";
import { parsePersonalLoadouts } from "../services/personalLoadouts";

const log = withScope("systemIpc");
let stopProfileAccountListener: (() => void) | null = null;
let stopInventoryBindingListener: (() => void) | null = null;

function register(): void {
  stopProfileAccountListener ??= codexProfile.onProfileAccountChanged(() =>
    broadcastToRenderers(PROFILE_ACCOUNT_CHANGED),
  );
  stopInventoryBindingListener ??= codexProfile.onInventoryProfileBindingChanged(() =>
    broadcastToRenderers(INVENTORY_STATUS_UPDATED, getInventoryStatus()),
  );
  handleAuthorized(DB_GET_ITEM_DATABASE, assertMainRendererSender, () =>
    itemDb.getRendererLookup(),
  );

  // Names are localized on the way out of the database, so a language change only
  // has to make the renderer re-pull; nothing in the database itself is rebuilt.
  onAuthorized(GAME_LOCALE_UPDATED, assertMainRendererSender, (_event, rawLocale: unknown) => {
    const locale = setGameLocale(rawLocale);
    if (!locale) return;
    log.info(`[GameLocale] locale=${locale}`);
    ctx.mainWindow?.webContents.send(ITEM_DB_UPDATED);
  });

  handleAuthorized(DB_GET_WFM_ITEMS, assertMainRendererSender, async () => {
    if (!wfmCatalog.isLoaded()) {
      try {
        await wfmCatalog.ensureLoaded();
      } catch (error) {
        log.warn("[WFMarket] get-wfm-items fetch failed:", normalizeErrorMessage(error));
      }
    }
    return wfmCatalog.getRendererLookup();
  });

  handleAuthorized(DB_GET_MASTERY, assertMainRendererSender, () => {
    if (!ctx.currentInventoryData) return null;

    const data = unwrapInventoryPayload(ctx.currentInventoryData, {
      onParseError: (error: unknown) =>
        log.error(
          "[Mastery] Failed to parse nested inventory payload:",
          normalizeErrorMessage(error),
        ),
    });
    return masteryHelper.computeMasteryProgress(data as Record<string, unknown>);
  });

  handleAuthorized(
    PERSONAL_PROFILE_GET,
    assertMainRendererSender,
    async (_event, refresh: unknown) => {
      const generation = codexProfile.getProfileAccountGeneration();
      const result = await codexProfile.getPersonalProfile(refresh === true);
      if (generation !== codexProfile.getProfileAccountGeneration())
        return { profile: null, fetchedAt: null, status: "account-changed", nextRefreshAt: 0 };
      const inventorySource = getInventorySource();
      const hash = getLoadedInventoryHash();
      const savedLoadouts =
        inventorySource === "helper" &&
        hash &&
        codexProfile.isInventorySnapshotForCurrentAccount(hash)
          ? parsePersonalLoadouts(ctx.currentInventoryData)
          : [];
      return { ...result, inventorySource, savedLoadouts };
    },
  );

  handleAuthorized(DB_GET_CODEX_SCANS, assertMainRendererSender, async (_event, force: unknown) => {
    const generation = codexProfile.getProfileAccountGeneration();
    const result = await codexProfile.getCodexScans(force === true);
    if (generation !== codexProfile.getProfileAccountGeneration())
      return { error: "account-changed", nextRefreshAt: 0 };
    const hash = getLoadedInventoryHash();
    const scans =
      (!result.error || (result.error === "fetch-failed" && result.scans)) &&
      hash &&
      codexProfile.isInventorySnapshotForCurrentAccount(hash)
        ? mergeCodexInventoryScans(result.scans ?? [], ctx.currentInventoryData)
        : result.scans;
    return { ...result, ...(scans ? { scans } : {}), inventorySource: getInventorySource() };
  });

  handleAuthorized(DROP_SEARCH, assertMainRendererSender, async (_event, payload: unknown) => {
    if (!isObject(payload)) return [];
    const query = toNonEmptyString(payload.query, 200);
    const mode =
      payload.mode === "item" || payload.mode === "place" || payload.mode === "enemy"
        ? payload.mode
        : null;
    if (!query || !mode) return [];
    try {
      await dropData.ensureLoaded();
    } catch (error) {
      log.warn("[Drops] ensureLoaded failed:", normalizeErrorMessage(error));
    }
    return dropData.searchDrops(query, mode);
  });

  // window.confirm leaves renderer keyboard input dead on Windows after it
  // closes (Chromium bug), so destructive confirmations use the native dialog.
  handleAuthorized(SYSTEM_CONFIRM, assertMainRendererSender, async (event, payload: unknown) => {
    const p = (payload ?? {}) as { message?: unknown; okLabel?: unknown; cancelLabel?: unknown };
    const message = typeof p.message === "string" ? p.message.slice(0, 500) : "";
    if (!message) return false;
    const okLabel = typeof p.okLabel === "string" && p.okLabel ? p.okLabel.slice(0, 60) : "OK";
    const cancelLabel =
      typeof p.cancelLabel === "string" && p.cancelLabel ? p.cancelLabel.slice(0, 60) : "Cancel";
    const options = {
      type: "question" as const,
      buttons: [okLabel, cancelLabel],
      defaultId: 0,
      cancelId: 1,
      message,
      noLink: true,
    };
    const win = BrowserWindow.fromWebContents(event.sender);
    const { response } = win
      ? await dialog.showMessageBox(win, options)
      : await dialog.showMessageBox(options);
    return response === 0;
  });

  handleAuthorized(APP_UPDATE_CHECK, assertMainRendererSender, () =>
    autoUpdater.checkForUpdates("manual"),
  );
  handleAuthorized(APP_UPDATE_STATE, assertMainRendererSender, () => autoUpdater.getUpdateState());
  handleAuthorized(APP_UPDATE_DOWNLOAD, assertMainRendererSender, () =>
    autoUpdater.downloadUpdate(),
  );
  handleAuthorized(APP_UPDATE_INSTALL, assertMainRendererSender, () =>
    autoUpdater.installDownloadedUpdate(),
  );
  handleAuthorized(SCAN_DEBUG_OPEN_FOLDER, assertMainRendererSender, async () => {
    try {
      const dir = getScanDebugDir();
      await fs.promises.mkdir(dir, { recursive: true });
      // Logged either way: on Linux openPath can report success with nothing opened.
      log.info(`[SystemIPC] opening scan-debug folder: ${dir}`);
      const openErr = await shell.openPath(dir);
      if (openErr) log.warn(`[SystemIPC] openPath(scan-debug) failed: ${openErr}`);
      return { ok: !openErr };
    } catch (err) {
      log.warn("[SystemIPC] open scan-debug folder failed:", normalizeErrorMessage(err));
      return { ok: false };
    }
  });

  handleAuthorized(REWARD_OCR_DIAGNOSTIC_RUN, assertMainRendererSender, async () => {
    const startedAt = Date.now();
    const locale = getGameLocale();
    const uiScale =
      (ctx.overlaySettings.warframeUiScaleAuto !== false ? resolveWarframeUiScale() : null) ??
      (Number(ctx.overlaySettings.warframeUiScale) || REFERENCE_WARFRAME_UI_SCALE);
    const debugWasEnabled = areOcrDebugDumpsEnabled();
    if (!debugWasEnabled) setOcrDebugDumpsEnabled(true);

    try {
      const result = await rewardScanner.scanRewardsDetailed(null, { warframeUiScale: uiScale });
      const health = getRussianRewardOcrHealth();
      if (!result) {
        return {
          ok: false,
          error: "capture-failed" as const,
          gameLocale: locale,
          ocrAvailable: health.available,
          ocrReason: health.reason,
          elapsedMs: Date.now() - startedAt,
          ocrMs: 0,
          ocrReads: 0,
          adaptiveRetries: 0,
          strategy: "none",
          reader: "none",
          mode: "none",
          layoutCount: 0,
          slotCount: 0,
          cardCount: 0,
          captureWidth: 0,
          captureHeight: 0,
          items: [],
          slots: [],
        };
      }

      const meta = result.meta ?? {};
      const rawSlots = Array.isArray(meta.slotDiagnostics) ? meta.slotDiagnostics : [];
      const items = result.items.map((item) => ({
        name: String(item.name || ""),
        displayName: typeof item.displayName === "string" ? item.displayName : null,
        slotIndex: typeof item.slotIndex === "number" ? item.slotIndex : null,
      }));
      const itemBySlot = new Map(
        items
          .filter((item) => item.slotIndex != null)
          .map((item) => [item.slotIndex as number, item] as const),
      );
      const slots = rawSlots.map((value) => {
        const slot = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
        const slotIndex = Number.isFinite(Number(slot.slotIndex)) ? Number(slot.slotIndex) : 0;
        const matched = itemBySlot.get(slotIndex);
        return {
          slotIndex,
          rawText: typeof slot.rawText === "string" ? slot.rawText : "",
          resolvedText: typeof slot.resolvedText === "string" ? slot.resolvedText : "",
          matchMode: typeof slot.matchMode === "string" ? slot.matchMode : null,
          matchConfidence:
            typeof slot.matchConfidence === "number" ? slot.matchConfidence : null,
          itemName: matched?.name || (typeof slot.itemName === "string" ? slot.itemName : null),
          itemDisplayName: matched?.displayName ?? null,
          rankMode: typeof slot.rankMode === "string" ? slot.rankMode : null,
          rankConfidence:
            typeof slot.rankConfidence === "number" ? slot.rankConfidence : null,
          diverged: slot.diverged === true,
        };
      });

      return {
        ok: true,
        error: null,
        gameLocale: locale,
        ocrAvailable: health.available,
        ocrReason: health.reason,
        elapsedMs: Number(meta.elapsedMs) || Date.now() - startedAt,
        ocrMs: Number(meta.ocrMs) || 0,
        ocrReads: Number(meta.ocrReads) || 0,
        adaptiveRetries: Number(meta.adaptiveRetries) || 0,
        strategy: String(meta.strategy || "none"),
        reader: String(meta.ocrReader || "none"),
        mode: String(meta.windowsOcrMode || "none"),
        layoutCount: Number(meta.layoutCount) || 0,
        slotCount: Number(meta.slotCount) || 0,
        cardCount: Number(meta.cardCount) || 0,
        captureWidth: Number(meta.captureWidth) || 0,
        captureHeight: Number(meta.captureHeight) || 0,
        items,
        slots,
      };
    } catch (error) {
      const health = getRussianRewardOcrHealth();
      log.warn("[OCRDiagnostic] scan failed:", normalizeErrorMessage(error));
      return {
        ok: false,
        error: "scan-failed" as const,
        gameLocale: locale,
        ocrAvailable: health.available,
        ocrReason: health.reason || normalizeErrorMessage(error),
        elapsedMs: Date.now() - startedAt,
        ocrMs: 0,
        ocrReads: 0,
        adaptiveRetries: 0,
        strategy: "none",
        reader: "none",
        mode: "none",
        layoutCount: 0,
        slotCount: 0,
        cardCount: 0,
        captureWidth: 0,
        captureHeight: 0,
        items: [],
        slots: [],
      };
    } finally {
      if (!debugWasEnabled) setOcrDebugDumpsEnabled(false);
    }
  });

  handleAuthorized(LOGS_OPEN_FOLDER, assertMainRendererSender, async () => {
    try {
      const dir = getLogDirectory();
      if (!dir) return { ok: false };
      log.info(`[SystemIPC] opening log folder: ${dir}`);
      const openErr = await shell.openPath(dir);
      if (openErr) log.warn(`[SystemIPC] openPath(logs) failed: ${openErr}`);
      return { ok: !openErr };
    } catch (err) {
      log.warn("[SystemIPC] open log folder failed:", normalizeErrorMessage(err));
      return { ok: false };
    }
  });

  handleAuthorized(APP_RUNTIME_INFO, assertMainRendererSender, () => ({
    isPackaged: app.isPackaged,
  }));

  handleAuthorized(DB_GET_RELIC_DATABASE, assertMainRendererSender, () =>
    relicService.getRelicDatabase(),
  );

  handleAuthorized(LINUX_DISPLAY_GET, assertMainRendererSender, () => linuxDisplay.info());

  handleAuthorized(LINUX_DISPLAY_SET, assertMainRendererSender, (_event, preference: unknown) =>
    linuxDisplay.applyPreference(preference),
  );

  onAuthorized(WINDOW_MINIMIZE, assertMainRendererSender, () => {
    ctx.mainWindow?.minimize();
  });

  onAuthorized(WINDOW_MAXIMIZE, assertMainRendererSender, () => {
    if (ctx.mainWindow?.isMaximized()) {
      ctx.mainWindow.unmaximize();
    } else {
      ctx.mainWindow?.maximize();
    }
  });

  onAuthorized(WINDOW_CLOSE, assertMainRendererSender, () => {
    ctx.mainWindow?.close();
  });

  onAuthorized(
    LOG_WARN,
    assertMainRendererSender,
    (_event, message: unknown, ...args: unknown[]) => {
      log.warn("[renderer]", String(message), ...args);
    },
  );

  onAuthorized(OPEN_EXTERNAL, assertMainRendererSender, (_event, url: unknown) => {
    try {
      const parsed = new URL(String(url));
      const isHttps = parsed.protocol === "https:";
      if (isHttps && isAllowedExternalHost(parsed.hostname)) {
        void shell.openExternal(parsed.toString());
      } else {
        log.warn(
          "[Security] Blocked open-external for protocol/host:",
          parsed.protocol,
          parsed.hostname,
        );
      }
    } catch {
      log.warn("[Security] Blocked open-external with invalid URL:", String(url).slice(0, 100));
    }
  });
}

export { register };
