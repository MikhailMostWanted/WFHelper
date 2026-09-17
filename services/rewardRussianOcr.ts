import { getGameLocale } from "./gameLocale";
import * as itemDatabase from "./itemDatabase";
import type { StructuredOcrResult } from "./ocrServer";
import type { SortedItem } from "./rewardScannerMatch";
import { levenshteinDistance } from "./rewardScannerUtils";

const RUSSIAN_LOCALE = "ru";
const MIN_FUZZY_CONFIDENCE = 0.7;
const MIN_FUZZY_MARGIN = 0.045;
const MIN_PARTIAL_NAME_RATIO = 0.6;

type SystemOcrModule = {
  recognize: (
    input: Buffer | string,
    accuracy?: unknown,
    languages?: string[],
  ) => Promise<{ text?: string; confidence?: number }>;
};

let systemOcr: SystemOcrModule | null | undefined;

function getSystemOcr(): SystemOcrModule | null {
  if (systemOcr !== undefined) return systemOcr;
  try {
    systemOcr = require("@napi-rs/system-ocr") as SystemOcrModule;
  } catch {
    systemOcr = null;
  }
  return systemOcr;
}

export function shouldUseRussianRewardOcr(): boolean {
  return process.platform === "win32" && getGameLocale() === RUSSIAN_LOCALE;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Russian OCR timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function normalizeRussian(value: unknown): string {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  return Math.max(0, 1 - levenshteinDistance(a, b) / Math.max(a.length, b.length, 1));
}

interface LocalizedCandidate {
  canonical: string;
  localized: string;
  normalized: string;
}

export function localizeMatchedRewardDisplayNames(items: SortedItem[]): SortedItem[] {
  return items.map((item) => {
    const canonical = String(item?.name || "");
    const uniqueName = typeof item?.uniqueName === "string" ? item.uniqueName : null;
    if (!canonical || !uniqueName) return item;
    const displayName = itemDatabase.localizedNameFields(uniqueName, canonical).displayName;
    return displayName ? { ...item, displayName } : item;
  });
}

function localizedCandidates(items: SortedItem[]): LocalizedCandidate[] {
  const out: LocalizedCandidate[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const canonical = String(item?.name || "").trim();
    const uniqueName = typeof item?.uniqueName === "string" ? item.uniqueName : null;
    if (!canonical || !uniqueName) continue;
    const localized = itemDatabase.localizedNameFields(uniqueName, canonical).displayName;
    if (!localized || localized === canonical) continue;
    const normalized = normalizeRussian(localized);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push({ canonical, localized, normalized });
  }
  return out.sort((a, b) => b.normalized.length - a.normalized.length);
}

function isUsefulPartialRead(text: string, candidate: string): boolean {
  if (!text || !candidate) return false;
  const wordCount = text.split(" ").filter(Boolean).length;
  return wordCount >= 2 && text.length >= candidate.length * MIN_PARTIAL_NAME_RATIO;
}

/**
 * The existing reward matcher intentionally stays English/canonical because it
 * is also the join key for warframe.market. On a Russian client we OCR the
 * official DE Russian name, resolve that name here, then feed the canonical
 * English reward name into the unchanged matcher.
 */
export function canonicalizeRussianRewardText(text: string, items: SortedItem[]): string {
  const normalizedText = normalizeRussian(text);
  if (!normalizedText) return text;

  const candidates = localizedCandidates(items);
  for (const candidate of candidates) {
    if (
      normalizedText === candidate.normalized ||
      normalizedText.includes(candidate.normalized) ||
      (candidate.normalized.includes(normalizedText) &&
        isUsefulPartialRead(normalizedText, candidate.normalized))
    ) {
      return candidate.canonical;
    }
  }

  let best: { candidate: LocalizedCandidate; score: number } | null = null;
  let secondScore = 0;

  for (const candidate of candidates) {
    const score = similarity(normalizedText, candidate.normalized);
    if (!best || score > best.score) {
      secondScore = best?.score ?? secondScore;
      best = { candidate, score };
    } else if (score > secondScore) {
      secondScore = score;
    }
  }

  if (best && best.score >= MIN_FUZZY_CONFIDENCE && best.score - secondScore >= MIN_FUZZY_MARGIN) {
    return best.candidate.canonical;
  }

  return text;
}

export async function runRussianRewardOcrStructuredBuffer(
  imageBuffer: Buffer,
  timeoutMs: number,
  items: SortedItem[],
): Promise<StructuredOcrResult> {
  const ocr = getSystemOcr();
  if (!ocr) throw new Error("@napi-rs/system-ocr is unavailable");

  const result = await withTimeout(
    ocr.recognize(imageBuffer, undefined, [RUSSIAN_LOCALE]),
    timeoutMs,
  );
  const rawText = String(result?.text || "").trim();
  const text = canonicalizeRussianRewardText(rawText, items);
  const words = text.split(/\s+/).filter(Boolean);

  return {
    text,
    lines: text
      ? [
          {
            text,
            box: { left: 0, top: 0, width: 0, height: 0 },
            words: words.map((word) => ({
              text: word,
              box: { left: 0, top: 0, width: 0, height: 0 },
            })),
          },
        ]
      : [],
  };
}
