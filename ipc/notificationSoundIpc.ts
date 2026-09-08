import {
  NOTIFICATION_SOUND_GET,
  NOTIFICATION_SOUND_SAVE,
  NOTIFICATION_SOUND_RESET,
} from "../config/shared/ipcChannels";
import {
  getNotificationSound,
  saveNotificationSound,
  resetNotificationSound,
} from "../services/notificationSound";
import { assertMainRendererSender, handleAuthorized } from "./ipcSecurity";

export function register(): void {
  handleAuthorized(NOTIFICATION_SOUND_GET, assertMainRendererSender, getNotificationSound);
  handleAuthorized(NOTIFICATION_SOUND_SAVE, assertMainRendererSender, (_event, raw: unknown) =>
    saveNotificationSound(raw),
  );
  handleAuthorized(NOTIFICATION_SOUND_RESET, assertMainRendererSender, resetNotificationSound);
}
