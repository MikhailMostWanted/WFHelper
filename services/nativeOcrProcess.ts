/** Keep native OCR teardown outside Electron's main environment. */
import path from "node:path";
import type { UtilityProcess } from "electron";
import { isQuitting } from "./appLifecycle";
import { normalizeErrorMessage } from "../config/shared/errors";

export interface NativeOcrResult {
  text: string;
  confidence: number;
}

interface OcrRequest {
  type: "recognize";
  id: number;
  input: Buffer | string;
  languages?: string[];
}
interface PendingOcr {
  request: OcrRequest;
  resolve: (result: NativeOcrResult) => void;
  reject: (error: Error) => void;
}
interface OcrReply {
  type?: string;
  id?: number;
  text?: string;
  confidence?: number;
  error?: string;
}

let child: UtilityProcess | null = null;
let ready = false;
let stopped = false;
let failure: string | null = null;
let sequence = 0;
const pending = new Map<number, PendingOcr>();

/** Resolve paths only: requiring the binding here would recreate the main crash. */
export function nativeOcrProcessAvailable(): boolean {
  if (stopped || failure) return false;
  const platformPackage =
    process.platform === "win32"
      ? `@napi-rs/system-ocr-win32-${process.arch}-msvc`
      : process.platform === "darwin"
        ? `@napi-rs/system-ocr-darwin-${process.arch}`
        : null;
  if (!platformPackage) return false;
  try {
    require.resolve("@napi-rs/system-ocr");
    require.resolve(platformPackage);
    return true;
  } catch {
    return false;
  }
}

function rejectPending(error: Error): void {
  for (const request of pending.values()) request.reject(error);
  pending.clear();
}

function failChild(created: UtilityProcess, reason: string): void {
  if (child !== created) return;
  failure = reason;
  child = null;
  ready = false;
  rejectPending(new Error(reason));
  created.kill();
}

function ensureChild(): UtilityProcess {
  if (stopped || isQuitting()) throw new Error("Native OCR is shutting down");
  if (failure) throw new Error(failure);
  if (child) return child;
  if (!nativeOcrProcessAvailable()) throw new Error("Native OCR not available");

  const { utilityProcess } = require("electron") as typeof import("electron");
  const created = utilityProcess.fork(path.join(__dirname, "nativeOcrChild.js"), [], {
    serviceName: "WantedFrame Native OCR",
    stdio: "ignore",
  });
  child = created;
  ready = false;
  created.on("spawn", () => {
    if (stopped || isQuitting() || child !== created) created.kill();
  });
  created.on("message", (value: unknown) => {
    if (child !== created || !value || typeof value !== "object") return;
    const reply = value as OcrReply;
    if (reply.type === "ready") {
      ready = true;
      try {
        for (const request of pending.values()) created.postMessage(request.request);
      } catch (error) {
        failChild(created, normalizeErrorMessage(error, "Native OCR process unavailable"));
      }
      return;
    }
    if (reply.type === "unavailable") {
      failChild(created, reply.error || "Native OCR binding unavailable");
      return;
    }
    if (reply.type !== "result" || typeof reply.id !== "number") return;
    const request = pending.get(reply.id);
    if (!request) return;
    pending.delete(reply.id);
    if (reply.error) request.reject(new Error(reply.error));
    else request.resolve({ text: reply.text || "", confidence: reply.confidence ?? 1 });
  });
  created.on("error", () => {
    failChild(created, "Native OCR process failed");
  });
  created.on("exit", (code) => {
    if (child !== created) return;
    failure = `Native OCR process exited (${code})`;
    child = null;
    ready = false;
    rejectPending(new Error(failure));
  });
  return created;
}

export function recognizeNativeOcr(
  input: Buffer | string,
  languages?: string[],
): Promise<NativeOcrResult> {
  return new Promise((resolve, reject) => {
    let created: UtilityProcess;
    try {
      created = ensureChild();
    } catch (error) {
      reject(error);
      return;
    }
    const id = ++sequence;
    const request: OcrRequest = { type: "recognize", id, input, languages };
    pending.set(id, { request, resolve, reject });
    if (!ready) return;
    try {
      created.postMessage(request);
    } catch (error) {
      failChild(created, normalizeErrorMessage(error, "Native OCR process unavailable"));
    }
  });
}

/** One-way shutdown rejects outstanding work and never starts another child. */
export function stopNativeOcrProcess(): void {
  stopped = true;
  const running = child;
  child = null;
  ready = false;
  rejectPending(new Error("Native OCR is shutting down"));
  running?.kill();
}
