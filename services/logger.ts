import electronLog from "electron-log/main";
import fs from "node:fs";
import path from "node:path";
import { redactLogPaths, redactStoredLog } from "./logPrivacy";

export interface ScopedLogger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  time: (label?: string) => void;
  timeEnd: (label?: string) => void;
}

const level: string = process.env.LOG_LEVEL || "info";
// Opt-in only: "1" or "true"; any other value (incl. "false") is off.
const resetLogOnStart: boolean = ["1", "true"].includes(
  String(process.env.LOG_RESET_ON_START ?? "").toLowerCase(),
);
const isTest = process.env.VITEST === "true" || process.env.NODE_ENV === "test";
const loggerState = globalThis as typeof globalThis & {
  __wfhelperLoggerInitialized?: boolean;
  __wfhelperStreamGuardsInstalled?: boolean;
  __wfhelperLogPrivacyInstalled?: boolean;
};

function resetLogFileOnAppStart(): void {
  if (!resetLogOnStart) return;

  try {
    const file = electronLog.transports.file.getFile();
    if (file?.clear()) return;

    const filePath = file?.path;
    if (!filePath) return;

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "", "utf8");
  } catch {
    // Intentional: never break app startup because optional log reset failed.
  }
}

// A dead stdout (desktop launcher, or the parent of the xwayland re-exec going
// away) makes every console write throw EIO, and logging that error loops.
// Guarded on the global: test runners re-evaluate this module per file against
// one shared process, and the listeners would pile up past the warning limit.
if (!loggerState.__wfhelperStreamGuardsInstalled) {
  loggerState.__wfhelperStreamGuardsInstalled = true;
  process.stdout.on("error", () => {});
  process.stderr.on("error", () => {});
}

electronLog.transports.file.level = isTest
  ? false
  : (level as typeof electronLog.transports.file.level);
electronLog.transports.console.level = level as typeof electronLog.transports.console.level;
electronLog.transports.file.maxSize = 5 * 1024 * 1024;
if (!loggerState.__wfhelperLogPrivacyInstalled) {
  // Last transform sees strings, so Error stacks and nested object paths are covered.
  electronLog.transports.file.transforms.push(({ data }) => redactLogPaths(String(data)));
  loggerState.__wfhelperLogPrivacyInstalled = true;
}
if (!isTest && !loggerState.__wfhelperLoggerInitialized) {
  electronLog.initialize();
  loggerState.__wfhelperLoggerInitialized = true;
  resetLogFileOnAppStart();
  try {
    const logPath = electronLog.transports.file.getFile()?.path;
    if (logPath) {
      const parsed = path.parse(logPath);
      for (const file of [logPath, path.join(parsed.dir, `${parsed.name}.old${parsed.ext}`)]) {
        try {
          redactStoredLog(file);
        } catch {
          // A locked log must not prevent redacting the other file.
        }
      }
    }
  } catch {
    // A locked old log must not prevent startup or redaction of new entries.
  }
}

const timers = new Map<string, number>();

export function getLogFilePath(): string | null {
  try {
    return electronLog.transports.file.getFile()?.path || null;
  } catch {
    return null;
  }
}

export function getLogDirectory(): string | null {
  try {
    const filePath = electronLog.transports.file.getFile()?.path;
    return filePath ? path.dirname(filePath) : null;
  } catch {
    return null;
  }
}

export function withScope(scopeName: string): ScopedLogger {
  const scoped = electronLog.scope(scopeName);

  return {
    info: (...args: unknown[]) => scoped.info(...args),
    warn: (...args: unknown[]) => scoped.warn(...args),
    error: (...args: unknown[]) => scoped.error(...args),
    debug: (...args: unknown[]) => scoped.debug(...args),
    time: (label: string = "timer") => {
      timers.set(`${scopeName}:${label}`, Date.now());
    },
    timeEnd: (label: string = "timer") => {
      const key = `${scopeName}:${label}`;
      const start = timers.get(key);
      if (!start) {
        scoped.warn(`timeEnd called without matching time: ${label}`);
        return;
      }
      timers.delete(key);
      const durationMs = Date.now() - start;
      scoped.info(`${label} (${durationMs}ms)`);
    },
  };
}
