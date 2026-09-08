import { installOverlayLayoutBridge } from "./ipc/overlayLayoutPreload";
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { onIpc } from "./ipc/preloadListeners";
import { installOverlayContentVisibility } from "./ipc/overlayContentVisibility";
import {
  ARBI_SUMMARY_CLOSE,
  ARBI_SUMMARY_DATA,
  ARBI_SUMMARY_OPEN_DETAILS,
  ARBI_SUMMARY_READY,
  OVERLAY_DRAG_MOVE,
  OVERLAY_GET_MESSAGES,
  OVERLAY_GET_THEME_VARS,
  OVERLAY_MESSAGES,
  OVERLAY_THEME_VARS,
} from "./config/shared/ipcChannels";

const onArbiIpc = (
  channel: string,
  listener: (event: IpcRendererEvent, ...args: unknown[]) => void,
): (() => void) => onIpc(ipcRenderer, channel, listener);

installOverlayContentVisibility(ipcRenderer);
installOverlayLayoutBridge();

contextBridge.exposeInMainWorld("arbiSummary", {
  ready: () => ipcRenderer.send(ARBI_SUMMARY_READY),
  close: () => ipcRenderer.send(ARBI_SUMMARY_CLOSE),
  openDetails: (runId: string) => ipcRenderer.send(ARBI_SUMMARY_OPEN_DETAILS, runId),
  moveBy: (dx: number, dy: number) => ipcRenderer.send(OVERLAY_DRAG_MOVE, { dx, dy }),
  getThemeVars: () => ipcRenderer.invoke(OVERLAY_GET_THEME_VARS),
  getMessages: () => ipcRenderer.invoke(OVERLAY_GET_MESSAGES),
  onData: (cb: (payload: unknown) => void) =>
    onArbiIpc(ARBI_SUMMARY_DATA, (_event: unknown, payload: unknown) => cb(payload)),
  onThemeVars: (cb: (vars: unknown) => void) =>
    onArbiIpc(OVERLAY_THEME_VARS, (_event: unknown, vars: unknown) => cb(vars)),
  onMessages: (cb: (messages: unknown) => void) =>
    onArbiIpc(OVERLAY_MESSAGES, (_event: unknown, messages: unknown) => cb(messages)),
});
