/** Keep Windows OCR and ONNX in separate N-API environments. */
import path from "node:path";
import type { UtilityProcess } from "electron";
import { withScope } from "./logger";

const log = withScope("nativeWindowsOcr");
type Result = { text: string; confidence: number };
let worker: UtilityProcess | null = null;
let sequence = 0;
let stopping = false;
let stopPromise: Promise<void> | null = null;
let exitPromise: Promise<number> | null = null;
let initializationError: Error | null = null;
let runtimeError: Error | null = null;
let drained = false;
const pending = new Map<
  number,
  {
    resolve: (result: Result) => void;
    reject: (error: Error) => void;
    done: Promise<unknown>;
  }
>();

export function windowsOcrAvailable(): boolean {
  if (initializationError || runtimeError) return false;
  try {
    require.resolve("@napi-rs/system-ocr");
    return true;
  } catch {
    return false;
  }
}

function ensureWorker(): UtilityProcess {
  if (initializationError) throw initializationError;
  if (runtimeError) throw runtimeError;
  if (worker) return worker;
  const { utilityProcess } = require("electron") as typeof import("electron");
  const process = utilityProcess.fork(path.join(__dirname, "nativeWindowsOcrWorker.js"), [], {
    serviceName: "WantedFrame Windows OCR",
    stdio: "pipe",
  });
  worker = process;
  process.stdout?.resume();
  process.stderr?.on("data", (chunk: Buffer) => log.warn(String(chunk).slice(0, 500)));
  process.on("error", (type, location) => {
    runtimeError = new Error(`Windows OCR ${type}: ${location}`);
    log.warn(runtimeError.message);
  });
  exitPromise = new Promise((resolve) =>
    process.once("exit", (code) => {
      if (code !== 0) runtimeError = new Error(`Windows OCR exited with ${code}`);
      else if (!drained)
        runtimeError = new Error("Windows OCR exited before acknowledging shutdown");
      if (worker === process) worker = null;
      for (const job of pending.values()) job.reject(new Error(`Windows OCR exited with ${code}`));
      pending.clear();
      log.info(`Windows OCR process exited with ${code}`);
      resolve(code);
    }),
  );
  process.on("message", (message: unknown) => {
    if (!message || typeof message !== "object") return;
    const reply = message as {
      type?: string;
      id?: number;
      text?: string;
      confidence?: number;
      error?: string;
    };
    if (reply.type === "drained" && stopping && pending.size === 0) {
      drained = true;
      // This read-only helper has acknowledged every result. Terminate its
      // idle process without re-entering the addon’s unsafe N-API finalizers.
      process.kill();
      return;
    }
    if (reply.type === "fatal") {
      initializationError = new Error(reply.error ?? "Windows OCR initialization failed");
      for (const job of pending.values()) job.reject(initializationError);
      pending.clear();
      return;
    }
    if (typeof reply.id !== "number") return;
    const job = pending.get(reply.id);
    if (!job) return;
    pending.delete(reply.id);
    if (reply.error) job.reject(new Error(reply.error));
    else if (typeof reply.text === "string")
      job.resolve({ text: reply.text, confidence: reply.confidence ?? 0 });
    else job.reject(new Error("Windows OCR returned an invalid result"));
  });
  return process;
}

export function recognizeWindowsOcr(
  input: Buffer | string,
  _accuracy?: unknown,
  languages?: string[],
): Promise<Result> {
  if (stopping) return Promise.reject(new Error("Windows OCR is shutting down"));
  let process: UtilityProcess;
  try {
    process = ensureWorker();
  } catch (error) {
    return Promise.reject(error);
  }
  const id = ++sequence;
  let resolve!: (result: Result) => void;
  let reject!: (error: Error) => void;
  const done = new Promise<Result>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  pending.set(id, { resolve, reject, done });
  try {
    process.postMessage({ type: "recognize", id, input, languages });
  } catch (error) {
    pending.delete(id);
    reject(error instanceof Error ? error : new Error(String(error)));
  }
  return done;
}

/** Wait for actual native work and require the isolated process to exit cleanly. */
export function stopWindowsOcr(): Promise<void> {
  if (stopPromise) return stopPromise;
  stopping = true;
  stopPromise = (async () => {
    const process = worker;
    if (!process) {
      if (runtimeError) throw runtimeError;
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        (async () => {
          await Promise.allSettled([...pending.values()].map((job) => job.done));
          process.postMessage({ type: "shutdown" });
          const code = await exitPromise;
          if (code !== 0) throw new Error(`Windows OCR shutdown exit: ${code}`);
          if (runtimeError) throw runtimeError;
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Windows OCR shutdown timed out")), 10_000);
        }),
      ]);
    } catch (error) {
      process.kill();
      throw error;
    } finally {
      clearTimeout(timer);
    }
  })();
  return stopPromise;
}
