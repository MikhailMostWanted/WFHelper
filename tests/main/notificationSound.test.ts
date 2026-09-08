import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  NOTIFICATION_SOUND_MAX_WAV_BYTES,
  NOTIFICATION_SOUND_SAMPLE_RATE,
} from "../../config/shared/notificationSound";
import { pcm16WavBytes } from "../../config/shared/wav";
import {
  NOTIFICATION_SOUND_GET,
  NOTIFICATION_SOUND_RESET,
  NOTIFICATION_SOUND_SAVE,
} from "../../config/shared/ipcChannels";

const mocks = vi.hoisted(() => ({
  directory: "",
  failWrite: false,
  handleAuthorized: vi.fn(),
  assertMainRendererSender: vi.fn(),
}));
vi.mock("../../services/userDataPath", () => ({
  userDataPath: (name: string) => path.join(mocks.directory, name),
}));
vi.mock("../../services/atomicFile", () => ({
  writeFileAtomicSync: (name: string, data: string) => {
    if (mocks.failWrite) throw new Error("Disk unavailable");
    fs.writeFileSync(name, data);
  },
}));
vi.mock("../../ipc/ipcSecurity", () => ({
  handleAuthorized: mocks.handleAuthorized,
  assertMainRendererSender: mocks.assertMainRendererSender,
}));

function wav(size = 48): Buffer {
  return Buffer.from(
    pcm16WavBytes(new Int16Array((size - 44) / 2), NOTIFICATION_SOUND_SAMPLE_RATE),
  );
}

const upload = () => ({ name: "My chime.wav", data: wav().toString("base64") });
const storedPath = () => path.join(mocks.directory, "notification-sound.json");
const load = () => import("../../services/notificationSound");

beforeEach(() => {
  vi.resetModules();
  mocks.directory = fs.mkdtempSync(path.join(os.tmpdir(), "wfh-sound-test-"));
  mocks.failWrite = false;
  mocks.handleAuthorized.mockClear();
});

afterEach(() => {
  fs.rmSync(mocks.directory, { recursive: true, force: true });
});

describe("notification sound storage", () => {
  it("persists canonical PCM and restores it after a fresh module load", async () => {
    const sound = await load();
    const saved = sound.saveNotificationSound({ ...upload(), name: " My chime.wav " });
    expect(saved).toEqual({
      name: "My chime.wav",
      dataUrl: `data:audio/wav;base64,${upload().data}`,
      revision: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(JSON.parse(fs.readFileSync(storedPath(), "utf8"))).toEqual(upload());
    vi.resetModules();
    expect((await load()).getNotificationSound()).toEqual(saved);
  });

  it.each([
    null,
    { ...upload(), name: "../chime.wav" },
    { ...upload(), name: "C:\\chime.wav" },
    { ...upload(), name: "bad\nname.wav" },
    { ...upload(), name: " " },
    { ...upload(), name: "a".repeat(121) },
    { ...upload(), data: "file:///sound.wav" },
    { ...upload(), data: "bm90IGEgd2F2" },
    { ...upload(), data: `${upload().data}\n` },
    { ...upload(), data: wav(NOTIFICATION_SOUND_MAX_WAV_BYTES + 2).toString("base64") },
  ])("rejects an invalid upload without replacing the saved clip (%#)", async (invalid) => {
    const sound = await load();
    const saved = sound.saveNotificationSound(upload());
    const persisted = fs.readFileSync(storedPath(), "utf8");
    expect(() => sound.saveNotificationSound(invalid)).toThrow("Invalid notification sound");
    expect(sound.getNotificationSound()).toEqual(saved);
    expect(fs.readFileSync(storedPath(), "utf8")).toBe(persisted);
  });

  it.each([4, 16, 20, 22, 24, 28, 32, 34, 40])(
    "rejects a mismatched PCM header at byte %i",
    async (offset) => {
      const bytes = wav();
      bytes[offset] ^= 1;
      const sound = await load();
      expect(() =>
        sound.saveNotificationSound({ ...upload(), data: bytes.toString("base64") }),
      ).toThrow("Invalid notification sound");
      expect(sound.getNotificationSound()).toBeNull();
    },
  );

  it("accepts the maximum duration and changes revision when samples change", async () => {
    const sound = await load();
    const previous = sound.saveNotificationSound(upload());
    const bytes = wav(NOTIFICATION_SOUND_MAX_WAV_BYTES);
    bytes.writeInt16LE(150, 44);
    const saved = sound.saveNotificationSound({ ...upload(), data: bytes.toString("base64") });
    expect(saved.revision).not.toBe(previous.revision);
  });

  it("retains the old asset and file when persistence fails", async () => {
    const sound = await load();
    const previous = sound.saveNotificationSound(upload());
    const persisted = fs.readFileSync(storedPath(), "utf8");
    mocks.failWrite = true;
    expect(() => sound.saveNotificationSound({ ...upload(), name: "replacement.wav" })).toThrow();
    expect(sound.getNotificationSound()).toEqual(previous);
    expect(fs.readFileSync(storedPath(), "utf8")).toBe(persisted);
  });

  it("retries a locked file on the next read and settles only on a missing one", async () => {
    const sound = await load();
    sound.saveNotificationSound(upload());
    vi.resetModules();
    const reloaded = await load();
    const readFile = vi.spyOn(fs, "readFileSync").mockImplementationOnce(() => {
      throw Object.assign(new Error("busy"), { code: "EBUSY" });
    });
    expect(reloaded.getNotificationSound()).toBeNull();
    expect(reloaded.getNotificationSound()?.name).toBe("My chime.wav");
    readFile.mockRestore();
    fs.rmSync(storedPath());
    vi.resetModules();
    const missing = await load();
    expect(missing.getNotificationSound()).toBeNull();
    fs.writeFileSync(storedPath(), JSON.stringify(upload()));
    expect(missing.getNotificationSound()).toBeNull();
  });

  it("resets the saved asset and remains empty after reload", async () => {
    const sound = await load();
    sound.saveNotificationSound(upload());
    expect(sound.resetNotificationSound()).toBeNull();
    expect(sound.getNotificationSound()).toBeNull();
    expect(fs.existsSync(storedPath())).toBe(false);
    vi.resetModules();
    expect((await load()).getNotificationSound()).toBeNull();
  });

  it.each(["missing", "corrupt", "invalid", "oversized"])(
    "falls back to the bundled sound for %s storage",
    async (kind) => {
      if (kind === "corrupt") fs.writeFileSync(storedPath(), "{");
      if (kind === "invalid")
        fs.writeFileSync(storedPath(), JSON.stringify({ ...upload(), data: "bad" }));
      if (kind === "oversized")
        fs.writeFileSync(storedPath(), " ".repeat(NOTIFICATION_SOUND_MAX_WAV_BYTES * 2));
      expect((await load()).getNotificationSound()).toBeNull();
    },
  );
});

it("guards every sound IPC operation with the main renderer guard", async () => {
  const { register } = await import("../../ipc/notificationSoundIpc");
  register();
  expect(mocks.handleAuthorized.mock.calls.map(([channel]) => channel)).toEqual([
    NOTIFICATION_SOUND_GET,
    NOTIFICATION_SOUND_SAVE,
    NOTIFICATION_SOUND_RESET,
  ]);
  for (const [, guard, handler] of mocks.handleAuthorized.mock.calls) {
    expect(guard).toBe(mocks.assertMainRendererSender);
    expect(handler).toBeTypeOf("function");
  }
});
