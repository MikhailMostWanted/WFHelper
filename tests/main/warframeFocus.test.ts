import Module from "node:module";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { queryExePath } from "../../services/win32Process";

vi.mock("../../services/logger", () => ({
  withScope: () => ({ info: vi.fn(), warn: vi.fn() }),
}));
vi.mock("../../services/win32Process", async (original) => ({
  ...(await original<typeof import("../../services/win32Process")>()),
  queryExePath: vi.fn(),
}));

const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
const originalLoad = loader._load;
const realPlatform = process.platform;
const GAME = 100n;
const OVERLAY = 200n;
const MAIN_WINDOW = 300n;
const OTHER_APP = 400n;
const gamePath = "C:\\Warframe\\Warframe.x64.exe";
let foreground: bigint | number;
let gamePid: number;
let status: typeof import("../../services/warframeStatus");
const setForeground = vi.fn(() => 1);

function handle(value: bigint): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(value);
  return buffer;
}

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  foreground = GAME;
  gamePid = 10;
  const native = {
    GetForegroundWindow: () => foreground,
    SetForegroundWindow: setForeground,
    GetWindowThreadProcessId: (window: bigint, out: Buffer) => {
      out.writeUInt32LE(window === GAME ? gamePid : Number(window), 0);
      return 1;
    },
  };
  vi.spyOn(loader, "_load").mockImplementation((id, ...args) =>
    id === "koffi"
      ? {
          load: () => ({
            func: (_convention: string, name: string) => native[name as keyof typeof native],
          }),
        }
      : originalLoad.call(Module, id, ...args),
  );
  Object.defineProperty(process, "platform", { value: "win32", configurable: true });
  vi.mocked(queryExePath).mockImplementation((pid) => ({
    status: "ok",
    path: pid === 10 ? gamePath : "C:\\Apps\\WantedFrame.exe",
  }));
  status = await import("../../services/warframeStatus");
});

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(process, "platform", { value: realPlatform, configurable: true });
});

describe("overlay focus return", () => {
  it("returns to the captured game once, only from a known overlay", () => {
    foreground = Number(GAME);
    status.captureWarframeFocus();
    foreground = OVERLAY;

    expect(status.restoreWarframeFocus([handle(OVERLAY)])).toBe(true);
    expect(setForeground).toHaveBeenCalledExactlyOnceWith(GAME);
    expect(status.restoreWarframeFocus([handle(OVERLAY)])).toBe(false);
  });

  it.each([MAIN_WINDOW, OTHER_APP, 0n])("leaves foreground window %s alone", (window) => {
    status.captureWarframeFocus();
    foreground = window;

    expect(status.restoreWarframeFocus([handle(OVERLAY)])).toBe(false);
    foreground = OVERLAY;
    expect(status.restoreWarframeFocus([handle(OVERLAY)])).toBe(false);
    expect(setForeground).not.toHaveBeenCalled();
  });

  it("does not capture another app or keep an earlier game target", () => {
    status.captureWarframeFocus();
    foreground = OTHER_APP;
    status.captureWarframeFocus();
    foreground = OVERLAY;

    expect(status.restoreWarframeFocus([handle(OVERLAY)])).toBe(false);
    expect(setForeground).not.toHaveBeenCalled();
  });

  it.each([0, 11])("rejects a stale game handle whose current PID is %s", (pid) => {
    status.captureWarframeFocus();
    gamePid = pid;
    foreground = OVERLAY;

    expect(status.restoreWarframeFocus([handle(OVERLAY)])).toBe(false);
    expect(setForeground).not.toHaveBeenCalled();
  });

  it.each([
    { status: "unknown" as const },
    { status: "ok" as const, path: "C:\\Apps\\WarframeLauncher.exe" },
  ])("rechecks the captured executable before restoring: %j", (query) => {
    status.captureWarframeFocus();
    vi.mocked(queryExePath).mockReturnValue(query);
    foreground = OVERLAY;

    expect(status.restoreWarframeFocus([handle(OVERLAY)])).toBe(false);
    expect(setForeground).not.toHaveBeenCalled();
  });
});

describe("overlay foreground guard", () => {
  it.each([
    [GAME, true],
    [OVERLAY, true],
    [MAIN_WINDOW, false],
    [OTHER_APP, false],
    [0n, false],
  ] as const)("allows only the game and supplied overlays: %s", (window, allowed) => {
    foreground = window;
    expect(status.isWarframeOrWindowForeground([handle(OVERLAY)])).toBe(allowed);
  });

  it("does not mistake a launcher for the game", () => {
    vi.mocked(queryExePath).mockReturnValue({
      status: "ok",
      path: "C:\\Warframe\\WarframeLauncher.exe",
    });
    expect(status.isWarframeOrWindowForeground([])).toBe(false);
  });
});
