import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";

import { afterEach, describe, expect, it, vi } from "vitest";

const tempDirs: string[] = [];
const { closeNativeElectron } = createRequire(__filename)("../../scripts/native-electron.cjs") as {
  closeNativeElectron: (app: unknown) => Promise<void>;
};
const root = path.resolve(__dirname, "../..");
const { preserveNativeDiagnostics } = createRequire(__filename)(
  "../../scripts/native-artifacts.cjs",
) as {
  preserveNativeDiagnostics: (
    source: string,
    name: string,
    files: string[],
    artifactRoot?: string,
  ) => string;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

async function runRewardHarness(
  options: { missing?: string; corrupt?: string; generationError?: boolean } = {},
) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "wfh-harness-contract-"));
  tempDirs.push(scratch);
  const messages: string[] = [];
  let exitCode = 0;
  const host = Object.assign(new EventEmitter(), {
    stderr: new EventEmitter(),
    exitCode: 134,
    signalCode: null,
  });
  const launch = vi.fn(async () => ({
    process: () => host,
    evaluate: async () => {
      host.emit("exit", 134, null);
      throw new Error("Target page, context or browser has been closed");
    },
    close: async () => {},
  }));
  const sharp = () => ({
    metadata: async () => ({ width: 1920, height: 1080 }),
    resize: () => sharp(),
    extend: () => sharp(),
    png: () => sharp(),
    toFile: async () => {},
  });
  const modules: Record<string, unknown> = {
    "node:fs": {
      ...fs,
      existsSync: (file: string) =>
        !file.includes(`${path.sep}fixtures${path.sep}screens${path.sep}`) &&
        path.basename(file) !== options.missing,
      readFileSync: (file: string, encoding?: "utf8") => {
        if (path.basename(file) === options.corrupt) return Buffer.from("corrupt fixture");
        return encoding ? fs.readFileSync(file, encoding) : fs.readFileSync(file);
      },
    },
    "node:os": { tmpdir: () => scratch },
    "node:crypto": { createHash },
    "node:path": path,
    "node:child_process": {
      execFileSync: () => {
        if (options.generationError) throw new Error("synthetic generator failed");
      },
    },
    "@playwright/test": { _electron: { launch } },
    "./build-screens.cjs": { buildRealScreens: async () => {} },
    "../native-artifacts.cjs": { preserveNativeDiagnostics },
    "../native-electron.cjs": { closeNativeElectron },
    sharp,
  };
  const script = path.join(root, "scripts/reward-scan-e2e/run-check.cjs");
  await new vm.Script(fs.readFileSync(script, "utf8"), { filename: script }).runInNewContext({
    require: (name: string) => {
      if (!(name in modules)) throw new Error(`Unexpected module: ${name}`);
      return modules[name];
    },
    __dirname: path.dirname(script),
    process: {
      env: {
        REWARD_SCAN_READERS: "onnx",
        WFHELPER_NATIVE_ARTIFACTS: path.join(scratch, "artifacts"),
      },
      argv: ["node", script],
      exit: (code: number) => {
        exitCode = code;
      },
    },
    console: {
      log: (...args: unknown[]) => messages.push(args.join(" ")),
      error: (...args: unknown[]) => messages.push(args.join(" ")),
    },
    setTimeout: (callback: () => void) => queueMicrotask(callback),
  });
  return { exitCode, launch, output: messages.join("\n"), scratch };
}

async function runLinuxSmoke(options: {
  launchError?: string;
  pageError?: string;
  closeCode?: number;
}) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "wfh-linux-contract-"));
  tempDirs.push(scratch);
  const messages: string[] = [];
  let exitCode = 0;
  const exited = new Error("script exited");
  const page = Object.assign(new EventEmitter(), {
    url: () => "file:///app/renderer/dist/index.html",
    waitForSelector: async () => {
      if (options.pageError) page.emit("pageerror", new Error(options.pageError));
    },
    waitForFunction: async () => {},
  });
  const host = Object.assign(new EventEmitter(), {
    stderr: new EventEmitter(),
    kill: vi.fn(),
    exitCode: options.closeCode ?? 0,
    signalCode: null,
  });
  const app = Object.assign(new EventEmitter(), {
    windows: () => [page],
    process: () => host,
    close: async () => {},
  });
  const script = path.join(root, "scripts/linux-boot-smoke.mjs");
  const source = fs.readFileSync(script, "utf8").replace(/^import .*;\r?\n/gm, "");
  try {
    await new vm.Script(`(async () => { ${source} })()`, { filename: script }).runInNewContext({
      fs,
      os: { tmpdir: () => scratch },
      path,
      preserveNativeDiagnostics,
      closeNativeElectron,
      electron: {
        launch: async () => {
          if (options.launchError) throw new Error(options.launchError);
          return app;
        },
      },
      process: {
        platform: "linux",
        env: { WFHELPER_NATIVE_ARTIFACTS: path.join(scratch, "artifacts") },
        exit: (code: number) => {
          exitCode = code;
          throw exited;
        },
      },
      console: {
        log: (...args: unknown[]) => messages.push(args.join(" ")),
        error: (...args: unknown[]) => messages.push(args.join(" ")),
      },
      setTimeout: (callback: () => void, ms: number) => {
        if (ms < 15_000) queueMicrotask(callback);
      },
      clearTimeout: () => {},
    });
  } catch (err) {
    if (err !== exited) throw err;
  }
  return { exitCode, output: messages.join("\n"), scratch };
}

describe("native verification failure contracts", () => {
  it("copies selected diagnostics without profiles or credential-bearing lines", () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "wfh-artifact-privacy-"));
    tempDirs.push(scratch);
    fs.writeFileSync(
      path.join(scratch, "host.log"),
      "scan failed\nAuthorization: Bearer secret\naccess_token=secret\n",
    );
    fs.writeFileSync(path.join(scratch, "wfm.session"), "private encrypted profile");
    const output = preserveNativeDiagnostics(
      scratch,
      "test",
      ["host.log"],
      path.join(scratch, "artifacts"),
    );
    expect(fs.readdirSync(output)).toEqual(["host.log"]);
    const log = fs.readFileSync(path.join(output, "host.log"), "utf8");
    expect(log).toContain("scan failed");
    expect(log).not.toContain("secret");
    expect(fs.readFileSync(path.join(scratch, "host.log"), "utf8")).toContain("secret");
  });

  it("fails before launching when a required public capture is missing", async () => {
    const result = await runRewardHarness({ missing: "real-full-2p.png" });
    expect(result.exitCode).toBe(1);
    expect(result.launch).not.toHaveBeenCalled();
    expect(result.output).toContain("Required fixture missing: real-full-2p.png");
  });

  it("fails before launching when synthetic generation fails", async () => {
    const result = await runRewardHarness({ generationError: true });
    expect(result.exitCode).toBe(1);
    expect(result.launch).not.toHaveBeenCalled();
    expect(result.output).toContain("synthetic generator failed");
  });

  it("refuses a public capture whose bytes no longer match its reviewed manifest", async () => {
    const result = await runRewardHarness({ corrupt: "real-full-2p.png" });
    expect(result.exitCode).toBe(1);
    expect(result.launch).not.toHaveBeenCalled();
    expect(result.output).toContain("Public fixture checksum mismatch: real-full-2p.png");
  });

  it("fails on the first host crash and retains its scan and exit diagnostics", async () => {
    const result = await runRewardHarness();
    expect(result.exitCode).toBe(1);
    expect(result.launch).toHaveBeenCalledTimes(1);
    expect(result.output).toContain("Electron host died during synthetic-clean.png[onnx]");
    const dir = fs.readdirSync(result.scratch).find((name) => name !== "artifacts")!;
    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(result.scratch, dir, "roaming", "wfhelper", "inventory-reload-state.json"),
          "utf8",
        ),
      ),
    ).toEqual({ inventorySource: "none" });
    const failure = JSON.parse(
      fs.readFileSync(path.join(result.scratch, dir, "failure.json"), "utf8"),
    );
    expect(failure.hostExit).toEqual({ code: 134, signal: null });
    expect(failure.gatingRuns).toBe(1);
    const [artifact] = fs.readdirSync(path.join(result.scratch, "artifacts"));
    expect(fs.existsSync(path.join(result.scratch, "artifacts", artifact, "failure.json"))).toBe(
      true,
    );
  });

  it("fails Linux boot on an uncaught error in the already-open renderer", async () => {
    const result = await runLinuxSmoke({ pageError: "startup component failed" });
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("Uncaught renderer error");
    const dir = fs.readdirSync(result.scratch).find((name) => name !== "artifacts")!;
    expect(fs.readFileSync(path.join(result.scratch, dir, "boot-failure.log"), "utf8")).toContain(
      "startup component failed",
    );
    const [artifact] = fs.readdirSync(path.join(result.scratch, "artifacts"));
    expect(
      fs.readFileSync(path.join(result.scratch, "artifacts", artifact, "boot-failure.log"), "utf8"),
    ).toContain("startup component failed");
  });

  it("distinguishes missing Linux prerequisites from a clean boot", async () => {
    const result = await runLinuxSmoke({ launchError: "Missing X server or $DISPLAY" });
    expect(result.exitCode).toBe(2);
    expect(result.output).toContain("application boot unverified");
  });

  it("does not let a D-Bus warning excuse an application launch failure", async () => {
    const result = await runLinuxSmoke({
      launchError: "Failed to connect to the bus\nTarget closed: application startup failed",
    });
    expect(result.exitCode).toBe(1);
    expect(result.output).not.toContain("ENVIRONMENT");
  });

  it("accepts a rendered Linux boot and cleans up its passing sandbox", async () => {
    const result = await runLinuxSmoke({});
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("Linux boot smoke OK");
    expect(fs.readdirSync(result.scratch)).toEqual([]);
  });

  it("rejects a shutdown crash after successful Linux rendering", async () => {
    const result = await runLinuxSmoke({ closeCode: 134 });
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("Electron process exit: 134/null");
  });

  it("rejects native shutdown signals even when close resolves", async () => {
    await expect(
      closeNativeElectron({
        process: () => ({ exitCode: null, signalCode: "SIGABRT", kill: vi.fn() }),
        close: async () => {},
      }),
    ).rejects.toThrow("Electron process exit: null/SIGABRT");
  });
});
