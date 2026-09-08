import type {
  NotificationSoundAsset,
  NotificationSoundPlayback,
} from "../../config/shared/notificationSound.js";
import { normalizeNotificationVolume } from "../../config/shared/notificationSound.js";
import { NOTIFICATION_SOUND_URL } from "./assetUrls.js";
import { invoke } from "./ipc.js";
import { log } from "./log.js";

let currentAsset: NotificationSoundAsset | null = null;
let notificationAudio: HTMLAudioElement | null = null;
let previewAudio: HTMLAudioElement | null = null;
let playSequence = 0;
let playbackVolume = 1;

export function updateNotificationSoundSettings(volume: number, enabled: boolean): void {
  playbackVolume = normalizeNotificationVolume(volume);
  if (notificationAudio) notificationAudio.volume = playbackVolume;
  if (!enabled || volume === 0) {
    playSequence++;
    notificationAudio?.pause();
    stopNotificationSound();
  }
}

export function stopNotificationSound(): void {
  previewAudio?.pause();
  previewAudio = null;
}

export async function previewNotificationSound(
  asset: NotificationSoundAsset | null,
  volume: number,
): Promise<void> {
  stopNotificationSound();
  const audio = new Audio(asset?.dataUrl ?? NOTIFICATION_SOUND_URL);
  previewAudio = audio;
  audio.volume = normalizeNotificationVolume(volume);
  await audio.play();
}

export async function playNotificationSound(payload: NotificationSoundPlayback): Promise<void> {
  const sequence = ++playSequence;
  stopNotificationSound();
  notificationAudio?.pause();
  playbackVolume = normalizeNotificationVolume(payload.volume);
  if (playbackVolume === 0) return;
  try {
    let asset = currentAsset;
    if (payload.revision !== (asset?.revision ?? null))
      asset = payload.revision ? await invoke("getNotificationSound") : null;
    // A newer notification wins if fetching a changed clip is still in flight.
    if (sequence !== playSequence) return;
    currentAsset = asset;
    const src = currentAsset?.dataUrl ?? NOTIFICATION_SOUND_URL;
    if (!notificationAudio || notificationAudio.src !== src) notificationAudio = new Audio(src);
    notificationAudio.volume = playbackVolume;
    notificationAudio.currentTime = 0;
    await notificationAudio.play();
  } catch (error) {
    log.warn("[Notify] notification sound failed:", String(error));
  }
}
