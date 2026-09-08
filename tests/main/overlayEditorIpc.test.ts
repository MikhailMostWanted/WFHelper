import { EventEmitter } from "node:events";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow, IpcMainInvokeEvent, WebContents } from "electron";

import { OVERLAY_SETTINGS_DEFAULTS } from "../../config/runtime/overlaySettings";
import {
  OVERLAY_EDIT_BEGIN,
  OVERLAY_EDIT_STATE,
  OVERLAY_EDIT_END,
  OVERLAY_EDIT_PREVIEW,
  OVERLAY_EDIT_UPDATE,
  OVERLAY_LAYOUT_GET,
} from "../../config/shared/ipcChannels";
import {
  DEFAULT_OVERLAY_FIELD_STYLE,
  OVERLAY_LAYOUT_KINDS,
  getOverlayDescriptor,
  type OverlayEditState,
} from "../../config/shared/overlayLayout";
import ctx from "../../ipc/context";
import { registerOverlayEditor } from "../../ipc/overlay/editorIpc";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>>(),
}));
vi.mock("electron", () => ({
  app: { getAppPath: () => process.cwd() },
  ipcMain: {
    handle: (
      channel: string,
      handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>,
    ) => mocks.handlers.set(channel, handler),
  },
}));
vi.mock("../../services/logger", () => ({
  withScope: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock("../../ipc/overlayI18n", () => ({
  overlayMessages: () => ({ locale: "en", messages: {} }),
}));

function windowStub(id: number, file: string) {
  const url = pathToFileURL(path.join(process.cwd(), "renderer", file)).href;
  const contents = Object.assign(new EventEmitter(), {
    id,
    send: vi.fn(),
    isDestroyed: () => false,
    getURL: () => url,
  });
  const window = { isDestroyed: () => false, webContents: contents } as unknown as BrowserWindow;
  const event = {
    sender: contents as unknown as WebContents,
    senderFrame: { url },
  } as IpcMainInvokeEvent;
  return { window, event, contents };
}

function invoke(channel: string, event: IpcMainInvokeEvent, ...args: unknown[]): Promise<unknown> {
  const handler = mocks.handlers.get(channel);
  if (!handler) throw new Error(`Missing IPC ${channel}`);
  return handler(event, ...args);
}

beforeEach(() => {
  mocks.handlers.clear();
  ctx.mainWindow = null;
  ctx.overlayWindow = null;
  ctx.plannerOverlayWindow = null;
  ctx.rivenOverlayLeftWindow = null;
  ctx.rivenOverlayRightWindow = null;
  ctx.arbiSummaryWindow = null;
  ctx.tradeNotificationWindow = null;
  ctx.overlaySettings = {
    ...OVERLAY_SETTINGS_DEFAULTS,
    fissureAlerts: [],
    overlayLayouts: {
      planner: {
        version: 1,
        fields: { relicName: { ...DEFAULT_OVERLAY_FIELD_STYLE, color: "#aabbcc" } },
      },
    },
  };
});

describe("overlay editor IPC boundaries", () => {
  it("returns only the live sender's saved layout while another renderer owns a draft", async () => {
    const main = windowStub(1, "dist/index.html");
    const planner = windowStub(2, "overlay.html");
    const reward = windowStub(3, "overlay.html");
    ctx.mainWindow = main.window;
    ctx.plannerOverlayWindow = planner.window;
    ctx.overlayWindow = reward.window;
    const persist = vi.fn(() => true);
    const reposition = vi.fn();
    registerOverlayEditor(persist, reposition);
    const draft = (await invoke(OVERLAY_EDIT_BEGIN, main.event, "planner")) as OverlayEditState;
    await invoke(OVERLAY_EDIT_UPDATE, main.event, draft.sessionId, {
      type: "field",
      field: "relicName",
      patch: { hidden: true },
    });
    const saved = (await invoke(OVERLAY_LAYOUT_GET, planner.event)) as OverlayEditState;
    expect(saved).toMatchObject({ kind: "planner", sessionId: null });
    expect(saved.layout.fields.relicName).toMatchObject({ color: "#aabbcc", hidden: false });
    expect(await invoke(OVERLAY_LAYOUT_GET, reward.event)).toMatchObject({
      kind: "reward",
      sessionId: null,
    });
    expect(planner.contents.send).not.toHaveBeenCalled();
    await invoke(OVERLAY_EDIT_END, main.event, draft.sessionId, true);
    expect(planner.contents.send).toHaveBeenCalledOnce();
    expect(reward.contents.send).not.toHaveBeenCalled();
    expect(reposition).toHaveBeenCalledExactlyOnceWith("planner");
    expect(
      ((await invoke(OVERLAY_LAYOUT_GET, planner.event)) as OverlayEditState).layout.fields
        .relicName?.hidden,
    ).toBe(true);
  });

  it("blocks imported layouts while a draft is active and permits them after cancel", async () => {
    const main = windowStub(1, "dist/index.html");
    ctx.mainWindow = main.window;
    const controls = registerOverlayEditor(
      vi.fn(() => true),
      vi.fn(),
    );
    expect(() => controls.assertIdle()).not.toThrow();
    const draft = (await invoke(OVERLAY_EDIT_BEGIN, main.event, "planner")) as OverlayEditState;
    expect(() => controls.assertIdle()).toThrow(
      "Close the overlay editor before importing layouts",
    );
    await invoke(OVERLAY_EDIT_END, main.event, draft.sessionId, false);
    expect(() => controls.assertIdle()).not.toThrow();
  });

  it("refreshes all six live windows from saved layouts and repositions each", () => {
    const windows = OVERLAY_LAYOUT_KINDS.map((_kind, index) =>
      windowStub(index + 2, "overlay.html"),
    );
    ctx.overlayWindow = windows[0]!.window;
    ctx.plannerOverlayWindow = windows[1]!.window;
    ctx.rivenOverlayLeftWindow = windows[2]!.window;
    ctx.rivenOverlayRightWindow = windows[3]!.window;
    ctx.arbiSummaryWindow = windows[4]!.window;
    ctx.tradeNotificationWindow = windows[5]!.window;
    const reposition = vi.fn();
    const persist = vi.fn(() => true);
    const controls = registerOverlayEditor(persist, reposition);
    ctx.overlaySettings.overlayLayouts = Object.fromEntries(
      OVERLAY_LAYOUT_KINDS.map((kind) => [
        kind,
        {
          version: 1,
          fields: {
            [getOverlayDescriptor(kind).fields[0]!]: {
              ...DEFAULT_OVERLAY_FIELD_STYLE,
              color: "#123456",
              hidden: true,
            },
          },
        },
      ]),
    );
    ctx.overlaySettings.rewardLayout = ctx.overlaySettings.overlayLayouts.reward;
    controls.refresh();
    for (const [index, kind] of OVERLAY_LAYOUT_KINDS.entries()) {
      const field = getOverlayDescriptor(kind).fields[0]!;
      expect(windows[index]!.contents.send).toHaveBeenCalledExactlyOnceWith(
        OVERLAY_EDIT_STATE,
        expect.objectContaining({
          kind,
          sessionId: null,
          layout: expect.objectContaining({
            fields: expect.objectContaining({
              [field]: expect.objectContaining({ hidden: true, color: "#123456" }),
            }),
          }),
        }),
      );
      expect(reposition).toHaveBeenCalledWith(kind);
    }
    expect(reposition).toHaveBeenCalledTimes(6);
    expect(persist).not.toHaveBeenCalled();
  });

  it("rejects native mutation, main-window layout reads and iframe sender impersonation", async () => {
    const main = windowStub(1, "dist/index.html");
    const native = windowStub(2, "riven-overlay.html");
    ctx.mainWindow = main.window;
    ctx.rivenOverlayLeftWindow = native.window;
    registerOverlayEditor(
      vi.fn(() => true),
      vi.fn(),
    );
    const draft = (await invoke(OVERLAY_EDIT_BEGIN, main.event, "rivenLeft")) as OverlayEditState;
    for (const [channel, args] of [
      [OVERLAY_EDIT_BEGIN, ["rivenLeft"]],
      [OVERLAY_EDIT_PREVIEW, ["rivenLeft"]],
      [OVERLAY_EDIT_UPDATE, [draft.sessionId, { type: "reset" }]],
      [OVERLAY_EDIT_END, [draft.sessionId, true]],
    ] as const)
      await expect(invoke(channel, native.event, ...args)).rejects.toThrow(
        "Unauthorized IPC sender",
      );
    await expect(invoke(OVERLAY_LAYOUT_GET, main.event)).rejects.toThrow("Unauthorized IPC sender");
    const iframe = {
      ...main.event,
      senderFrame: {
        url:
          pathToFileURL(path.join(process.cwd(), "renderer", "overlay.html")).href +
          "?mode=editor&kind=reward",
      },
    } as IpcMainInvokeEvent;
    await expect(
      invoke(OVERLAY_EDIT_UPDATE, iframe, draft.sessionId, { type: "reset" }),
    ).rejects.toThrow("Unauthorized IPC sender");
    const wrongUrl = {
      ...native.event,
      senderFrame: { url: "https://example.com/renderer/riven-overlay.html" },
    } as IpcMainInvokeEvent;
    await expect(invoke(OVERLAY_LAYOUT_GET, wrongUrl)).rejects.toThrow("Unauthorized IPC sender");
    await invoke(OVERLAY_EDIT_END, main.event, draft.sessionId, false);
  });

  it.each([undefined, null, "__proto__", "constructor", "riven", { kind: "reward" }])(
    "rejects unsupported preview kinds: %j",
    async (kind) => {
      const main = windowStub(1, "dist/index.html");
      ctx.mainWindow = main.window;
      registerOverlayEditor(
        vi.fn(() => true),
        vi.fn(),
      );
      await expect(invoke(OVERLAY_EDIT_BEGIN, main.event, kind)).rejects.toThrow(
        "Invalid overlay kind",
      );
      await expect(invoke(OVERLAY_EDIT_PREVIEW, main.event, kind)).rejects.toThrow(
        "Invalid overlay kind",
      );
    },
  );
});
