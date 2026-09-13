export type StartupMode = "grace" | "deadline" | "load-error" | "close-before-show";

export interface StartupObservation {
  windowId: number;
  mode: StartupMode;
  suppressedReady: number;
  suppressedLoad: number;
  failedLoads: number;
  calls: string[];
  savedBounds: { x: number; y: number; width: number; height: number; maximized: boolean };
  initial?: {
    visible: boolean;
    maximized: boolean;
    background: string;
    bounds: { x: number; y: number; width: number; height: number };
  };
}

// Serialized into an Electron entry point so interception precedes production startup.
export function startStartupScenario(root: string, mode: StartupMode): void {
  const load = process.getBuiltinModule("module").createRequire(`${root}/.electron-build/main.js`);
  const { app, BrowserWindow, screen } = load("electron") as typeof import("electron");
  const fs = load("node:fs") as typeof import("node:fs");
  const path = load("node:path") as typeof import("node:path");
  const userData = process.env.WFHELPER_USER_DATA!;
  app.setPath("userData", userData);
  app.getAppPath = () => root;
  const state: StartupObservation = {
    windowId: 0,
    mode,
    suppressedReady: 0,
    suppressedLoad: 0,
    failedLoads: 0,
    calls: [],
    savedBounds: { x: 0, y: 0, width: 1000, height: 700, maximized: false },
  };
  (
    globalThis as typeof globalThis & { startupObservation: StartupObservation }
  ).startupObservation = state;
  const show = BrowserWindow.prototype.show;
  BrowserWindow.prototype.show = function (): void {
    if (this.id === state.windowId) state.calls.push("show");
    show.call(this);
  };
  const maximize = BrowserWindow.prototype.maximize;
  BrowserWindow.prototype.maximize = function (): void {
    if (this.id === state.windowId) state.calls.push("maximize");
    maximize.call(this);
  };
  const loadFile = BrowserWindow.prototype.loadFile;
  BrowserWindow.prototype.loadFile = function (file, options): Promise<void> {
    if (path.resolve(file) === path.join(root, "renderer", "dist", "index.html")) {
      state.windowId = this.id;
      const ready = this.listeners("ready-to-show");
      if (ready.length !== 1)
        throw new Error(`Expected one main ready handler, got ${ready.length}`);
      this.removeListener("ready-to-show", ready[0]);
      this.on("ready-to-show", () => {
        state.suppressedReady += 1;
      });
      (globalThis as typeof globalThis & { releaseStartupReady: () => void }).releaseStartupReady =
        () => {
          this.once("ready-to-show", ready[0]);
          this.emit("ready-to-show");
        };
      if (mode === "deadline" || mode === "close-before-show") {
        // Only main's existing listener is suppressed; loadFile adds its own afterward.
        const finished = this.webContents.listeners("did-finish-load");
        if (finished.length !== 1)
          throw new Error(`Expected one main load handler, got ${finished.length}`);
        this.webContents.removeListener("did-finish-load", finished[0]);
        this.webContents.on("did-finish-load", () => {
          state.suppressedLoad += 1;
        });
      }
      state.initial = {
        visible: this.isVisible(),
        maximized: this.isMaximized(),
        background: this.getBackgroundColor(),
        bounds: this.getBounds(),
      };
      if (mode === "load-error") {
        state.failedLoads += 1;
        return Promise.reject(new Error("Startup fixture rejected renderer loadFile"));
      }
    }
    return loadFile.call(this, file, options);
  };

  const seedBounds = (): void => {
    // Hidden Windows desktops expose a primary display but no enumerated monitors.
    if (screen.getAllDisplays().length === 0) {
      const primary = screen.getPrimaryDisplay();
      screen.getAllDisplays = () => [primary];
    }
    const area = screen.getPrimaryDisplay().workArea;
    state.savedBounds = {
      x: area.x,
      y: area.y,
      width: Math.max(900, Math.min(1000, area.width)),
      height: Math.max(600, Math.min(700, area.height)),
      maximized: process.platform === "win32" && mode === "grace",
    };
    fs.writeFileSync(
      path.join(userData, "main-window-state.json"),
      JSON.stringify(state.savedBounds),
    );
  };
  if (app.isReady()) seedBounds();
  else app.once("ready", seedBounds);
  load("./main.js");
}
