import { createHash } from "node:crypto";
import fs from "node:fs";

import {
  NOTIFICATION_SOUND_MAX_WAV_BYTES,
  NOTIFICATION_SOUND_SAMPLE_RATE,
  type NotificationSoundAsset,
  type NotificationSoundUpload,
} from "../config/shared/notificationSound";
import { isBoundedBase64 } from "../config/shared/base64";
import { writeFileAtomicSync } from "./atomicFile";
import { userDataPath } from "./userDataPath";

let cached: NotificationSoundAsset | null | undefined;
const filePath = (): string => userDataPath("notification-sound.json");

function validate(raw: unknown): NotificationSoundUpload {
  if (!raw || typeof raw !== "object") throw new Error("Invalid notification sound");
  const { name, data } = raw as Record<string, unknown>;
  if (
    typeof name !== "string" ||
    !name.trim() ||
    name.length > 120 ||
    /[/\\]/.test(name) ||
    Array.from(name).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
    !isBoundedBase64(data, NOTIFICATION_SOUND_MAX_WAV_BYTES)
  )
    throw new Error("Invalid notification sound");
  const bytes = Buffer.from(data, "base64");
  // Accept only the bounded PCM produced by the picker, never arbitrary media or paths.
  if (
    bytes.length < 46 ||
    bytes.length > NOTIFICATION_SOUND_MAX_WAV_BYTES ||
    bytes.toString("base64") !== data ||
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.readUInt32LE(4) !== bytes.length - 8 ||
    bytes.toString("ascii", 8, 16) !== "WAVEfmt " ||
    bytes.readUInt32LE(16) !== 16 ||
    bytes.readUInt16LE(20) !== 1 ||
    bytes.readUInt16LE(22) !== 1 ||
    bytes.readUInt32LE(24) !== NOTIFICATION_SOUND_SAMPLE_RATE ||
    bytes.readUInt32LE(28) !== NOTIFICATION_SOUND_SAMPLE_RATE * 2 ||
    bytes.readUInt16LE(32) !== 2 ||
    bytes.readUInt16LE(34) !== 16 ||
    bytes.toString("ascii", 36, 40) !== "data" ||
    bytes.readUInt32LE(40) !== bytes.length - 44 ||
    bytes.length % 2 !== 0
  )
    throw new Error("Invalid notification sound");
  return { name: name.trim(), data };
}

function asset(upload: NotificationSoundUpload): NotificationSoundAsset {
  return {
    name: upload.name,
    dataUrl: `data:audio/wav;base64,${upload.data}`,
    revision: createHash("sha256").update(upload.data).digest("hex"),
  };
}

export function getNotificationSound(): NotificationSoundAsset | null {
  if (cached !== undefined) return cached;
  let text: string;
  try {
    if (fs.statSync(filePath()).size > Math.ceil(NOTIFICATION_SOUND_MAX_WAV_BYTES / 3) * 4 + 1024)
      return (cached = null);
    text = fs.readFileSync(filePath(), "utf8");
  } catch (error) {
    // Only a missing file is a settled answer; a locked one is retried on the next notification.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") cached = null;
    return null;
  }
  try {
    cached = asset(validate(JSON.parse(text)));
  } catch {
    cached = null;
  }
  return cached;
}

export function saveNotificationSound(raw: unknown): NotificationSoundAsset {
  const upload = validate(raw);
  writeFileAtomicSync(filePath(), JSON.stringify(upload));
  cached = asset(upload);
  return cached;
}

export function resetNotificationSound(): null {
  fs.rmSync(filePath(), { force: true });
  cached = null;
  return null;
}
