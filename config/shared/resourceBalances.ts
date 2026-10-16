import { asRecord } from "./objectValidation";
import { unwrapInventoryPayload } from "./inventoryPayload";
import { eventResourceInfo, isEventResource } from "./eventResources";

export interface ResourceObservation {
  bindingId: string;
  source: string;
  capturedAt: number | null;
  fullMisc: boolean;
  amounts: Record<string, number | null>;
}
export interface ResourceHistory {
  version: 1;
  previous: ResourceObservation | null;
  current: ResourceObservation;
}
interface ResourceBalance {
  type: string;
  count: number | null;
  previousCount: number | null;
  delta: number | null;
  capturedAt: number | null;
  previousCapturedAt: number | null;
  name: string | null;
  nameRu: string | null;
  event: boolean;
  eventName: string | null;
  missionGain: null;
  missionGainReason: "no-itemized-mission-reward-source";
}
export interface ResourceTrackingReport {
  coverage: "available" | "partial";
  source: string;
  capturedAt: number | null;
  previousCapturedAt: number | null;
  comparison: "comparable" | "baseline";
  rows: ResourceBalance[];
}

const TOP_LEVEL = ["RegularCredits", "PremiumCredits", "FusionPoints", "PrimeTokens"] as const;
const LIMIT = 50_000;
const validAmount = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const validType = (v: unknown): v is string =>
  typeof v === "string" && v.length <= 512 && /^\/Lotus\/[A-Za-z0-9_/-]+$/.test(v);

/** Only typed stack counts and four known currency fields cross this boundary. */
export function observeResources(
  payload: unknown,
  options: Pick<ResourceObservation, "bindingId" | "source" | "capturedAt">,
): ResourceObservation {
  const raw = asRecord(unwrapInventoryPayload(payload)) ?? {};
  const amounts: Record<string, number | null> = Object.create(null);
  const misc = raw.MiscItems;
  let fullMisc = Array.isArray(misc) && misc.length <= LIMIT;
  if (Array.isArray(misc)) {
    for (const value of misc.slice(0, LIMIT)) {
      const row = asRecord(value);
      if (!validType(row?.ItemType)) {
        fullMisc = false;
        continue;
      }
      const type = row.ItemType;
      const count = validAmount(row.ItemCount) ? row.ItemCount : null;
      if (Object.prototype.hasOwnProperty.call(amounts, type)) {
        // Duplicate rows cannot silently add up or choose an arbitrary balance.
        amounts[type] = null;
        fullMisc = false;
      } else amounts[type] = count;
      if (count === null) fullMisc = false;
    }
  }
  for (const key of TOP_LEVEL) amounts[key] = validAmount(raw[key]) ? raw[key] : null;
  return { ...options, fullMisc, amounts };
}

function comparable(
  a: ResourceObservation | null,
  b: ResourceObservation,
): a is ResourceObservation {
  return (
    !!a &&
    /^[a-f0-9]{64}$/.test(b.bindingId) &&
    a.bindingId === b.bindingId &&
    a.source === b.source &&
    a.capturedAt !== null &&
    b.capturedAt !== null &&
    b.capturedAt > a.capturedAt
  );
}

/** Repeated reads/restarts keep the last real comparison; account/source switches rebaseline. */
export function advanceResourceHistory(
  history: ResourceHistory | null,
  next: ResourceObservation,
): ResourceHistory {
  const current = history?.current;
  if (current?.bindingId === next.bindingId && current.source === next.source) {
    const amounts = { ...next.amounts };
    for (const key of Object.keys(current.amounts)) {
      if (key.startsWith("/Lotus/") && !Object.prototype.hasOwnProperty.call(amounts, key))
        amounts[key] = next.fullMisc ? 0 : null;
    }
    next = { ...next, amounts };
  }
  if (
    current &&
    current.bindingId === next.bindingId &&
    current.source === next.source &&
    current.capturedAt !== null &&
    next.capturedAt !== null &&
    next.capturedAt <= current.capturedAt
  ) {
    const keys = Object.keys(current.amounts);
    if (
      current.fullMisc === next.fullMisc &&
      keys.length === Object.keys(next.amounts).length &&
      keys.every(
        (key) =>
          Object.prototype.hasOwnProperty.call(next.amounts, key) &&
          current.amounts[key] === next.amounts[key],
      )
    )
      return history!;
    // A same-time correction is a new baseline, not an ordering guarantee.
    if (next.capturedAt < current.capturedAt) return { version: 1, previous: null, current: next };
  }
  return {
    version: 1,
    previous: comparable(current ?? null, next) ? current! : null,
    current: next,
  };
}

export function resourceBalanceReport(history: ResourceHistory): ResourceTrackingReport {
  const { current, previous } = history;
  const before = comparable(previous, current) ? previous : null;
  const amount = (observation: ResourceObservation, type: string): number | null =>
    Object.prototype.hasOwnProperty.call(observation.amounts, type)
      ? observation.amounts[type]
      : type.startsWith("/Lotus/") && observation.fullMisc
        ? 0
        : null;
  const types = new Set([...Object.keys(current.amounts), ...Object.keys(before?.amounts ?? {})]);
  const rows = [...types].sort().map((type): ResourceBalance => {
    const count = amount(current, type);
    const previousCount = before ? amount(before, type) : null;
    const info = eventResourceInfo(type);
    return {
      type,
      count,
      previousCount,
      delta: count !== null && previousCount !== null ? count - previousCount : null,
      capturedAt: current.capturedAt,
      previousCapturedAt: before?.capturedAt ?? null,
      name: info?.name ?? null,
      nameRu: info?.nameRu ?? null,
      event: isEventResource(type),
      eventName: info?.eventName ?? null,
      missionGain: null,
      missionGainReason: "no-itemized-mission-reward-source",
    };
  });
  return {
    coverage: current.fullMisc && rows.every((row) => row.count !== null) ? "available" : "partial",
    source: current.source,
    capturedAt: current.capturedAt,
    previousCapturedAt: before?.capturedAt ?? null,
    comparison: before ? "comparable" : "baseline",
    rows,
  };
}

/** Reject damaged/oversized persisted state rather than manufacturing a comparison. */
export function parseResourceHistory(value: unknown): ResourceHistory | null {
  const raw = asRecord(value);
  if (raw?.version !== 1) return null;
  const observation = (v: unknown): v is ResourceObservation => {
    const o = asRecord(v);
    const amounts = asRecord(o?.amounts);
    return (
      !!o &&
      typeof o.bindingId === "string" &&
      /^(?:[a-f0-9]{64}|manual)$/.test(o.bindingId) &&
      typeof o.source === "string" &&
      o.source.length <= 100 &&
      (o.capturedAt === null ||
        (typeof o.capturedAt === "number" &&
          Number.isFinite(o.capturedAt) &&
          o.capturedAt >= 0 &&
          o.capturedAt <= 8.64e15)) &&
      typeof o.fullMisc === "boolean" &&
      !!amounts &&
      Object.keys(amounts).length <= LIMIT + TOP_LEVEL.length &&
      Object.entries(amounts).every(
        ([key, n]) =>
          (validType(key) || (TOP_LEVEL as readonly string[]).includes(key)) &&
          (n === null || validAmount(n)),
      )
    );
  };
  if (!observation(raw.current) || (raw.previous !== null && !observation(raw.previous)))
    return null;
  return raw as unknown as ResourceHistory;
}
