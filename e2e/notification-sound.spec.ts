import { expect, test } from "@playwright/test";

import { NOTIFICATION_SOUND_PLAY } from "../config/shared/ipcChannels";
import {
  closeElectronTestHarness,
  evaluateInMain,
  launchElectronTestHarness,
  openView,
  setLayoutViewport,
  type ElectronTestHarness,
} from "./electronTestHarness";

function soundFixture(): Buffer {
  const bytes = Buffer.alloc(44 + 4800);
  bytes.write("RIFF");
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(24000, 24);
  bytes.writeUInt32LE(48000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(bytes.length - 44, 40);
  for (let index = 0; index < 2400; index++)
    bytes.writeInt16LE(Math.round(Math.sin(index / 8) * 1000), 44 + index * 2);
  return bytes;
}

test("custom sound persists, previews and plays while hidden without native audio", async () => {
  let harness: ElectronTestHarness | undefined;
  const errors: string[] = [];
  try {
    harness = await launchElectronTestHarness("wfh-sound-", {
      userDataFiles: { "overlay-settings.json": { notificationSoundEnabled: true } },
      onPage: async (page) => {
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (message) => {
          if (/Content Security Policy|Refused to load/.test(message.text()))
            errors.push(message.text());
        });
        await page.addInitScript(() => {
          const scope = window as unknown as {
            soundPlays: Array<{ custom: boolean; volume: number; ended: boolean }>;
          };
          scope.soundPlays = [];
          const original = HTMLMediaElement.prototype.play;
          HTMLMediaElement.prototype.play = function () {
            // Decode and finish playback normally, without audible test output.
            this.muted = true;
            const entry = {
              custom: this.src.startsWith("data:audio/wav;"),
              volume: this.volume,
              ended: false,
            };
            scope.soundPlays.push(entry);
            this.addEventListener(
              "ended",
              () => {
                entry.ended = true;
              },
              { once: true },
            );
            return original.call(this);
          };
        });
      },
    });
    const { app, page } = harness;
    await setLayoutViewport(page, 1280, 1000);
    await openView(page, "settings");
    const file = page.locator('[data-setting="notification-sound-file"]');
    await expect(file).toBeEnabled();
    await file.setInputFiles({
      name: "notification-test.wav",
      mimeType: "audio/wav",
      buffer: soundFixture(),
    });
    await expect(page.locator("[data-notification-sound-name]")).toHaveText(
      "notification-test.wav",
    );
    const volume = page.locator('[data-setting="notification-sound-volume"]');
    await volume.fill("37");
    await expect
      .poll(() =>
        page.evaluate(async () => (await window.api.getOverlaySettings()).notificationSoundVolume),
      )
      .toBe(0.37);
    const saved = await page.evaluate(() => window.api.getNotificationSound());
    expect(saved?.dataUrl.startsWith("data:audio/wav;base64,")).toBe(true);
    const plays = () =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              soundPlays: Array<{ custom: boolean; volume: number; ended: boolean }>;
            }
          ).soundPlays,
      );
    await page.locator('[data-setting="notification-sound-preview"]').click();
    await expect.poll(plays).toEqual([{ custom: true, volume: 0.37, ended: true }]);
    await file.setInputFiles({
      name: "broken.wav",
      mimeType: "audio/wav",
      buffer: Buffer.from("not audio"),
    });
    await expect(page.locator("[data-notification-sound-error]")).toBeVisible();
    await expect(page.locator("[data-notification-sound-name]")).toHaveText(
      "notification-test.wav",
    );

    await page.reload();
    await openView(page, "settings");
    await expect(volume).toHaveValue("37");
    await expect(page.locator("[data-notification-sound-name]")).toHaveText(
      "notification-test.wav",
    );
    await page
      .locator("[data-notification-sound-settings]")
      .screenshot({ path: test.info().outputPath("notification-sound.png") });
    await evaluateInMain(
      app,
      ({ BrowserWindow }, payload) => {
        const main = BrowserWindow.getAllWindows().find((win) =>
          win.webContents.getURL().includes("dist/index.html"),
        );
        if (!main) throw new Error("Main window missing");
        main.hide();
        main.webContents.send(payload.channel, { volume: 0.37, revision: payload.revision });
      },
      { channel: NOTIFICATION_SOUND_PLAY, revision: saved!.revision },
    );
    await expect.poll(plays).toEqual([{ custom: true, volume: 0.37, ended: true }]);
    await evaluateInMain(app, ({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()
        .find((win) => win.webContents.getURL().includes("dist/index.html"))
        ?.show();
    });
    await page.locator('[data-setting="notification-sound-reset"]').click();
    await expect.poll(() => page.evaluate(() => window.api.getNotificationSound())).toBeNull();
    await page.locator('[data-setting="notification-sound-preview"]').click();
    await expect
      .poll(async () => (await plays()).at(-1))
      .toEqual({ custom: false, volume: 0.37, ended: true });
    await page.locator('[data-setting="notification-sound-system"]').check();
    await expect(volume).toBeDisabled();
    await expect(page.locator('[data-setting="notification-sound-preview"]')).toBeDisabled();
    expect(errors).toEqual([]);
  } finally {
    await closeElectronTestHarness(harness);
  }
});
