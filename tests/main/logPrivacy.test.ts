import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { redactLogPaths, redactStoredLog } from "../../services/logPrivacy";

describe("log profile path privacy", () => {
  it("scrubs historical lines without truncating the log", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "wfh-log-privacy-"));
    try {
      const file = path.join(directory, "main.log");
      fs.writeFileSync(file, "Old C:/Users/Alice/Documents/inventory.json\nDiagnosis preserved\n");
      redactStoredLog(file);
      expect(fs.readFileSync(file, "utf8")).toBe(
        "Old C:/Users/[redacted]/Documents/inventory.json\nDiagnosis preserved\n",
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each([
    ["C:/Users/Alice: EPERM", "C:/Users/[redacted]: EPERM"],
    ["C:/Users/O'Brien/Documents/main.log", "C:/Users/[redacted]/Documents/main.log"],
    ["/home/O'Brien/.config/log", "/home/[redacted]/.config/log"],
    [
      String.raw`C:\Users\Alice Smith\AppData\main.log`,
      String.raw`C:\Users\[redacted]\AppData\main.log`,
    ],
    [
      String.raw`{ path: 'D:\\Users\\Jörg\\inventory.json' }`,
      String.raw`{ path: 'D:\\Users\\[redacted]\\inventory.json' }`,
    ],
    ["file:///C:/Users/Alice%20Smith/Desktop/a.json", "file:///C:/Users/[redacted]/Desktop/a.json"],
    ["/home/alice/.config/wfhelper/main.log", "/home/[redacted]/.config/wfhelper/main.log"],
    ["/Users/Alice/Library/main.log", "/Users/[redacted]/Library/main.log"],
    ["C%3A%5CUsers%5CAlice%20Smith%5CDocuments", "C%3A%5CUsers%5C[redacted]%5CDocuments"],
  ])("redacts %s without losing the diagnostic suffix", (input, expected) => {
    expect(redactLogPaths(input)).toBe(expected);
    expect(redactLogPaths(expected)).toBe(expected);
  });

  it("preserves unrelated words, API URLs and stack coordinates", () => {
    const text = "Users failed: https://warframe.market/profile/Alice at scanner.ts:32:4";
    expect(redactLogPaths(text)).toBe(text);
  });
});
