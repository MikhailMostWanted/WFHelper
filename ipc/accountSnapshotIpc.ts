import { app, dialog } from "electron";
import fs from "node:fs/promises";
import ctx from "./context";
import { getInventorySource, getLoadedInventoryModifiedAt } from "./inventoryIpc";
import { handleAuthorized, assertMainRendererSender } from "./ipcSecurity";
import { getAccountSnapshotStatus, onAccountSnapshotSaved } from "../services/accountSnapshotStore";
import { currentAccountBridge } from "../services/accountBridgeRuntime";
import { bridgeExportZip } from "../services/bridgeExport";
import {
  bridgeSyncStatus,
  connectBridge,
  disconnectBridge,
  pushBridge,
  setAutomaticBridge,
  validatePairing,
  noteBridgeSyncFailure,
} from "../services/accountBridgeSync";

let timer: ReturnType<typeof setTimeout> | null = null;
let lastAutoAttempt = 0;
function scheduleAutomatic(): void {
  if (!bridgeSyncStatus().automatic || timer) return;
  timer = setTimeout(
    () => {
      timer = null;
      if (!bridgeSyncStatus().automatic) return;
      lastAutoAttempt = Date.now();
      void currentAccountBridge()
        .then((doc) => {
          if (!bridgeSyncStatus().automatic) return;
          return pushBridge(doc);
        })
        .catch(() => {
          noteBridgeSyncFailure();
        });
    },
    Math.max(5000, 300_000 - (Date.now() - lastAutoAttempt)),
  );
  timer.unref();
}
export function register(): void {
  onAccountSnapshotSaved(scheduleAutomatic);
  app.once("before-quit", () => {
    if (timer) clearTimeout(timer);
    timer = null;
  });
  handleAuthorized("account-snapshot:status", assertMainRendererSender, () => {
    const { snapshot, error } = getAccountSnapshotStatus();
    const available = getInventorySource() !== "none" && !!ctx.currentInventoryData;
    return {
      updatedAt: available ? getLoadedInventoryModifiedAt() : null,
      rows: available ? (snapshot?.items.length ?? null) : null,
      coverage: available ? (snapshot?.coverage ?? []) : [],
      error,
      bridge: bridgeSyncStatus(),
    };
  });
  handleAuthorized("account-snapshot:export", assertMainRendererSender, async () => {
    const window = ctx.mainWindow;
    if (!window) return { saved: false };
    const status = bridgeSyncStatus();
    const choice = await dialog.showMessageBox(window, {
      type: "question",
      title: "WantedFrame · ChatGPT",
      message: "Данные аккаунта для ChatGPT",
      detail:
        "ZIP содержит каталог доступных разделов и полный разрешённый снимок. MCP выдаёт данные по запросу, после отдельного подключения в ChatGPT. Синхронизация отправляет игровые данные только на выбранный тобой сервер.",
      buttons: [
        "Сохранить комплект ZIP",
        "Отправить на MCP сейчас",
        "Подключить MCP",
        status.automatic ? "Выключить автосинхронизацию" : "Включить автосинхронизацию",
        "Отключить MCP",
        "Отмена",
      ],
      cancelId: 5,
      defaultId: 0,
    });
    try {
      if (choice.response === 5) return { saved: false };
      if (choice.response === 2) {
        const selected = await dialog.showOpenDialog(window, {
          title: "Файл подключения, созданный на твоём VPS",
          properties: ["openFile"],
          filters: [{ name: "WantedFrame pairing", extensions: ["json"] }],
        });
        if (selected.canceled) return { saved: false };
        const file = selected.filePaths[0];
        if (!file || (await fs.stat(file)).size > 8192)
          throw new Error("Неверный файл подключения");
        const pair = validatePairing(JSON.parse(await fs.readFile(file, "utf8")));
        const confirm = await dialog.showMessageBox(window, {
          type: "warning",
          message: `Подключить ${pair.server}?`,
          detail:
            "Этот сервер будет получать твой инвентарь, сборки, валюты и прогресс. Подтверди только свой адрес. Автоматическая передача по умолчанию выключена.",
          buttons: ["Подключить", "Отмена"],
          defaultId: 1,
          cancelId: 1,
        });
        if (confirm.response !== 0) return { saved: false };
        connectBridge(pair);
        return { saved: true };
      }
      if (choice.response === 3) {
        setAutomaticBridge(!status.automatic);
        scheduleAutomatic();
        return { saved: true };
      }
      if (choice.response === 4) {
        const confirm = await dialog.showMessageBox(window, {
          type: "question",
          message: "Отключить передачу?",
          detail:
            "Локальный токен будет удалён. Уже переданные снимки и подключение ChatGPT нужно удалить отдельно на VPS/в ChatGPT.",
          buttons: ["Отключить", "Отмена"],
          defaultId: 1,
          cancelId: 1,
        });
        if (confirm.response !== 0) return { saved: false };
        await disconnectBridge();
        return { saved: true };
      }
      const doc = await currentAccountBridge();
      if (choice.response === 1) {
        await pushBridge(doc);
        return { saved: true };
      }
      const result = await dialog.showSaveDialog(window, {
        title: "Комплект данных для ChatGPT",
        defaultPath: "WantedFrame-ChatGPT.zip",
        filters: [{ name: "ZIP", extensions: ["zip"] }],
      });
      if (result.canceled || !result.filePath) return { saved: false };
      await fs.writeFile(result.filePath, bridgeExportZip(doc), { mode: 0o600 });
      return { saved: true };
    } catch (error) {
      await dialog.showMessageBox(window, {
        type: "error",
        message: "Действие не выполнено",
        detail: error instanceof Error ? error.message : "Ошибка подготовки данных",
      });
      return { saved: false };
    }
  });
}
