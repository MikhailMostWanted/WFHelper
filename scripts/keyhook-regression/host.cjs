const { spawn } = require("node:child_process");
const fs = require("node:fs");

const { app, utilityProcess } = require("electron");

const workerPath = process.argv[2];
const decoyPath = process.argv[3];
const triggerPath = process.argv[4];
const updateLimit = 20;
let ready = false;
let updates = 0;
let hotkeys = 0;
let decoyReady = false;
let decoyResult = null;
let triggerSent = false;
let failed = false;
let childExited = false;
let decoyExited = false;

function out(event) {
  process.stdout.write(`KEYHOOK_HOST ${JSON.stringify(event)}\n`);
}

function watched() {
  return [{ id: "F8", ctrl: false, alt: false, shift: false, win: false, vk: 0x77 }];
}

app.disableHardwareAcceleration();
if (!process.env.WFHELPER_USER_DATA) throw new Error("Keyhook harness requires isolated userData");
if (process.env.WFHELPER_KEYHOOK_ACTIVE_DESKTOP !== "1") {
  throw new Error("Keyhook harness requires explicit active-desktop mode");
}
app.setPath("userData", process.env.WFHELPER_USER_DATA);

app.whenReady().then(() => {
  const decoy = spawn(decoyPath, [triggerPath], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: false,
  });
  const child = utilityProcess.fork(workerPath, [], {
    serviceName: "WFHelper Key Hook Regression",
    stdio: "pipe",
  });
  child.stdout?.pipe(process.stdout);
  child.stderr?.pipe(process.stderr);

  let decoyOutput = "";
  decoy.stdout.setEncoding("utf8");
  decoy.stdout.on("data", (chunk) => {
    decoyOutput += chunk;
    let newline;
    while ((newline = decoyOutput.indexOf("\n")) >= 0) {
      const line = decoyOutput.slice(0, newline).trimEnd();
      decoyOutput = decoyOutput.slice(newline + 1);
      if (line === "DECOY_READY") {
        decoyReady = true;
        maybeTrigger();
      } else if (line.startsWith("DECOY_SUMMARY ")) {
        decoyResult = JSON.parse(line.slice("DECOY_SUMMARY ".length));
        if (!decoyResult.focused) {
          failed = true;
          out({ event: "focus-unavailable", decoyResult });
          child.kill();
        }
      }
    }
  });
  decoy.stderr.pipe(process.stderr);

  const timeout = setTimeout(() => {
    failed = true;
    out({ event: "timeout", ready, updates, hotkeys, decoyReady, decoyResult });
    child.kill();
    decoy.kill();
  }, 10_000);

  function maybeTrigger() {
    if (triggerSent || !ready || updates !== 1 || !decoyReady) return;
    triggerSent = true;
    fs.writeFileSync(triggerPath, "send-f8");
  }

  function pushNextWatch() {
    child.postMessage({ type: "setWatch", watch: updates % 2 === 0 ? watched() : [] });
  }

  function finishIfDone() {
    if (!childExited || !decoyExited) return;
    clearTimeout(timeout);
    const passed =
      !failed &&
      ready &&
      updates === updateLimit &&
      hotkeys === 1 &&
      decoyResult?.focused === true &&
      decoyResult?.delivered === 0;
    out({
      event: "summary",
      ready,
      updates,
      hotkeys,
      decoyReady,
      decoyResult,
      failed,
    });
    app.exit(passed ? 0 : 1);
  }

  child.on("message", (message) => {
    if (message?.type === "ready") {
      ready = true;
      child.postMessage({ type: "setWatch", watch: watched() });
    } else if (message?.type === "watch-updated") {
      updates += 1;
      if (updates === 1) {
        maybeTrigger();
      } else if (updates < updateLimit) {
        pushNextWatch();
      } else {
        child.kill();
      }
    } else if (message?.type === "hotkey" && message.id === "F8") {
      hotkeys += 1;
      if (updates === 1) pushNextWatch();
    } else if (message?.type === "error") {
      failed = true;
      out({ event: "worker-error", message: message.message });
      child.kill();
    }
  });

  child.on("error", (type, location) => {
    failed = true;
    out({ event: "child-error", type, location });
  });

  child.on("exit", (code) => {
    childExited = true;
    if (code !== 0) failed = true;
    finishIfDone();
  });

  decoy.on("exit", (code) => {
    decoyExited = true;
    if (code !== 0) failed = true;
    finishIfDone();
  });
});
