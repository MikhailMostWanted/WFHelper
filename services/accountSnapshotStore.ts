import fs from "node:fs/promises";
import path from "node:path";
import {
  buildAccountSnapshot,
  type AccountSnapshot,
  type SnapshotOptions,
} from "./accountSnapshot";

let pending: { file: string; payload: unknown; options: SnapshotOptions } | null = null;
let running: Promise<void> | null = null;
let last: AccountSnapshot | null = null;
let lastError: string | null = null;
const listeners = new Set<() => void>();
export function onAccountSnapshotSaved(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function getAccountSnapshotStatus(): {
  snapshot: AccountSnapshot | null;
  error: string | null;
} {
  return { snapshot: last, error: lastError };
}
export function saveAccountSnapshot(
  file: string,
  payload: unknown,
  options: SnapshotOptions,
): Promise<void> {
  pending = { file, payload, options };
  running ??= drain().finally(() => {
    running = null;
  });
  return running;
}
async function drain(): Promise<void> {
  while (pending) {
    const task = pending;
    pending = null;
    const temp = `${task.file}.${process.pid}.tmp`;
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      const snapshot = buildAccountSnapshot(task.payload, task.options);
      const body = JSON.stringify(snapshot);
      if (Buffer.byteLength(body) > 16 * 1024 * 1024) throw new Error("Snapshot exceeds 16 MiB");
      await fs.mkdir(path.dirname(task.file), { recursive: true });
      await fs.writeFile(temp, body, { encoding: "utf8", mode: 0o600 });
      await fs.rename(temp, task.file);
      last = snapshot;
      lastError = null;
      for (const listener of listeners) {
        try {
          listener();
        } catch {
          /* An optional consumer cannot break inventory saving. */
        }
      }
    } catch {
      lastError = "Snapshot export failed; previous snapshot preserved";
    } finally {
      await fs.rm(temp, { force: true }).catch(() => {});
    }
  }
}
