import { contextBridge, ipcRenderer } from "electron";
import { onIpc } from "./ipc/preloadListeners";
import { installOverlayContentVisibility } from "./ipc/overlayContentVisibility";
import {
  OVERLAY_CLOSE,
  OVERLAY_GET_PRICE,
  OVERLAY_GET_THEME_VARS,
  OVERLAY_GET_MESSAGES,
  OVERLAY_MESSAGES,
  OVERLAY_GET_DRAG_HINT,
  RELIC_REWARD_TRIGGER,
  RELIC_PLANNER_TRIGGER,
  RELIC_REWARD_ITEMS,
  RELIC_RECOMMENDATIONS,
  OVERLAY_THEME_VARS,
  OVERLAY_INTERACTION_MODE,
  OVERLAY_DRAG_MOVE,
  OVERLAY_READY,
  REWARD_LAYOUT_GET,
  REWARD_EDIT_STATE,
} from "./config/shared/ipcChannels";

const onOverlayIpc = (channel: string, listener: Parameters<typeof onIpc>[2]): (() => void) =>
  onIpc(ipcRenderer, channel, listener);

installOverlayContentVisibility(ipcRenderer);

contextBridge.exposeInMainWorld("overlay", {
  getRewardLayout: () => ipcRenderer.invoke(REWARD_LAYOUT_GET),
  onRewardLayout: (cb: (state: unknown) => void) =>
    onOverlayIpc(REWARD_EDIT_STATE, (_event: unknown, state: unknown) => cb(state)),
  close: () => ipcRenderer.send(OVERLAY_CLOSE),
  getPrice: (slug: string) => ipcRenderer.invoke(OVERLAY_GET_PRICE, slug),
  getThemeVars: () => ipcRenderer.invoke(OVERLAY_GET_THEME_VARS),
  getMessages: () => ipcRenderer.invoke(OVERLAY_GET_MESSAGES),
  getDragHint: () => ipcRenderer.invoke(OVERLAY_GET_DRAG_HINT),
  moveBy: (dx: number, dy: number) => ipcRenderer.send(OVERLAY_DRAG_MOVE, { dx, dy }),
  ready: () => ipcRenderer.send(OVERLAY_READY),
  onTrigger: (cb: () => void) => onOverlayIpc(RELIC_REWARD_TRIGGER, () => cb()),
  onPlannerTrigger: (cb: (payload: unknown) => void) =>
    onOverlayIpc(RELIC_PLANNER_TRIGGER, (_event: unknown, payload: unknown) => cb(payload)),
  onItems: (cb: (items: unknown) => void) =>
    onOverlayIpc(RELIC_REWARD_ITEMS, (_event: unknown, items: unknown) => cb(items)),
  onRecommendations: (cb: (payload: unknown) => void) =>
    onOverlayIpc(RELIC_RECOMMENDATIONS, (_event: unknown, payload: unknown) => cb(payload)),
  onThemeVars: (cb: (vars: unknown) => void) =>
    onOverlayIpc(OVERLAY_THEME_VARS, (_event: unknown, vars: unknown) => cb(vars)),
  onMessages: (cb: (messages: unknown) => void) =>
    onOverlayIpc(OVERLAY_MESSAGES, (_event: unknown, messages: unknown) => cb(messages)),
  onInteractionMode: (cb: (payload: unknown) => void) =>
    onOverlayIpc(OVERLAY_INTERACTION_MODE, (_event: unknown, payload: unknown) => cb(payload)),
});
