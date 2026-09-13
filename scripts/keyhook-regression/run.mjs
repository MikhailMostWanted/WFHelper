import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const electronPath = require("electron");
const hostPath = path.join(import.meta.dirname, "host.cjs");
const workerPath = path.join(repoRoot, ".electron-build", "services", "keyHookWorker.js");
const decoySource = path.join(import.meta.dirname, "decoy.cs");

if (process.platform !== "win32") {
  process.stdout.write("[keyhook-regression] SKIP: Windows-only\n");
  process.exit(0);
}

if (process.argv.length !== 3 || process.argv[2] !== "--active-desktop") {
  process.stderr.write(
    "[keyhook-regression] Requires --active-desktop: opens a Warframe decoy and sends F8. " +
      "An inactive hidden desktop cannot provide foreground input.\n",
  );
  process.exit(2);
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "wfhelper-keyhook-"));
const decoyPath = path.join(tempDir, "Warframe.x64.exe");
const triggerPath = path.join(tempDir, "send.flag");
const cscPath = path.join(
  process.env.WINDIR || "C:\\Windows",
  "Microsoft.NET",
  "Framework64",
  "v4.0.30319",
  "csc.exe",
);

const compile = spawnSync(
  cscPath,
  [
    "/nologo",
    "/target:winexe",
    `/out:${decoyPath}`,
    "/reference:System.Windows.Forms.dll",
    decoySource,
  ],
  { encoding: "utf8" },
);
if (compile.status !== 0) {
  process.stderr.write(compile.stdout || "");
  process.stderr.write(compile.stderr || "");
  process.stderr.write("[keyhook-regression] FAIL: decoy compilation failed\n");
  process.exit(1);
}

const env = {
  ...process.env,
  WFHELPER_USER_DATA: path.join(tempDir, "user-data"),
  APPDATA: path.join(tempDir, "roaming"),
  LOCALAPPDATA: path.join(tempDir, "local"),
  WFHELPER_KEYHOOK_ACTIVE_DESKTOP: "1",
};
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electronPath, [hostPath, workerPath, decoyPath, triggerPath, "--no-sandbox"], {
  cwd: repoRoot,
  stdio: ["ignore", "pipe", "pipe"],
  env,
});

let stdout = "";
let stderr = "";
const timeout = setTimeout(() => {
  if (child.pid) {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
  }
  process.stderr.write("[keyhook-regression] FAIL: host timeout\n");
  process.exitCode = 1;
}, 30_000);

child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  stdout += chunk;
});
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});

child.on("exit", (code) => {
  clearTimeout(timeout);

  const summaryLine = stdout
    .split(/\r?\n/)
    .find((line) => line.startsWith("KEYHOOK_HOST ") && line.includes('"event":"summary"'));
  if (code !== 0 || !summaryLine) {
    process.stderr.write(stdout);
    process.stderr.write(stderr);
    process.stderr.write(`[keyhook-regression] FAIL: host exit ${code}\n`);
    preserveFailure();
    process.exitCode = 1;
    return;
  }

  const summary = JSON.parse(summaryLine.slice("KEYHOOK_HOST ".length));
  if (
    summary.failed ||
    !summary.ready ||
    summary.updates !== 20 ||
    summary.hotkeys !== 1 ||
    !summary.decoyResult?.focused ||
    summary.decoyResult?.delivered !== 0
  ) {
    process.stderr.write(`${summaryLine}\n`);
    process.stderr.write("[keyhook-regression] FAIL: incomplete lifecycle\n");
    preserveFailure();
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    "[keyhook-regression] PASS: F8 intercepted in Warframe decoy; 20 watch updates survived\n",
  );
  setTimeout(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }, 500);
});

function preserveFailure() {
  fs.writeFileSync(path.join(tempDir, "host.log"), `${stdout}\n${stderr}`);
  process.stderr.write(`[keyhook-regression] diagnostics retained: ${tempDir}\n`);
  if (stdout.includes('"focused":false')) {
    process.stderr.write(
      "[keyhook-regression] decoy could not receive focus; use an active desktop in a disposable VM\n",
    );
  }
}

child.on("error", (error) => {
  clearTimeout(timeout);
  stderr += String(error);
  preserveFailure();
  process.exitCode = 1;
});
