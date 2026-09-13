const { execFileSync } = require("node:child_process");

async function closeNativeElectron(app) {
  const child = app.process();
  let timer;
  try {
    await Promise.race([
      app.close(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Electron close timed out")), 15_000);
      }),
    ]);
    if (child.exitCode !== 0 || child.signalCode) {
      throw new Error(`Electron process exit: ${child.exitCode}/${child.signalCode}`);
    }
  } catch (error) {
    if (child.exitCode === null) {
      try {
        if (process.platform === "win32" && child.pid)
          execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
        else child.kill("SIGKILL");
      } catch {
        // The process may exit between inspection and termination.
      }
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { closeNativeElectron };
