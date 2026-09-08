import { beforeEach, describe, expect, it, vi } from "vitest";

import type { InventorySource } from "../../config/shared/inventorySource";

function makeRunner() {
  return {
    startPolling: vi.fn<(intervalMs?: number, onRunComplete?: (ok: boolean) => void) => void>(),
    stopPolling: vi.fn<() => void>(),
    runAfterGameLogin: vi.fn<() => void>(),
    runOnce: vi.fn<() => Promise<boolean>>(),
  };
}

type Runner = ReturnType<typeof makeRunner>;

async function loadModule(): Promise<typeof import("../../services/inventorySync")> {
  vi.resetModules();
  return import("../../services/inventorySync");
}

async function initSync(
  source: InventorySource,
  autoSyncEnabled: boolean,
): Promise<{
  sync: typeof import("../../services/inventorySync");
  runner: Runner;
  onRun: (ok: boolean) => void;
}> {
  const sync = await loadModule();
  const runner = makeRunner();
  const onRun = vi.fn<(ok: boolean) => void>();
  sync.init({
    runner,
    getSource: () => source,
    isAutoSyncEnabled: () => autoSyncEnabled,
    onRunComplete: onRun,
  });
  return { sync, runner, onRun };
}

describe("autoSyncSkipReason", () => {
  it("allows automatic acquisition only for the helper source with sync on", async () => {
    const { autoSyncSkipReason } = await loadModule();
    expect(autoSyncSkipReason("helper", true)).toBeNull();
    expect(autoSyncSkipReason("helper", false)).toBe("automatic inventory sync is off");
    expect(autoSyncSkipReason("manual", true)).toBe('inventory source is "manual"');
    expect(autoSyncSkipReason("aleca", true)).toBe('inventory source is "aleca"');
    expect(autoSyncSkipReason("manual", false)).toBe('inventory source is "manual"');
  });
});

describe("inventorySync.apply", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts polling for the default helper source", async () => {
    const { sync, runner, onRun } = await initSync("helper", true);
    sync.apply("startup");

    expect(runner.startPolling).toHaveBeenCalledWith(undefined, onRun);
    expect(runner.stopPolling).not.toHaveBeenCalled();
  });

  it("never polls or retries login when no inventory is selected", async () => {
    const { sync, runner } = await initSync("none", true);
    sync.apply("startup");
    sync.onGameLogin();
    expect(runner.startPolling).not.toHaveBeenCalled();
    expect(runner.runAfterGameLogin).not.toHaveBeenCalled();
    expect(runner.stopPolling).toHaveBeenCalledOnce();
  });

  it("skips and stops polling for a manually imported inventory", async () => {
    const { sync, runner } = await initSync("manual", true);
    sync.apply("startup");

    expect(runner.startPolling).not.toHaveBeenCalled();
    expect(runner.stopPolling).toHaveBeenCalledTimes(1);
  });

  it("skips and stops polling for an AlecaFrame inventory", async () => {
    const { sync, runner } = await initSync("aleca", true);
    sync.apply("startup");

    expect(runner.startPolling).not.toHaveBeenCalled();
    expect(runner.stopPolling).toHaveBeenCalledTimes(1);
  });

  it("skips when automatic sync is switched off on the helper source", async () => {
    const { sync, runner } = await initSync("helper", false);
    sync.apply("settings");

    expect(runner.startPolling).not.toHaveBeenCalled();
    expect(runner.stopPolling).toHaveBeenCalledTimes(1);
  });

  it("resumes polling once the source flips back to the helper", async () => {
    const sync = await loadModule();
    const runner = makeRunner();
    const onRun = vi.fn<(ok: boolean) => void>();
    let source: InventorySource = "manual";
    sync.init({
      runner,
      getSource: () => source,
      isAutoSyncEnabled: () => true,
      onRunComplete: onRun,
    });

    sync.apply("startup");
    expect(runner.startPolling).not.toHaveBeenCalled();

    source = "helper";
    sync.apply("source helper");

    expect(runner.startPolling).toHaveBeenCalledWith(undefined, onRun);
  });

  it("does nothing before init", async () => {
    const sync = await loadModule();
    expect(() => sync.apply("startup")).not.toThrow();
  });

  it("never triggers a run on its own - the manual button owns runOnce", async () => {
    const { sync, runner } = await initSync("helper", true);
    sync.apply("startup");
    sync.onGameLogin();

    expect(runner.runOnce).not.toHaveBeenCalled();
  });
});

describe("inventorySync.onGameLogin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rescans after a Warframe login on the helper source", async () => {
    const { sync, runner } = await initSync("helper", true);
    sync.onGameLogin();

    expect(runner.runAfterGameLogin).toHaveBeenCalledTimes(1);
  });

  it("does not rescan for a manual source", async () => {
    const { sync, runner } = await initSync("manual", true);
    sync.onGameLogin();

    expect(runner.runAfterGameLogin).not.toHaveBeenCalled();
  });

  it("does not rescan while automatic sync is off", async () => {
    const { sync, runner } = await initSync("helper", false);
    sync.onGameLogin();

    expect(runner.runAfterGameLogin).not.toHaveBeenCalled();
  });
});
