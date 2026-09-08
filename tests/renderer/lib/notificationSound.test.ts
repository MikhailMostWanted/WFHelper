import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NotificationSoundAsset } from "../../../config/shared/notificationSound";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), warn: vi.fn() }));
vi.mock("../../../src/lib/ipc.js", () => ({ invoke: mocks.invoke }));
vi.mock("../../../src/lib/log.js", () => ({ log: { warn: mocks.warn } }));
vi.mock("../../../src/lib/assetUrls.js", () => ({ NOTIFICATION_SOUND_URL: "file:///default.wav" }));

class MockAudio extends EventTarget {
  static instances: MockAudio[] = [];
  src: string;
  volume = 1;
  currentTime = 0;
  pause = vi.fn(() => {
    this.dispatchEvent(new Event("pause"));
  });
  play = vi.fn(async () => {});

  constructor(src: string) {
    super();
    this.src = src;
    MockAudio.instances.push(this);
  }
}

const custom: NotificationSoundAsset = {
  name: "Custom.wav",
  dataUrl: "data:audio/wav;base64,custom",
  revision: "custom-revision",
};
const load = () => import("../../../src/lib/notificationSound.js");

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("Audio", MockAudio);
  MockAudio.instances = [];
  mocks.invoke.mockReset().mockResolvedValue(custom);
  mocks.warn.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("notification sound playback", () => {
  it("loads each unchanged custom revision once and rewinds the same audio", async () => {
    const sound = await load();
    await sound.playNotificationSound({ volume: 0.4, revision: custom.revision });
    const audio = MockAudio.instances[0];
    expect(audio.src).toBe(custom.dataUrl);
    expect(audio.volume).toBe(0.4);
    audio.currentTime = 8;
    await sound.playNotificationSound({ volume: 0.7, revision: custom.revision });
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("getNotificationSound");
    expect(MockAudio.instances).toHaveLength(1);
    expect(audio.pause).toHaveBeenCalledOnce();
    expect(audio.currentTime).toBe(0);
    expect(audio.volume).toBe(0.7);
    expect(audio.play).toHaveBeenCalledTimes(2);
  });

  it("uses the latest volume if it changes while the custom asset is loading", async () => {
    const sound = await load();
    let resolve!: (asset: NotificationSoundAsset) => void;
    mocks.invoke.mockReturnValueOnce(
      new Promise<NotificationSoundAsset>((done) => {
        resolve = done;
      }),
    );
    const pending = sound.playNotificationSound({ volume: 1, revision: custom.revision });
    sound.updateNotificationSoundSettings(0.15, true);
    resolve(custom);
    await pending;
    expect(MockAudio.instances[0].volume).toBe(0.15);
  });

  it("updates active volume and cancels an in-flight custom sound when muted", async () => {
    const sound = await load();
    await sound.playNotificationSound({ volume: 1, revision: null });
    sound.updateNotificationSoundSettings(0.2, true);
    expect(MockAudio.instances[0].volume).toBe(0.2);
    let resolve!: (asset: NotificationSoundAsset) => void;
    mocks.invoke.mockReturnValueOnce(
      new Promise<NotificationSoundAsset>((done) => {
        resolve = done;
      }),
    );
    const pending = sound.playNotificationSound({ volume: 0.2, revision: custom.revision });
    sound.updateNotificationSoundSettings(0.2, false);
    resolve(custom);
    await pending;
    expect(MockAudio.instances).toHaveLength(1);
    expect(MockAudio.instances[0].play).toHaveBeenCalledTimes(1);
  });

  it("returns to the bundled clip after the custom sound is reset", async () => {
    const sound = await load();
    await sound.playNotificationSound({ volume: 1, revision: custom.revision });
    await sound.playNotificationSound({ volume: 1, revision: null });
    expect(MockAudio.instances[MockAudio.instances.length - 1]?.src).toBe("file:///default.wav");
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it.each([0, -1])("silences live audio at volume %s without loading an asset", async (volume) => {
    const sound = await load();
    await sound.playNotificationSound({ volume: 1, revision: null });
    const audio = MockAudio.instances[0];
    await sound.playNotificationSound({ volume, revision: custom.revision });
    expect(audio.pause).toHaveBeenCalledOnce();
    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("stops live audio for a negative volume the same as zero", async () => {
    const sound = await load();
    await sound.playNotificationSound({ volume: 1, revision: null });
    sound.updateNotificationSoundSettings(-0.5, true);
    expect(MockAudio.instances[0].pause).toHaveBeenCalledOnce();
    expect(MockAudio.instances[0].volume).toBe(0);
  });

  it.each([2, NaN, Infinity])("clamps or defaults volume %s to one", async (volume) => {
    const sound = await load();
    await sound.playNotificationSound({ volume, revision: null });
    expect(MockAudio.instances[0].volume).toBe(1);
  });

  it("does not play a stale asset request after a newer default notification", async () => {
    const sound = await load();
    let resolve!: (asset: NotificationSoundAsset) => void;
    mocks.invoke.mockReturnValueOnce(
      new Promise<NotificationSoundAsset>((done) => {
        resolve = done;
      }),
    );
    const pending = sound.playNotificationSound({ volume: 1, revision: custom.revision });
    await sound.playNotificationSound({ volume: 0.2, revision: null });
    resolve(custom);
    await pending;
    expect(MockAudio.instances).toHaveLength(1);
    expect(MockAudio.instances[0].src).toBe("file:///default.wav");
    expect(MockAudio.instances[0].volume).toBe(0.2);
    expect(MockAudio.instances[0].play).toHaveBeenCalledOnce();
  });

  it("cancels a pending sound when a muted notification supersedes it", async () => {
    const sound = await load();
    let resolve!: (asset: NotificationSoundAsset) => void;
    mocks.invoke.mockReturnValueOnce(
      new Promise<NotificationSoundAsset>((done) => {
        resolve = done;
      }),
    );
    const pending = sound.playNotificationSound({ volume: 1, revision: custom.revision });
    await sound.playNotificationSound({ volume: 0, revision: null });
    resolve(custom);
    await pending;
    expect(MockAudio.instances).toHaveLength(0);
  });

  it("uses the bundled clip if the saved asset disappeared", async () => {
    const sound = await load();
    mocks.invoke.mockResolvedValueOnce(null);
    await sound.playNotificationSound({ volume: 0.5, revision: custom.revision });
    expect(MockAudio.instances[0].src).toBe("file:///default.wav");
    expect(MockAudio.instances[0].volume).toBe(0.5);
  });

  it("contains a rejected asset fetch and reports the failure", async () => {
    const sound = await load();
    mocks.invoke.mockRejectedValueOnce(new Error("IPC unavailable"));
    await expect(
      sound.playNotificationSound({ volume: 1, revision: custom.revision }),
    ).resolves.toBeUndefined();
    expect(mocks.warn).toHaveBeenCalled();
  });

  it("contains a rejected audio play without breaking the next notification", async () => {
    const sound = await load();
    await sound.playNotificationSound({ volume: 1, revision: null });
    const audio = MockAudio.instances[0];
    audio.play.mockRejectedValueOnce(new Error("Playback denied"));
    await expect(
      sound.playNotificationSound({ volume: 1, revision: null }),
    ).resolves.toBeUndefined();
    expect(mocks.warn).toHaveBeenCalled();
    await sound.playNotificationSound({ volume: 0.8, revision: null });
    expect(audio.play).toHaveBeenCalledTimes(3);
  });
});

describe("notification sound preview", () => {
  it("previews the supplied asset without fetching and keeps live audio separate", async () => {
    const sound = await load();
    await sound.playNotificationSound({ volume: 0.5, revision: null });
    const live = MockAudio.instances[0];
    const done = sound.previewNotificationSound(custom, 0.3);
    const preview = MockAudio.instances[1];
    expect(preview.src).toBe(custom.dataUrl);
    expect(preview.volume).toBe(0.3);
    expect(mocks.invoke).not.toHaveBeenCalled();
    sound.stopNotificationSound();
    await done;
    expect(preview.pause).toHaveBeenCalledOnce();
    expect(live.pause).not.toHaveBeenCalled();
  });

  it("stops the previous preview on replacement and on a real notification", async () => {
    const sound = await load();
    const first = sound.previewNotificationSound(custom, 1);
    const second = sound.previewNotificationSound(null, 0);
    await first;
    expect(MockAudio.instances[0].pause).toHaveBeenCalledOnce();
    expect(MockAudio.instances[1].src).toBe("file:///default.wav");
    expect(MockAudio.instances[1].volume).toBe(0);
    await sound.playNotificationSound({ volume: 1, revision: null });
    await second;
    expect(MockAudio.instances[1].pause).toHaveBeenCalledOnce();
  });

  it("keeps a preview pending until the clip ends", async () => {
    const sound = await load();
    let settled = false;
    const done = sound.previewNotificationSound(custom, 1).then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    MockAudio.instances[0].dispatchEvent(new Event("ended"));
    await done;
    expect(settled).toBe(true);
  });

  it("passes preview failures to its caller so Settings can display an error", async () => {
    const sound = await load();
    vi.stubGlobal(
      "Audio",
      class extends MockAudio {
        constructor(src: string) {
          super(src);
          this.play.mockRejectedValue(new Error("Cannot decode"));
        }
      },
    );
    await expect(sound.previewNotificationSound(custom, 1)).rejects.toThrow("Cannot decode");
  });
});
