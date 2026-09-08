import fs from "node:fs";
import { writeFileAtomicSync } from "./atomicFile";

/** Redact profile-directory names after formatting, including escaped object paths. */
export function redactLogPaths(text: string): string {
  return text
    .replace(/([a-z]:[\\/]+Users[\\/]+)[^\\/:\r\n]+/gi, "$1[redacted]")
    .replace(/(\/(?:home|Users)\/)[^/:\r\n]+/g, "$1[redacted]")
    .replace(
      /([a-z](?::|%3a)(?:%5c|%2f)+Users(?:%5c|%2f)+)(?:(?!%5c|%2f)[^\s])+/gi,
      "$1[redacted]",
    );
}

export function redactStoredLog(filePath: string): void {
  if (!fs.existsSync(filePath) || fs.statSync(filePath).size > 10 * 1024 * 1024) return;
  const previous = fs.readFileSync(filePath, "utf8");
  const next = redactLogPaths(previous);
  if (next !== previous) writeFileAtomicSync(filePath, next);
}
