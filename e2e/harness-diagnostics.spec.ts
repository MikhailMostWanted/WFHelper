import fs from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

import {
  closeElectronTestHarness,
  launchElectronTestHarness,
  restartElectronTestHarness,
  type ElectronTestHarness,
} from "./electronTestHarness";

test("a failed launch retains its trace and process diagnostics", async () => {
  await expect(
    launchElectronTestHarness("wfh-failed-launch-", {
      onPage: async (page) => {
        await page.evaluate(() => console.error("fixture startup diagnostic"));
        throw new Error("intentional fixture startup failure");
      },
    }),
  ).rejects.toThrow("intentional fixture startup failure");
  const attachments = test.info().attachments;
  const processLog = attachments.find((entry) => entry.name === "electron-process");
  expect(processLog?.path).toBeTruthy();
  expect(fs.readFileSync(processLog!.path!, "utf8")).toContain("fixture startup diagnostic");
  expect(
    attachments.some((entry) => entry.name === "electron-trace" && fs.existsSync(entry.path!)),
  ).toBe(true);
});

test("a cold restart preserves the sandbox without reseeding state", async () => {
  let harness: ElectronTestHarness | undefined;
  try {
    harness = await launchElectronTestHarness("wfh-cold-restart-");
    const directory = harness.sandboxDir;
    const pid = harness.app.process().pid;
    await harness.page.evaluate(() => localStorage.setItem("harness-restart-marker", "saved"));
    fs.writeFileSync(path.join(directory, "user-data", "restart-marker.json"), "42");
    harness = await restartElectronTestHarness(harness);
    expect(harness.app.process().pid).not.toBe(pid);
    expect(harness.sandboxDir).toBe(directory);
    expect(await harness.page.evaluate(() => localStorage.getItem("harness-restart-marker"))).toBe(
      "saved",
    );
    expect(fs.readFileSync(path.join(directory, "user-data", "restart-marker.json"), "utf8")).toBe(
      "42",
    );
  } finally {
    await closeElectronTestHarness(harness);
  }
});

test("a nonzero Electron exit fails teardown and retains its process status", async () => {
  const harness = await launchElectronTestHarness("wfh-nonzero-exit-");
  const child = harness.app.process();
  await harness.app.evaluate(({ app }) => {
    setTimeout(() => app.exit(23), 100);
  });
  await expect.poll(() => child.exitCode).toBe(23);
  await expect(closeElectronTestHarness(harness)).rejects.toThrow(
    "Electron process exited with 23/null",
  );
  const finalLog = test
    .info()
    .attachments.filter((entry) => entry.name === "electron-process-final")
    .at(-1);
  expect(fs.readFileSync(finalLog!.path!, "utf8")).toContain("[exit] code=23");
});
