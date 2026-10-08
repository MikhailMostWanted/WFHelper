import { dialog } from "electron";
import fs from "node:fs/promises";
import ctx from "./context";
import { getInventorySource, getLoadedInventoryModifiedAt } from "./inventoryIpc";
import { handleAuthorized, assertMainRendererSender } from "./ipcSecurity";
import { getAccountSnapshotStatus } from "../services/accountSnapshotStore";

export function register(): void {
  handleAuthorized("account-snapshot:status", assertMainRendererSender, () => {
    const { snapshot, error } = getAccountSnapshotStatus();
    const current =
      getInventorySource() !== "none" &&
      snapshot?.source === getInventorySource() &&
      snapshot?.inventoryUpdatedAt === getLoadedInventoryModifiedAt();
    return {
      updatedAt: current ? (snapshot?.inventoryUpdatedAt ?? null) : null,
      rows: current ? (snapshot?.items.length ?? null) : null,
      coverage: current ? (snapshot?.coverage ?? []) : [],
      error,
    };
  });
  handleAuthorized("account-snapshot:export", assertMainRendererSender, async () => {
    const { snapshot } = getAccountSnapshotStatus();
    if (
      !snapshot ||
      !ctx.mainWindow ||
      getInventorySource() === "none" ||
      snapshot.source !== getInventorySource() ||
      snapshot.inventoryUpdatedAt !== getLoadedInventoryModifiedAt()
    )
      return { saved: false };
    const result = await dialog.showSaveDialog(ctx.mainWindow, {
      title: "WantedFrame — снимок аккаунта",
      defaultPath: "account-snapshot.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return { saved: false };
    try {
      await fs.writeFile(result.filePath, JSON.stringify(snapshot, null, 2), { mode: 0o600 });
      return { saved: true };
    } catch {
      return { saved: false };
    }
  });
}
