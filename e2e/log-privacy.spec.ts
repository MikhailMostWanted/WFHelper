import fs from "node:fs/promises";
import { expect, test } from "@playwright/test";

import {
  closeElectronTestHarness,
  evaluateInMain,
  launchElectronTestHarness,
  type ElectronTestHarness,
} from "./electronTestHarness";

test("main.log redacts profile paths in formatted objects and errors", async () => {
  test.setTimeout(120_000);
  let harness: ElectronTestHarness | undefined;
  try {
    harness = await launchElectronTestHarness("wfh-log-privacy-");
    const logPath = await evaluateInMain(harness.app, ({ app }) => {
      const load = process
        .getBuiltinModule("module")
        .createRequire(`${app.getAppPath()}/.electron-build/main.js`);
      const logger = load("./services/logger.js") as {
        withScope(scope: string): { info(...args: unknown[]): void; error(error: Error): void };
        getLogFilePath(): string;
      };
      const log = logger.withScope("privacy-fixture");
      log.info({ nested: { file: "C:\\Users\\Private Profile\\Documents\\EE.log" } });
      const error = new Error("privacy-stack-fixture");
      error.stack = "Error: privacy-stack-fixture\n at C:\\Users\\O'Brien\\app\\file.js:4:2";
      log.error(error);
      return logger.getLogFilePath();
    });
    await expect
      .poll(async () => (await fs.readFile(logPath, "utf8")).includes("privacy-stack-fixture"))
      .toBe(true);
    const contents = await fs.readFile(logPath, "utf8");
    expect(contents).not.toContain("Private Profile");
    expect(contents).not.toContain("O'Brien");
    expect(contents).toContain("[redacted]");
    expect(contents).toContain("Documents");
    expect(contents).toContain("file.js:4:2");
  } finally {
    if (harness) await closeElectronTestHarness(harness);
  }
});
