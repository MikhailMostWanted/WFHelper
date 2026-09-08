import { app } from "electron";

import { overlayPreviewUrl } from "../../services/overlayPreview";
import ctx from "../context";
import {
  assertLocalizedOverlaySender,
  assertMainRendererSender,
  handleAuthorized,
} from "../ipcSecurity";
import { overlayMessages } from "../overlayI18n";
import { createOverlayEditor } from "./rewardEditor";
import {
  DEFAULT_OVERLAY_FIELD_STYLE,
  OVERLAY_LAYOUT_KINDS,
  getOverlayDescriptor,
  isOverlayLayoutKind,
  type OverlayLayoutKind,
  type OverlayEditState,
} from "../../config/shared/overlayLayout";
import {
  OVERLAY_EDIT_BEGIN,
  OVERLAY_EDIT_PREVIEW,
  OVERLAY_EDIT_UPDATE,
  OVERLAY_EDIT_END,
  OVERLAY_EDIT_STATE,
  OVERLAY_LAYOUT_GET,
} from "../../config/shared/ipcChannels";

function liveWindow(kind: OverlayLayoutKind) {
  switch (kind) {
    case "reward":
      return ctx.overlayWindow;
    case "planner":
      return ctx.plannerOverlayWindow;
    case "rivenLeft":
      return ctx.rivenOverlayLeftWindow;
    case "rivenRight":
      return ctx.rivenOverlayRightWindow;
    case "arbiSummary":
      return ctx.arbiSummaryWindow;
    case "tradeNotification":
      return ctx.tradeNotificationWindow;
  }
}

export function registerOverlayEditor(
  persist: () => boolean,
  reposition: (kind: OverlayLayoutKind) => void,
) {
  function applySaved(state: OverlayEditState): void {
    const win = liveWindow(state.kind);
    if (win && !win.isDestroyed()) win.webContents.send(OVERLAY_EDIT_STATE, state);
    reposition(state.kind);
  }
  const editor = createOverlayEditor({
    ctx,
    persist,
    applySaved,
  });
  const kindFrom = (raw: unknown): OverlayLayoutKind => {
    if (!isOverlayLayoutKind(raw)) throw new Error("Invalid overlay kind");
    return raw;
  };
  handleAuthorized(OVERLAY_EDIT_BEGIN, assertMainRendererSender, (event, raw: unknown) =>
    editor.begin(event.sender, kindFrom(raw)),
  );
  handleAuthorized(OVERLAY_EDIT_PREVIEW, assertMainRendererSender, (_event, raw: unknown) => {
    const kind = kindFrom(raw);
    return {
      url: overlayPreviewUrl(app.getAppPath(), kind),
      descriptor: getOverlayDescriptor(kind),
      theme: { ...ctx.overlayThemeVars },
      messages: overlayMessages(),
      defaultFieldStyle: DEFAULT_OVERLAY_FIELD_STYLE,
    };
  });
  handleAuthorized(
    OVERLAY_EDIT_UPDATE,
    assertMainRendererSender,
    (event, token: unknown, command: unknown) => editor.update(token, command, event.sender),
  );
  handleAuthorized(
    OVERLAY_EDIT_END,
    assertMainRendererSender,
    (event, token: unknown, save: unknown) => editor.end(token, save, event.sender),
  );
  handleAuthorized(OVERLAY_LAYOUT_GET, assertLocalizedOverlaySender, (event) => {
    for (const kind of OVERLAY_LAYOUT_KINDS) {
      if (liveWindow(kind)?.webContents.id === event.sender.id) return editor.savedState(kind);
    }
    throw new Error("Unknown overlay sender");
  });
  return {
    assertIdle() {
      if (editor.state().sessionId)
        throw new Error("Close the overlay editor before importing layouts");
    },
    refresh() {
      for (const kind of OVERLAY_LAYOUT_KINDS) applySaved(editor.savedState(kind));
    },
  };
}
