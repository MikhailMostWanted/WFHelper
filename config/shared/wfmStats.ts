import { normalizeRank, toFiniteNumber } from "./numeric";
import { asRecord } from "./objectValidation";

export const WFM_PRICE_BASIS = "closed-volume-average-48h-v1";
const WINDOW_MS = 48 * 60 * 60 * 1000;

export function extractAverageFromStatsPayload(
  jsonPayload: unknown,
  options?: { rank?: unknown; now?: number },
): { average: number; timestamp: number; volume: number } | null {
  const payload = asRecord(asRecord(jsonPayload)?.payload);
  const closed = asRecord(payload?.statistics_closed);
  const rows = closed?.["48hours"] ?? closed?.["48_hours"];
  if (!Array.isArray(rows)) return null;
  const rank = normalizeRank(options?.rank);
  if (options?.rank != null && rank == null) return null;
  const now = options?.now ?? Date.now();
  const samples = new Map<string, { price: number; volume: number; time: number }>();
  for (const value of rows) {
    const row = asRecord(value);
    if (!row || (row.order_type != null && row.order_type !== "sell")) continue;
    const rawRank = row.mod_rank ?? row.rank;
    const rowRank = normalizeRank(rawRank);
    if (rawRank != null && (toFiniteNumber(rawRank) == null || rowRank == null)) continue;
    if (rank != null ? rowRank !== rank : rowRank != null && rowRank !== 0) continue;
    const time = typeof row.datetime === "string" ? Date.parse(row.datetime) : NaN;
    const price = toFiniteNumber(row.wa_price);
    const volume = toFiniteNumber(row.volume);
    if (
      !Number.isFinite(time) ||
      time < now - WINDOW_MS ||
      time > now ||
      price == null ||
      price <= 0 ||
      volume == null ||
      volume <= 0
    )
      continue;
    samples.set(`${time}:${rowRank ?? "none"}`, { price, volume, time });
  }
  let total = 0;
  let volume = 0;
  let timestamp = 0;
  for (const sample of samples.values()) {
    // wa_price already weights the trades inside each bucket by quantity.
    total += sample.price * sample.volume;
    volume += sample.volume;
    timestamp = Math.max(timestamp, sample.time);
  }
  const average = Math.round(total / volume);
  return volume > 0 && Number.isFinite(average) && average > 0
    ? { average, timestamp, volume }
    : null;
}
