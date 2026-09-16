import type { NativeImage } from "electron";

import {
  binarizeRewardRegion,
  cropRect,
  detectRewardSlotLayoutCandidates,
} from "./rewardScannerImage";
import { recognizeRewardStripOnnx, rewardOcrOnnxAvailable } from "./rewardOcrOnnx";
import {
  MAX_REWARD_SLOTS,
  rankRewardCandidatesDetailed,
  SUBSTRING_SCORE_FLOOR,
  type SortedItem,
} from "./rewardScannerMatch";
import { hasConfidentSlotLayout } from "./rewardScannerSupport";
import { dumpRewardScanDebug, type ScanDebugSlot } from "./rewardScanDebug";
import { withScope } from "./logger";
import { yieldToEventLoop } from "./rewardScannerUtils";

const log = withScope("rewardScanner");

interface OcrLine {
  text?: string;
  box?: { top?: number; height?: number };
}

interface StructuredOcrResult {
  text?: string;
  lines?: OcrLine[];
}

interface SlotCandidate {
  item: SortedItem;
  confidence: number;
  score: number;
  mode: string;
}

interface SlotDebugInfo {
  index: number;
  stripPng: Buffer;
  windowsText: string;
  onnxText: string;
  diverged: boolean;
}

function toScanDebugSlots(
  slotResults: Array<{ index: number; candidates: SlotCandidate[]; debug: SlotDebugInfo } | null>,
): ScanDebugSlot[] {
  const out: ScanDebugSlot[] = [];
  for (const entry of slotResults) {
    if (!entry?.debug) continue;
    const matched = entry.candidates[0] || null;
    out.push({
      index: entry.debug.index,
      stripPng: entry.debug.stripPng,
      windowsText: entry.debug.windowsText,
      onnxText: entry.debug.onnxText,
      diverged: entry.debug.diverged,
      matchedName: matched ? matched.item.name : null,
      confidence: matched ? matched.confidence : null,
      mode: matched ? matched.mode : null,
    });
  }
  return out;
}

interface SlotScanResult {
  items: SortedItem[];
  score: number;
  exactCount: number;
  slotCount: number;
  strategy: string;
  slotConfidence: number;
  avgConfidence: number;
  matchedSlots: number;
  emptySlots: number;
}

interface SlotRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CollectedSlot {
  index: number;
  candidate: SlotCandidate;
}

interface LayoutRun {
  rects: SlotRect[];
  collected: CollectedSlot[];
  nearMisses: (SlotCandidate | null)[];
  slotLimit: number;
  layoutCount: number;
  layoutConfidence: number;
}

// Margin below the candidate's own tier gate, so substring/exact rescues stay
// as strict relative to their tier as fuzzy ones.
const NEAR_MISS_RESCUE_MARGIN = 0.06;

function isNearMissCandidate(candidate: SlotCandidate): boolean {
  // A substring score sitting on the clamp was never measured, so the rescue
  // margin must not carry it over SUBSTRING_SLOT_GATE.
  if (candidate.mode === "substring" && candidate.confidence <= SUBSTRING_SCORE_FLOOR + 1e-6) {
    return false;
  }
  return isUsableSlotCandidate({
    ...candidate,
    confidence: candidate.confidence + NEAR_MISS_RESCUE_MARGIN,
  });
}

function collectNearMissSlots(run: LayoutRun, collected: CollectedSlot[]): CollectedSlot[] {
  const takenNames = new Set(collected.map((entry) => entry.candidate.item.name));
  const filledSlots = new Set(collected.map((entry) => entry.index));
  const rescued: CollectedSlot[] = [];
  for (let index = 0; index < run.slotLimit; index++) {
    if (filledSlots.has(index)) continue;
    const nearMiss = run.nearMisses[index];
    if (!nearMiss || !isNearMissCandidate(nearMiss)) continue;
    if (takenNames.has(nearMiss.item.name)) continue;
    takenNames.add(nearMiss.item.name);
    rescued.push({ index, candidate: nearMiss });
  }
  return rescued;
}

function buildLayoutResult(
  run: LayoutRun,
  collected: CollectedSlot[],
  expectedCount: number,
  strategy: string,
): SlotScanResult {
  // slotIndex keeps the on-screen position so the overlay can leave gaps
  const items = collected.map((entry) => ({ ...entry.candidate.item, slotIndex: entry.index }));
  const exactCount = collected.reduce(
    (sum, entry) => sum + (entry.candidate.mode === "exact" ? 1 : 0),
    0,
  );
  const avgConfidence =
    collected.reduce((sum, entry) => sum + Number(entry.candidate.confidence || 0), 0) /
    Math.max(1, collected.length);
  const avgCandidateScore =
    collected.reduce((sum, entry) => sum + Number(entry.candidate.score || 0), 0) /
    Math.max(1, collected.length);
  const emptySlots = run.slotLimit - collected.length;
  const expectedFillBonus =
    expectedCount > 0 ? Math.min(collected.length, expectedCount) / expectedCount : 0;
  const score =
    avgCandidateScore +
    collected.length * 44 +
    exactCount * 35 +
    avgConfidence * 20 +
    run.layoutConfidence * 12 +
    expectedFillBonus * 18 -
    emptySlots * 30;
  return {
    items,
    score,
    exactCount,
    slotCount: run.layoutCount,
    strategy,
    slotConfidence: run.layoutConfidence,
    avgConfidence,
    matchedSlots: collected.length,
    emptySlots,
  };
}

function xOverlapFraction(a: SlotRect, b: SlotRect): number {
  const overlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  return overlap <= 0 ? 0 : overlap / Math.min(a.width, b.width);
}

/** Fill the winner's empty slots with hits other layouts found at the same x-position. */
function collectDonorSlots(best: LayoutRun, runs: LayoutRun[]): CollectedSlot[] {
  const filled = new Set(best.collected.map((entry) => entry.index));
  const donorsBySlot = new Map<number, SlotCandidate>();
  for (const run of runs) {
    if (run === best) continue;
    for (const entry of run.collected) {
      const rect = run.rects[entry.index];
      if (!rect) continue;
      // Assign each donor to the one winner slot it overlaps most, so a single
      // physical card can't fill two slots.
      let baseIndex = -1;
      let baseOverlap = 0;
      for (let i = 0; i < best.slotLimit; i++) {
        const overlap = best.rects[i] ? xOverlapFraction(rect, best.rects[i]) : 0;
        if (overlap > baseOverlap) {
          baseOverlap = overlap;
          baseIndex = i;
        }
      }
      if (baseIndex < 0 || baseOverlap < 0.5 || filled.has(baseIndex)) continue;
      const existing = donorsBySlot.get(baseIndex);
      if (!existing || entry.candidate.score > existing.score) {
        donorsBySlot.set(baseIndex, entry.candidate);
      }
    }
  }
  return [...donorsBySlot.entries()].map(([index, candidate]) => ({ index, candidate }));
}

export type StructuredOcrBufferRunner = (
  buffer: Buffer,
  timeoutMs: number,
) => Promise<StructuredOcrResult>;

/** Which OCR reader(s) feed slot candidates; "both" is production behavior. */
export type RewardReader = "windows" | "onnx" | "both";

/** Out-param: lets the caller tell "not the reward screen" from "OCR missed",
 *  and carries the stage costs the per-attempt timing line reports. */
export interface SlotScanStats {
  layoutCount: number;
  /** Cards read off the card bars; 0 when the count came from OCR instead. */
  cardCount: number;
  layoutMs: number;
  ocrMs: number;
  ocrReads: number;
  layoutsTried: number;
}

// Just under the 0.86 fuzzy gate, so a read that nearly cleared it counts as a
// near miss while padding-slot junk does not.
const NEAR_GATE_CONFIDENCE = 0.85;

// A containment match only clears its tier above the SUBSTRING_SCORE_FLOOR
// clamp, so a score that was never measured cannot fill a slot on its own.
const SUBSTRING_SLOT_GATE = 0.92;

function isUsableSlotCandidate(candidate: SlotCandidate): boolean {
  if (!candidate?.item?.name) return false;
  const normalizedName = String(candidate.item.name || "").trim();
  const nameWords = normalizedName.split(/\s+/).filter(Boolean);
  if (nameWords.length <= 1 && normalizedName.length < 5) {
    return candidate.mode === "exact" && candidate.confidence >= 0.99;
  }
  if (candidate.mode === "exact") return candidate.confidence >= 0.98;
  if (candidate.mode === "substring") return candidate.confidence >= SUBSTRING_SLOT_GATE;
  return candidate.confidence >= 0.86;
}

async function ocrRewardRegion(
  cropPng: Buffer,
  topFrac: number,
  heightFrac: number,
  options: { runOCRStructuredBuffer: StructuredOcrBufferRunner },
  timeoutMs: number,
): Promise<string> {
  try {
    const buf = await binarizeRewardRegion(cropPng, topFrac, heightFrac);
    if (!buf) return "";
    const structured = await options.runOCRStructuredBuffer(buf, timeoutMs);
    return String(structured?.text || "")
      .replace(/\s+/g, " ")
      .trim();
  } catch {
    return "";
  }
}

/** Drop 1-character OCR noise tokens but preserve text from every client language. */
function cleanRewardOcrText(text: string): string {
  return String(text || "")
    .split(/\s+/)
    .filter((word) => word === "&" || word.replace(/[^\p{L}\p{N}]/gu, "").length > 1)
    .join(" ")
    .trim();
}

function joinRewardLines(top: string, bottom: string): string {
  return [cleanRewardOcrText(top), cleanRewardOcrText(bottom)]
    .filter((s) => s.length > 0)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

interface SlotRead {
  candidates: SlotCandidate[];
  nearMiss: SlotCandidate | null;
  stripPng: Buffer;
  windowsText: string;
  onnxText: string;
  diverged: boolean;
}

async function readSlotTitle(
  image: NativeImage,
  titleRect: SlotRect,
  displayIndex: number,
  totalBudgetMs: number,
  startedAt: number,
  options: {
    sortedItems: SortedItem[];
    ocrTimeoutMs: number;
    runOCRStructuredBuffer: StructuredOcrBufferRunner;
    reader: RewardReader;
    stats?: SlotScanStats;
  },
): Promise<SlotRead | null> {
  // Stagger the slots' sync crop+encode work across macrotasks.
  await yieldToEventLoop();
  const remainingBudgetMs = totalBudgetMs - (Date.now() - startedAt);
  if (remainingBudgetMs <= 0) return null;

  let crop: NativeImage;
  try {
    crop = cropRect(image, titleRect);
  } catch {
    return null;
  }

  const cropPng: Buffer = crop.toPNG();
  const timeout = Math.max(500, Math.min(options.ocrTimeoutMs, remainingBudgetMs));
  const reader = options.reader;
  const useWindows = reader !== "onnx";
  const useOnnx = reader !== "windows" && rewardOcrOnnxAvailable();

  const ocrStartedAt = Date.now();
  // Names wrap to two lines in 3/4-player layouts: OCR overlapping bands plus
  // the whole crop; both readers feed one pool, the ranking arbitrates.
  const [regionTexts, onnxRead] = await Promise.all([
    useWindows
      ? Promise.all([
          ocrRewardRegion(cropPng, 0, 0.58, options, timeout),
          ocrRewardRegion(cropPng, 0.42, 0.58, options, timeout),
          ocrRewardRegion(cropPng, 0, 1, options, timeout),
        ])
      : Promise.resolve(["", "", ""]),
    useOnnx ? recognizeRewardStripOnnx(cropPng) : Promise.resolve(null),
  ]);
  if (options.stats) {
    options.stats.ocrMs += Date.now() - ocrStartedAt;
    options.stats.ocrReads += (useWindows ? 3 : 0) + (useOnnx ? 1 : 0);
  }

  const joined = joinRewardLines(regionTexts[0], regionTexts[1]);
  const wholeClean = cleanRewardOcrText(regionTexts[2]);
  const onnxClean = cleanRewardOcrText(onnxRead?.text || "");

  const candidateTexts = new Set<string>();
  if (joined) candidateTexts.add(joined);
  if (wholeClean) candidateTexts.add(wholeClean);
  if (onnxClean) candidateTexts.add(onnxClean);
  const diverged =
    !!onnxClean && !!(joined || wholeClean) && onnxClean !== joined && onnxClean !== wholeClean;
  if (diverged) {
    log.info(
      `[RewardScanner] Slot ${displayIndex + 1} reads diverge: windows="${wholeClean || joined}" onnx="${onnxClean}"`,
    );
  }

  const rankedCandidates: SlotCandidate[] = [];
  let bestRejected: SlotCandidate | null = null;
  for (const candidateText of candidateTexts) {
    for (const candidate of rankRewardCandidatesDetailed(candidateText, options.sortedItems, 4)) {
      if (!candidate.item) continue;
      const slotCandidate: SlotCandidate = {
        item: candidate.item,
        confidence: candidate.confidence,
        score: candidate.score,
        mode: candidate.mode,
      };
      if (isUsableSlotCandidate(slotCandidate)) {
        rankedCandidates.push(slotCandidate);
      } else if (!bestRejected || slotCandidate.confidence > bestRejected.confidence) {
        bestRejected = slotCandidate;
      }
    }
  }

  if (rankedCandidates.length === 0 && bestRejected) {
    log.info(
      `[RewardScanner] Slot ${displayIndex + 1} near miss: ${bestRejected.item.name} ` +
        `confidence=${bestRejected.confidence.toFixed(2)} mode=${bestRejected.mode}`,
    );
  }

  rankedCandidates.sort((a, b) => b.score - a.score);
  // A crop can produce the same item through joined/whole/ONNX reads. Keep the
  // best candidate per reward so global assignment sees alternatives, not clones.
  const seenNames = new Set<string>();
  const candidates = rankedCandidates.filter((candidate) => {
    if (seenNames.has(candidate.item.name)) return false;
    seenNames.add(candidate.item.name);
    return true;
  });

  return {
    candidates,
    nearMiss: bestRejected?.confidence && bestRejected.confidence >= NEAR_GATE_CONFIDENCE
      ? bestRejected
      : null,
    stripPng: cropPng,
    windowsText: wholeClean || joined,
    onnxText: onnxClean,
    diverged,
  };
}

function evaluateLayoutRun(run: LayoutRun, expectedCount: number): SlotScanResult | null {
  if (run.collected.length === 0) return null;
  let collected = [...run.collected];
  if (collected.length < run.slotLimit) {
    const rescued = collectNearMissSlots(run, collected);
    if (rescued.length > 0) collected = [...collected, ...rescued];
  }
  return buildLayoutResult(run, collected, expectedCount, "slot-layout");
}

/** Try each geometry interpretation independently; the strongest coherent one wins. */
async function scanBySlotLayout(
  image: NativeImage,
  sortedItems: SortedItem[],
  expectedCount: number,
  maxBudgetMs: number,
  startedAt: number,
  options: {
    runOCRStructuredBuffer: StructuredOcrBufferRunner;
    ocrTimeoutMs: number;
    reader: RewardReader;
    stats?: SlotScanStats;
  },
): Promise<SlotScanResult | null> {
  const layoutCandidates = detectRewardSlotLayoutCandidates(image);
  if (options.stats) {
    options.stats.layoutCount = layoutCandidates.length;
    options.stats.cardCount = Math.max(0, ...layoutCandidates.map((layout) => layout.cardCount));
  }
  if (layoutCandidates.length === 0) return null;

  // Full line-visible layout first; half-layout first would consume the OCR
  // budget on a crop that chops the two-line 4-player reward names.
  const orderedCandidates = [...layoutCandidates].sort((a, b) => {
    if (b.cardCount !== a.cardCount) return b.cardCount - a.cardCount;
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return b.rects.length - a.rects.length;
  });

  const runs: LayoutRun[] = [];
  for (const layout of orderedCandidates) {
    if (Date.now() - startedAt >= maxBudgetMs) break;
    const slotLimit = Math.min(MAX_REWARD_SLOTS, layout.rects.length);
    if (slotLimit === 0) continue;
    const remainingBudget = maxBudgetMs - (Date.now() - startedAt);
    if (remainingBudget <= 0) break;
    const slotResults = await Promise.all(
      layout.rects.slice(0, slotLimit).map((rect, index) =>
        readSlotTitle(image, rect, index, remainingBudget, startedAt, {
          sortedItems,
          ocrTimeoutMs: options.ocrTimeoutMs,
          runOCRStructuredBuffer: options.runOCRStructuredBuffer,
          reader: options.reader,
          stats: options.stats,
        }),
      ),
    );
    const collected: CollectedSlot[] = [];
    const nearMisses: (SlotCandidate | null)[] = new Array(slotLimit).fill(null);
    for (let i = 0; i < slotResults.length; i++) {
      const candidates = slotResults[i]?.candidates || [];
      if (candidates.length > 0) collected.push({ index: i, candidate: candidates[0] });
      nearMisses[i] = slotResults[i]?.nearMiss || null;
    }
    runs.push({
      rects: layout.rects.slice(0, slotLimit),
      collected,
      nearMisses,
      slotLimit,
      layoutCount: layout.rects.length,
      layoutConfidence: layout.confidence,
    });

    if (collected.length === slotLimit) break;
  }

  if (runs.length === 0) return null;

  const evaluated = runs
    .map((run) => ({ run, result: evaluateLayoutRun(run, expectedCount) }))
    .filter((entry): entry is { run: LayoutRun; result: SlotScanResult } => Boolean(entry.result));
  if (evaluated.length === 0) return null;

  evaluated.sort((a, b) => b.result.score - a.result.score);
  const best = evaluated[0];
  if (best.result.matchedSlots >= best.result.slotCount) return best.result;

  const donors = collectDonorSlots(best.run, runs);
  if (donors.length === 0) return best.result;
  const filled = [...best.run.collected, ...donors];
  return buildLayoutResult(best.run, filled, expectedCount, "slot-layout-donor");
}

export async function scanRewardSlots(
  image: NativeImage,
  sortedItems: SortedItem[],
  options: {
    expectedCount?: number;
    maxBudgetMs: number;
    ocrTimeoutMs: number;
    runOCRStructuredBuffer: StructuredOcrBufferRunner;
    reader?: RewardReader;
    stats?: SlotScanStats;
    debugImage?: NativeImage | null;
  },
): Promise<SlotScanResult | null> {
  const expectedCount = Math.max(1, Math.min(MAX_REWARD_SLOTS, options.expectedCount || MAX_REWARD_SLOTS));
  const startedAt = Date.now();
  const result = await scanBySlotLayout(
    image,
    sortedItems,
    expectedCount,
    options.maxBudgetMs,
    startedAt,
    {
      runOCRStructuredBuffer: options.runOCRStructuredBuffer,
      ocrTimeoutMs: options.ocrTimeoutMs,
      reader: options.reader ?? "both",
      stats: options.stats,
    },
  );
  if (result) return result;

  if (options.debugImage) {
    try {
      await dumpRewardScanDebug(options.debugImage, [], {
        reason: "slot-scan-no-match",
        expectedCount,
      });
    } catch (error) {
      log.warn("[RewardScanner] Failed to dump reward scan debug:", error);
    }
  }
  return null;
}
