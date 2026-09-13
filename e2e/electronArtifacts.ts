import fs from "node:fs";
import path from "node:path";

import { test, type ElectronApplication, type Page } from "@playwright/test";

export async function collectElectronArtifacts(
  app: ElectronApplication | null,
  sandboxDir: string,
) {
  let artifactDirectory: string | undefined;
  let traced = false;
  let attached = false;
  const messages: string[] = [];
  const watched = new Set<Page>();
  let characters = 0;
  const record = (message: string) => {
    messages.push(message);
    characters += message.length;
    while (characters > 256 * 1024 && messages.length > 1) {
      characters -= messages.shift()!.length;
    }
  };
  const watch = (page: Page) => {
    if (watched.has(page)) return;
    watched.add(page);
    page.on("console", (message) => record(`[${page.url()}] ${message.type()}: ${message.text()}`));
    page.on("pageerror", (error) => record(`[${page.url()}] ${error.stack ?? error.message}`));
    page.on("crash", () => record(`[${page.url()}] renderer crashed`));
  };
  if (app) {
    app.on("window", watch);
    app.windows().forEach(watch);
    app.process().stdout?.on("data", (chunk: Buffer) => record(`[stdout] ${String(chunk)}`));
    app.process().stderr?.on("data", (chunk: Buffer) => record(`[stderr] ${String(chunk)}`));
    app.process().on("exit", (code, signal) => record(`[exit] code=${code} signal=${signal}`));
    try {
      await app.context().tracing.start({ screenshots: true, snapshots: true, sources: true });
      traced = true;
    } catch (error) {
      record(`[trace start unavailable] ${String(error)}`);
    }
  }

  return async (failed = false, failure?: unknown) => {
    const info = test.info();
    const directory = (artifactDirectory ??= info.outputPath(
      `electron-${path.basename(sandboxDir)}-${Date.now()}`,
    ));
    if (failure) record(`[harness failure] ${String(failure)}`);
    fs.mkdirSync(directory, { recursive: true });
    const keepTrace =
      failed || info.status !== info.expectedStatus || process.env.WFHELPER_KEEP_TRACE === "1";
    if (traced && app) {
      try {
        await app
          .context()
          .tracing.stop(keepTrace ? { path: path.join(directory, "trace.zip") } : {});
      } catch (error) {
        record(`[trace unavailable] ${String(error)}`);
      }
      traced = false;
    }
    if (keepTrace && !attached && app) {
      for (const [index, page] of app.windows().entries()) {
        try {
          await page.screenshot({
            path: path.join(directory, `window-${index}.png`),
            timeout: 3_000,
          });
        } catch (error) {
          record(`[screenshot unavailable] ${String(error)}`);
        }
      }
    }
    fs.writeFileSync(path.join(directory, "process.log"), messages.join("\n"));
    for (const relative of ["logs", "Crashpad/reports", "Crashes/reports"]) {
      const source = path.join(sandboxDir, "user-data", relative);
      if (!fs.existsSync(source)) continue;
      try {
        fs.cpSync(source, path.join(directory, relative), { recursive: true });
      } catch (error) {
        fs.appendFileSync(
          path.join(directory, "process.log"),
          `\n[copy ${relative}] ${String(error)}`,
        );
      }
    }
    if (attached) {
      await info.attach("electron-process-final", {
        path: path.join(directory, "process.log"),
        contentType: "text/plain",
      });
      return;
    }
    attached = true;
    await info.attach("electron-process", {
      path: path.join(directory, "process.log"),
      contentType: "text/plain",
    });
    if (fs.existsSync(path.join(directory, "trace.zip"))) {
      await info.attach("electron-trace", {
        path: path.join(directory, "trace.zip"),
        contentType: "application/zip",
      });
    }
  };
}
