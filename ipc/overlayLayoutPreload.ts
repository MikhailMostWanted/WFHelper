import { contextBridge, ipcRenderer } from "electron";
import { OVERLAY_EDIT_STATE, OVERLAY_LAYOUT_GET } from "../config/shared/ipcChannels";
import type { OverlayEditState } from "../config/shared/overlayLayout";
import { DEFAULT_OVERLAY_FIELD_STYLE } from "../config/shared/overlayLayout";
import { onIpcData } from "./preloadListeners";

export function installOverlayLayoutBridge(): void {
  contextBridge.exposeInMainWorld("overlayLayoutApi", {
    defaultFieldStyle: DEFAULT_OVERLAY_FIELD_STYLE,
    getLayout: () => ipcRenderer.invoke(OVERLAY_LAYOUT_GET),
    onLayout: (callback: (state: OverlayEditState) => void) =>
      onIpcData(ipcRenderer, OVERLAY_EDIT_STATE, callback),
  });
}
