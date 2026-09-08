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
  return typeof value === "number" && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
}
