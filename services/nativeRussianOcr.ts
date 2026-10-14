import { getGameLocale } from "./gameLocale";
import { normalizeErrorMessage } from "../config/shared/errors";
import { OcrWorkQueue } from "./ocrWorkQueue";
import { nativeOcrProcessAvailable, recognizeNativeOcr } from "./nativeOcrProcess";

const russianWork = new OcrWorkQueue();
const RUSSIAN_LOCALE = "ru";
let lastRussianOcrError: string | null = null;
export function shouldUseRussianRewardOcr(): boolean {
  return process.platform === "win32" && getGameLocale() === RUSSIAN_LOCALE;
}
export function getRussianRewardOcrHealth(): { available: boolean; reason: string | null } {
  if (process.platform !== "win32")
    return { available: false, reason: "Russian reward OCR is Windows-only" };
  if (!nativeOcrProcessAvailable())
    return { available: false, reason: "@napi-rs/system-ocr is unavailable" };
  return lastRussianOcrError
    ? { available: false, reason: lastRussianOcrError }
    : { available: true, reason: null };
}
/** Raw text for rewards and Russian Riven cards; no item guessing. */
export async function runRussianTextOcr(imageBuffer: Buffer, timeoutMs: number): Promise<string> {
  if (!nativeOcrProcessAvailable()) throw new Error("@napi-rs/system-ocr is unavailable");
  try {
    const result = await russianWork.run(
      () => recognizeNativeOcr(imageBuffer, [RUSSIAN_LOCALE]),
      timeoutMs,
    );
    lastRussianOcrError = null;
    return String(result?.text || "").trim();
  } catch (error) {
    lastRussianOcrError = normalizeErrorMessage(error);
    throw error;
  }
}
