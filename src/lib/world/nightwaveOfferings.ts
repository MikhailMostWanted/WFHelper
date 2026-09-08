import { fetchBackendRaw, isBackendLiteConfigured } from "../wfm/backendLite.js";
import { log } from "../log.js";
import { readStorage, writeStorage } from "../persistence.js";
import { nightwaveOfferingOverride } from "../../../config/shared/nightwaveShop.js";
import { withAbortTimeout } from "../../../config/shared/fetchWithTimeout.js";
import { asRecord } from "../../../config/shared/objectValidation.js";
import {
  parseNightwaveOfferingsDoc,
  type NightwaveOfferingsDoc,
} from "../../../config/shared/nightwaveOfferings.js";
import { toFiniteNumber } from "../../../config/shared/numeric.js";

const STORAGE_KEY = "wf_nightwave_offerings_v1";
const FETCH_TIMEOUT_MS = 8000;
// Match the worker rebuild interval.
const REVALIDATE_AFTER_MS = 60 * 60 * 1000;
// The offering pool remains useful offline across weekly rotations.
const STORAGE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const BLUEPRINT_SUFFIX = " blueprint";

interface StoredCopy {
  savedAt: number;
  etag: string | null;
  doc: NightwaveOfferingsDoc;
}

let _memoryDoc: NightwaveOfferingsDoc | null = null;
let _inFlight: Promise<NightwaveOfferingsDoc | null> | null = null;

/** English catalog name to uniqueName; the first entry wins, as the wiki names one item. */
export function buildItemNameIndex(db: Record<string, { name?: string }>): Map<string, string> {
  const index = new Map<string, string>();
  for (const [uniqueName, entry] of Object.entries(db)) {
    const name = entry.name?.trim().toLowerCase();
    if (name && !index.has(name)) index.set(name, uniqueName);
  }
  return index;
}

/** Reviewed override first, then the catalog name, then the item a blueprint builds. */
export function resolveOfferingUniqueName(
  name: string,
  index: Map<string, string>,
): { uniqueName: string | null; imageOf?: string } {
  const override = nightwaveOfferingOverride(name);
  if (override) {
    const { quantity: _quantity, ...resolved } = override;
    return resolved;
  }
  const key = name.trim().toLowerCase();
  const direct = index.get(key);
  if (direct) return { uniqueName: direct };
  const built = key.endsWith(BLUEPRINT_SUFFIX)
    ? index.get(key.slice(0, -BLUEPRINT_SUFFIX.length))
    : undefined;
  return { uniqueName: built ?? null };
}

function readStored(): StoredCopy | null {
  const raw = readStorage(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = asRecord(JSON.parse(raw));
    if (!parsed) return null;
    const savedAt = toFiniteNumber(parsed.savedAt);
    if (savedAt == null || savedAt <= 0 || Date.now() - savedAt > STORAGE_MAX_AGE_MS) return null;
    const doc = parseNightwaveOfferingsDoc(parsed.doc);
    if (!doc) return null;
    return { savedAt, etag: typeof parsed.etag === "string" ? parsed.etag : null, doc };
  } catch {
    return null;
  }
}

async function requestOfferings(cached: StoredCopy | null): Promise<NightwaveOfferingsDoc | null> {
  const headers: Record<string, string> = {};
  if (cached?.etag) headers["If-None-Match"] = cached.etag;

  return withAbortTimeout(FETCH_TIMEOUT_MS, async (signal) => {
    const response = await fetchBackendRaw("/v1/nightwave-offerings", {
      signal,
      headers,
    });
    if (!response) return cached?.doc ?? null;

    if (response.status === 304) {
      if (!cached) return null;
      writeStorage(STORAGE_KEY, JSON.stringify({ ...cached, savedAt: Date.now() }));
      return cached.doc;
    }

    const doc = parseNightwaveOfferingsDoc(await response.json());
    if (!doc) return cached?.doc ?? null;

    writeStorage(
      STORAGE_KEY,
      JSON.stringify({ savedAt: Date.now(), etag: response.headers.get("etag"), doc }),
    );
    return doc;
  });
}

/** Retain the last good copy when the backend is unavailable. */
export async function loadNightwaveOfferings(): Promise<NightwaveOfferingsDoc | null> {
  if (_memoryDoc) return _memoryDoc;
  if (_inFlight) return _inFlight;
  if (!isBackendLiteConfigured()) return null;

  _inFlight = (async () => {
    const cached = readStored();
    if (cached && Date.now() - cached.savedAt < REVALIDATE_AFTER_MS) return cached.doc;
    try {
      return await requestOfferings(cached);
    } catch (e) {
      log.warn("[NightwaveOfferings] load failed:", e);
      return cached?.doc ?? null;
    }
  })()
    .then((doc) => {
      _memoryDoc = doc;
      return doc;
    })
    .finally(() => {
      _inFlight = null;
    });

  return _inFlight;
}

export function resetNightwaveOfferingsCacheForTest(): void {
  _memoryDoc = null;
  _inFlight = null;
}
