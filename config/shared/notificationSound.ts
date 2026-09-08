import { clampNumber } from "./numeric";

export const NOTIFICATION_SOUND_MAX_INPUT_BYTES = 5 * 1024 * 1024;
export const NOTIFICATION_SOUND_MAX_SECONDS = 30;
export const NOTIFICATION_SOUND_SAMPLE_RATE = 24000;
export const NOTIFICATION_SOUND_MAX_WAV_BYTES =
  44 + NOTIFICATION_SOUND_SAMPLE_RATE * NOTIFICATION_SOUND_MAX_SECONDS * 2;

export interface NotificationSoundUpload {
  name: string;
  data: string;
}

export interface NotificationSoundAsset {
  name: string;
  dataUrl: string;
  revision: string;
}

export interface NotificationSoundPlayback {
  volume: number;
  revision: string | null;
}

export function normalizeNotificationVolume(value: unknown): number {
  // A string stays at the default: the volume is never stored as text.
  return typeof value === "number" ? clampNumber(value, 0, 1, 1) : 1;
}
