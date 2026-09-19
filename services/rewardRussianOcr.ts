import { getGameLocale } from "./gameLocale";
import { normalizeErrorMessage } from "../config/shared/errors";
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
let lastRussianOcrError: string | null = null;

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

export function getRussianRewardOcrHealth(): { available: boolean; reason: string | null } {
  if (process.platform !== "win32") {
    return { available: false, reason: "Russian reward OCR is Windows-only" };
  }
  if (!getSystemOcr()) {
    return { available: false, reason: "@napi-rs/system-ocr is unavailable" };
  }
  return lastRussianOcrError
    ? { available: false, reason: lastRussianOcrError }
    : { available: true, reason: null };
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

const LATIN_TO_CYRILLIC: Readonly<Record<string, string>> = Object.freeze({
  a: "а",
  b: "в",
  c: "с",
  e: "е",
  h: "н",
  k: "к",
  m: "м",
  o: "о",
  p: "р",
  t: "т",
  x: "х",
  y: "у",
});

function normalizeMixedRussianToken(token: string): string {
  if (!/[а-яё]/i.test(token)) return token;
  return token.replace(/[abcehkmoptyx]/g, (char) => LATIN_TO_CYRILLIC[char] || char);
}

function normalizeRussian(value: unknown): string {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/\S+/g, normalizeMixedRussianToken)
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

interface LocalizedCandidateIndex {
  candidates: LocalizedCandidate[];
  exactByNormalized: Map<string, LocalizedCandidate>;
}

const localizedCandidateIndexCache = new WeakMap<SortedItem[], LocalizedCandidateIndex>();

type RussianRewardMatchMode = "exact" | "substring" | "partial" | "fuzzy" | "none";

interface RussianRewardResolution {
  text: string;
  matchMode: RussianRewardMatchMode;
  matchConfidence: number;
}

interface RussianRewardOcrResult extends StructuredOcrResult {
  rawText: string;
  matchMode: RussianRewardMatchMode;
  matchConfidence: number;
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

function localizedCandidateIndex(items: SortedItem[]): LocalizedCandidateIndex {
  const cached = localizedCandidateIndexCache.get(items);
  if (cached) return cached;

  const candidates: LocalizedCandidate[] = [];
  const exactByNormalized = new Map<string, LocalizedCandidate>();
  for (const item of items) {
    const canonical = String(item?.name || "").trim();
    const uniqueName = typeof item?.uniqueName === "string" ? item.uniqueName : null;
    if (!canonical || !uniqueName) continue;
    const localized = itemDatabase.localizedNameFields(uniqueName, canonical).displayName;
    if (!localized || localized === canonical) continue;
    const normalized = normalizeRussian(localized);
    if (!normalized || exactByNormalized.has(normalized)) continue;
    const candidate = { canonical, localized, normalized };
    exactByNormalized.set(normalized, candidate);
    candidates.push(candidate);
  }

  candidates.sort((a, b) => b.normalized.length - a.normalized.length);
  const index = { candidates, exactByNormalized };
  localizedCandidateIndexCache.set(items, index);
  return index;
}

function isUsefulPartialRead(text: string, candidate: string): boolean {
  if (!text || !candidate) return false;
  const wordCount = text.split(" ").filter(Boolean).length;
  return wordCount >= 2 && text.length >= candidate.length * MIN_PARTIAL_NAME_RATIO;
}

export function resolveRussianRewardText(
  text: string,
  items: SortedItem[],
): RussianRewardResolution {
  const normalizedText = normalizeRussian(text);
  if (!normalizedText) {
    return { text, matchMode: "none", matchConfidence: 0 };
  }

  const { candidates, exactByNormalized } = localizedCandidateIndex(items);
  const exact = exactByNormalized.get(normalizedText);
  if (exact) {
    return { text: exact.canonical, matchMode: "exact", matchConfidence: 1 };
  }

  for (const candidate of candidates) {
    if (normalizedText.includes(candidate.normalized)) {
      return { text: candidate.canonical, matchMode: "substring", matchConfidence: 0.97 };
    }
    if (
      candidate.normalized.includes(normalizedText) &&
      isUsefulPartialRead(normalizedText, candidate.normalized)
    ) {
      return {
        text: candidate.canonical,
        matchMode: "partial",
        matchConfidence: Math.min(0.96, normalizedText.length / candidate.normalized.length),
      };
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
    return { text: best.candidate.canonical, matchMode: "fuzzy", matchConfidence: best.score };
  }

  return { text, matchMode: "none", matchConfidence: best?.score ?? 0 };
}

export function canonicalizeRussianRewardTextForTest(text: string, items: SortedItem[]): string {
  return resolveRussianRewardText(text, items).text;
}

export async function runRussianRewardOcrStructuredBuffer(
  imageBuffer: Buffer,
  timeoutMs: number,
  items: SortedItem[],
): Promise<RussianRewardOcrResult> {
  const ocr = getSystemOcr();
  if (!ocr) throw new Error("@napi-rs/system-ocr is unavailable");

  let result: Awaited<ReturnType<SystemOcrModule["recognize"]>>;
  try {
    result = await withTimeout(
      ocr.recognize(imageBuffer, undefined, [RUSSIAN_LOCALE]),
      timeoutMs,
    );
    lastRussianOcrError = null;
  } catch (error) {
    lastRussianOcrError = normalizeErrorMessage(error);
    throw error;
  }
  const rawText = String(result?.text || "").trim();
  const resolution = resolveRussianRewardText(rawText, items);
  const text = resolution.text;
  const words = text.split(/\s+/).filter(Boolean);

  return {
    text,
    rawText,
    matchMode: resolution.matchMode,
    matchConfidence: resolution.matchConfidence,
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
