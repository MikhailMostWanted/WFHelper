import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DB_GET_CODEX_SCANS,
  PERSONAL_PROFILE_GET,
  PROFILE_ACCOUNT_CHANGED,
  INVENTORY_STATUS_UPDATED,
} from "../../config/shared/ipcChannels";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  generation: 1,
  getPersonalProfile: vi.fn(),
  getCodexScans: vi.fn(),
  binding: vi.fn(),
  subscribe: vi.fn(),
  subscribeBinding: vi.fn(),
  broadcast: vi.fn(),
  hash: "a".repeat(64) as string | null,
  source: "helper",
  inventory: { LoreFragmentScans: [{ ItemType: "/Lotus/Fragment", Progress: 4 }] },
}));
vi.mock("electron", () => ({ app: {}, BrowserWindow: {}, dialog: {}, shell: {} }));
vi.mock("../../ipc/context", () => ({
  default: {
    get currentInventoryData() {
      return mocks.inventory;
    },
  },
}));
vi.mock("../../ipc/ipcSecurity", () => ({
  assertMainRendererSender: vi.fn(),
  handleAuthorized: (channel: string, _guard: unknown, fn: (...args: unknown[]) => unknown) =>
    mocks.handlers.set(channel, fn),
  onAuthorized: vi.fn(),
}));
vi.mock("../../services/codexProfile", () => ({
  getPersonalProfile: mocks.getPersonalProfile,
  getCodexScans: mocks.getCodexScans,
  getProfileAccountGeneration: () => mocks.generation,
  isInventorySnapshotForCurrentAccount: mocks.binding,
  onProfileAccountChanged: mocks.subscribe,
  onInventoryProfileBindingChanged: mocks.subscribeBinding,
}));
vi.mock("../../ipc/inventoryIpc", () => ({
  getLoadedInventoryHash: () => mocks.hash,
  getInventorySource: () => mocks.source,
  getInventoryStatus: () => ({
    source: mocks.source,
    found: true,
    path: "fixture-inventory.json",
    modifiedAt: 123,
    lastError: null,
  }),
}));
vi.mock("../../ipc/popoutIpc", () => ({ broadcastToRenderers: mocks.broadcast }));
vi.mock("../../services/logger", () => ({
  withScope: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  getLogDirectory: vi.fn(),
}));
vi.mock("../../services/itemDatabase", () => ({}));
vi.mock("../../services/gameLocale", () => ({}));
vi.mock("../../services/wfmCatalog", () => ({}));
vi.mock("../../services/masteryHelper", () => ({}));
vi.mock("../../services/relicService", () => ({}));
vi.mock("../../services/dropData", () => ({}));
vi.mock("../../services/autoUpdater", () => ({}));
vi.mock("../../services/rewardScanDebug", () => ({}));
vi.mock("../../services/linuxDisplayBackend", () => ({}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.generation = 1;
  mocks.hash = "a".repeat(64);
  mocks.source = "helper";
  mocks.handlers.clear();
  mocks.binding.mockReturnValue(true);
  mocks.subscribe.mockReturnValue(() => undefined);
  mocks.subscribeBinding.mockReturnValue(() => undefined);
  mocks.getCodexScans.mockResolvedValue({
    scans: [{ type: "/Lotus/Enemy", count: 2 }],
    fetchedAt: 123,
    nextRefreshAt: 0,
  });
  mocks.getPersonalProfile.mockResolvedValue({
    profile: { displayName: "Old account" },
    fetchedAt: 123,
    status: "ready",
    nextRefreshAt: 0,
  });
});

async function invoke(channel: string): Promise<unknown> {
  const { register } = await import("../../ipc/systemIpc");
  register();
  return mocks.handlers.get(channel)!(undefined, true);
}

describe("profile IPC account isolation", () => {
  it("discards Codex output if account changes after service resolution but before IPC continuation", async () => {
    mocks.getCodexScans.mockImplementation(() => {
      queueMicrotask(() => {
        mocks.generation++;
      });
      return Promise.resolve({ scans: [{ type: "/Lotus/OldAccount", count: 99 }], fetchedAt: 123 });
    });
    expect(await invoke(DB_GET_CODEX_SCANS)).toMatchObject({
      error: "account-changed",
      nextRefreshAt: 0,
    });
    expect(mocks.binding).not.toHaveBeenCalled();
  });

  it("discards Personal output across the same continuation race", async () => {
    mocks.getPersonalProfile.mockImplementation(() => {
      queueMicrotask(() => {
        mocks.generation++;
      });
      return Promise.resolve({
        profile: { displayName: "Old account" },
        status: "ready",
        fetchedAt: 123,
        nextRefreshAt: 0,
      });
    });
    expect(await invoke(PERSONAL_PROFILE_GET)).toMatchObject({
      profile: null,
      fetchedAt: null,
      status: "account-changed",
      nextRefreshAt: 0,
    });
  });

  it("merges only an exact inventory snapshot bound to the current account", async () => {
    expect(await invoke(DB_GET_CODEX_SCANS)).toMatchObject({
      scans: [
        { type: "/Lotus/Enemy", count: 2 },
        { type: "/Lotus/Fragment", count: 4 },
      ],
    });
    expect(mocks.binding).toHaveBeenCalledWith(mocks.hash);
    mocks.binding.mockReturnValue(false);
    expect(await mocks.handlers.get(DB_GET_CODEX_SCANS)!(undefined, false)).toMatchObject({
      scans: [{ type: "/Lotus/Enemy", count: 2 }],
    });
    mocks.hash = null;
    mocks.binding.mockClear();
    await mocks.handlers.get(DB_GET_CODEX_SCANS)!(undefined, false);
    expect(mocks.binding).not.toHaveBeenCalled();
  });

  it("subscribes only once across repeated registrations and broadcasts no account details", async () => {
    const { register } = await import("../../ipc/systemIpc");
    register();
    register();
    expect(mocks.subscribe).toHaveBeenCalledTimes(1);
    mocks.subscribe.mock.calls[0][0]();
    expect(mocks.broadcast).toHaveBeenCalledExactlyOnceWith(PROFILE_ACCOUNT_CHANGED);
  });
});

it("reloads same-account Codex data when unchanged inventory becomes bound", async () => {
  const { register } = await import("../../ipc/systemIpc");
  register();
  register();
  expect(mocks.subscribeBinding).toHaveBeenCalledTimes(1);
  mocks.binding.mockReturnValue(false);
  expect(await mocks.handlers.get(DB_GET_CODEX_SCANS)!(undefined, false)).toMatchObject({
    scans: [{ type: "/Lotus/Enemy", count: 2 }],
  });
  mocks.binding.mockReturnValue(true);
  mocks.subscribeBinding.mock.calls[0][0]();
  expect(mocks.broadcast).toHaveBeenCalledExactlyOnceWith(INVENTORY_STATUS_UPDATED, {
    source: "helper",
    found: true,
    path: "fixture-inventory.json",
    modifiedAt: 123,
    lastError: null,
  });
  expect(await mocks.handlers.get(DB_GET_CODEX_SCANS)!(undefined, false)).toMatchObject({
    scans: [
      { type: "/Lotus/Enemy", count: 2 },
      { type: "/Lotus/Fragment", count: 4 },
    ],
  });
});
