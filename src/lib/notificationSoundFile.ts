import {
  NOTIFICATION_SOUND_MAX_INPUT_BYTES,
  NOTIFICATION_SOUND_MAX_SECONDS,
  NOTIFICATION_SOUND_SAMPLE_RATE,
  type NotificationSoundUpload,
} from "../../config/shared/notificationSound.js";

export async function prepareNotificationSound(file: File): Promise<NotificationSoundUpload> {
  if (
    !/\.(wav|mp3|ogg)$/i.test(file.name) ||
    file.size === 0 ||
    file.size > NOTIFICATION_SOUND_MAX_INPUT_BYTES
  ) {
    throw new Error("Invalid notification sound file");
  }

  const context = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await context.decodeAudioData(await file.arrayBuffer());
  } finally {
    await context.close();
  }
  if (
    !Number.isFinite(decoded.duration) ||
    decoded.duration <= 0 ||
    decoded.duration > NOTIFICATION_SOUND_MAX_SECONDS
  ) {
    throw new Error("Invalid notification sound duration");
  }

  // Store a bounded PCM copy without depending on the source file or its codec.
  const frameCount = Math.ceil(decoded.duration * NOTIFICATION_SOUND_SAMPLE_RATE);
  const renderer = new OfflineAudioContext(1, frameCount, NOTIFICATION_SOUND_SAMPLE_RATE);
  const source = renderer.createBufferSource();
  source.buffer = decoded;
  source.connect(renderer.destination);
  source.start();
  let rendered: AudioBuffer;
  try {
    rendered = await renderer.startRendering();
  } finally {
    source.disconnect();
  }

  const samples = rendered.getChannelData(0);
  const bytes = new Uint8Array(44 + samples.length * 2);
  const header = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index++) {
      bytes[offset + index] = value.charCodeAt(index);
    }
  };
  text(0, "RIFF");
  header.setUint32(4, bytes.length - 8, true);
  text(8, "WAVE");
  text(12, "fmt ");
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true);
  header.setUint16(22, 1, true);
  header.setUint32(24, NOTIFICATION_SOUND_SAMPLE_RATE, true);
  header.setUint32(28, NOTIFICATION_SOUND_SAMPLE_RATE * 2, true);
  header.setUint16(32, 2, true);
  header.setUint16(34, 16, true);
  text(36, "data");
  header.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index++) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
    header.setInt16(44 + index * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  }

  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
  }
  return { name: file.name.slice(0, 120), data: btoa(chunks.join("")) };
}
