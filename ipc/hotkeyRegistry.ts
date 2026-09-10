import { globalShortcut } from "electron";

import ctx from "./context";
import { createKeyHookShortcut } from "../services/keyHookShortcut";
import { withScope } from "../services/logger";

const log = withScope("hotkeyRegistry");

export const overlayHotkeyBackend =
  process.env.WFHELPER_DISABLE_KEYBOARD_HOOK === "1"
    ? { register: () => false, unregister: () => {}, dispose: () => {} }
    : process.platform === "win32"
      ? createKeyHookShortcut({ log })
      : globalShortcut;

export function disposeAppHotkeys(): void {
  if ("dispose" in overlayHotkeyBackend) overlayHotkeyBackend.dispose();
}

export function registerTransientHotkey(accelerator: string, callback: () => void): boolean {
  if (!accelerator) return false;
  if (
    accelerator === ctx.overlayHotkeyRegistered ||
    accelerator === ctx.overlayInteractionHotkeyRegistered ||
    accelerator === ctx.rivenRescanHotkeyRegistered
  ) {
    log.warn("[TransientHotkey] refusing overlay-owned accelerator:", accelerator);
    return false;
  }
  try {
    return overlayHotkeyBackend.register(accelerator, callback);
  } catch (err) {
    log.warn("[TransientHotkey] register failed:", accelerator, String(err));
    return false;
  }
}

export function unregisterTransientHotkey(accelerator: string): void {
  if (!accelerator) return;
  if (
    accelerator === ctx.overlayHotkeyRegistered ||
    accelerator === ctx.overlayInteractionHotkeyRegistered ||
    accelerator === ctx.rivenRescanHotkeyRegistered
  ) {
    return;
  }
  try {
    overlayHotkeyBackend.unregister(accelerator);
  } catch (err) {
    log.warn("[TransientHotkey] unregister failed:", accelerator, String(err));
  }
}
