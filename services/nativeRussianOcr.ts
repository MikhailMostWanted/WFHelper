import { getGameLocale } from "./gameLocale";
import { normalizeErrorMessage } from "../config/shared/errors";
import { OcrWorkQueue } from "./ocrWorkQueue";

const russianWork = new OcrWorkQueue();
const RUSSIAN_LOCALE = "ru";
type SystemOcrModule = {
  recognize: (input: Buffer | string, accuracy?: unknown, languages?: string[]) => Promise<{ text?: string; confidence?: number }>;
};
let systemOcr: SystemOcrModule | null | undefined;
let lastRussianOcrError: string | null = null;
function getSystemOcr(): SystemOcrModule | null {
  if (systemOcr !== undefined) return systemOcr;
  try { systemOcr = require("@napi-rs/system-ocr") as SystemOcrModule; }
  catch { systemOcr = null; }
  return systemOcr;
}
export function shouldUseRussianRewardOcr(): boolean {
  return process.platform === "win32" && getGameLocale() === RUSSIAN_LOCALE;
}
export function getRussianRewardOcrHealth(): { available: boolean; reason: string | null } {
  if (process.platform !== "win32") return { available: false, reason: "Russian reward OCR is Windows-only" };
  if (!getSystemOcr()) return { available: false, reason: "@napi-rs/system-ocr is unavailable" };
  return lastRussianOcrError ? { available: false, reason: lastRussianOcrError } : { available: true, reason: null };
}
/** Raw text for rewards and Russian Riven cards; no item guessing. */
export async function runRussianTextOcr(imageBuffer: Buffer, timeoutMs: number): Promise<string> {
  const ocr = getSystemOcr();
  if (!ocr) throw new Error("@napi-rs/system-ocr is unavailable");
  try {
    const result = await russianWork.run(() => ocr.recognize(imageBuffer, undefined, [RUSSIAN_LOCALE]), timeoutMs);
    lastRussianOcrError = null;
    return String(result?.text || "").trim();
  } catch (error) { lastRussianOcrError = normalizeErrorMessage(error); throw error; }
}
