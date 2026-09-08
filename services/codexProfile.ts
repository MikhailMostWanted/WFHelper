import fs from "node:fs";
import https from "node:https";
import type { PersonalProfile, PersonalProfileResult } from "../config/shared/personalProfile";
import {
  enrichPersonalProfileNames,
  parsePersonalProfile,
  revivePersonalProfile,
} from "./personalProfileParser";
import { createJsonCache } from "./jsonCache";
import { loadRegionTranslation, localizedDictValue, nodeLabel } from "./regionNames";
import { withScope } from "./logger";
import { userDataPath } from "./userDataPath";
import { writeFileAtomicSync } from "./atomicFile";
import { normalizeErrorMessage } from "../config/shared/errors";
import type { CodexScanEntry, CodexScansResult } from "../config/shared/codexTypes";

const log = withScope("codexProfile");

const PROFILE_FILE = "codex-profile.json";
const CACHE_FILE = "codex-scans.json";
// Sync is manual-only (refresh button); the floor just absorbs double-clicks.
const REFRESH_MIN_INTERVAL_MS = 60_000;
const MAX_PROFILE_BYTES = 40_000_000;
const FETCH_TIMEOUT_MS = 20_000;

let _accountId: string | null = null;
let _cache: { fetchedAt: number; scans: CodexScanEntry[] } | null = null;
let _inFlight: Promise<CodexScansResult> | null = null;

function _profilePath(): string {
  return userDataPath(PROFILE_FILE);
}

function _cachePath(): string {
  return userDataPath(CACHE_FILE);
}

function _loadAccountId(): string | null {
  if (_accountId) return _accountId;
  try {
    const raw = JSON.parse(fs.readFileSync(_profilePath(), "utf8")) as { accountId?: unknown };
    if (typeof raw.accountId === "string" && /^[a-f0-9]{24}$/.test(raw.accountId)) {
      _accountId = raw.accountId;
    }
  } catch {
    // first run; the id arrives with the next inventory fetch
  }
  return _accountId;
}

/** Remember the account id seen in an inventory authz string. It never changes,
 * so persisting it keeps codex scans working while the game is closed. */
export function noteAuthz(authz: string): void {
  const id = /accountId=([a-f0-9]{24})/.exec(authz)?.[1];
  if (!id || id === _loadAccountId()) return;
  _accountId = id;
  try {
    writeFileAtomicSync(_profilePath(), JSON.stringify({ accountId: id }));
    log.info("[Codex] account id captured for profile fetches");
  } catch (err) {
    log.warn("[Codex] failed to persist account id:", normalizeErrorMessage(err));
  }
}

/** The scans array moved between root.Stats and Results[0].Stats historically. */
export function parseProfileScans(payload: unknown): CodexScanEntry[] | null {
  const root = payload as {
    Stats?: { Scans?: unknown };
    Results?: Array<{ Stats?: { Scans?: unknown } }>;
  } | null;
  const raw = root?.Stats?.Scans ?? root?.Results?.[0]?.Stats?.Scans;
  if (!Array.isArray(raw)) return null;
  const out: CodexScanEntry[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as { type?: unknown; scans?: unknown };
    const count = Number(record.scans);
    if (typeof record.type === "string" && record.type && Number.isFinite(count)) {
      out.push({ type: record.type, count: Math.max(0, Math.floor(count)) });
    }
  }
  return out;
}

function _httpsGetString(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json,*/*" } },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_PROFILE_BYTES) {
            req.destroy(new Error("profile response too large"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      },
    );
    req.setTimeout(FETCH_TIMEOUT_MS, () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}

function _loadDiskCache(): void {
  if (_cache) return;
  try {
    const raw = JSON.parse(fs.readFileSync(_cachePath(), "utf8")) as {
      fetchedAt?: unknown;
      scans?: unknown;
    };
    if (typeof raw.fetchedAt === "number" && Array.isArray(raw.scans)) {
      _cache = { fetchedAt: raw.fetchedAt, scans: raw.scans as CodexScanEntry[] };
    }
  } catch {
    // no cache yet
  }
}

export async function getCodexScans(refresh = false): Promise<CodexScansResult> {
  _loadDiskCache();
  if (!refresh) return _cache ?? { error: "no-data" };
  if (_cache && Date.now() - _cache.fetchedAt < REFRESH_MIN_INTERVAL_MS) return _cache;

  const accountId = _loadAccountId();
  if (!accountId) return _cache ?? { error: "no-account" };
  if (_inFlight) return _inFlight;

  _inFlight = (async (): Promise<CodexScansResult> => {
    try {
      const { scans, fetchedAt } = await fetchProfileSnapshot(accountId);
      if (!scans) throw new Error("no scans array in profile payload");
      _cache = { fetchedAt, scans };
      try {
        writeFileAtomicSync(_cachePath(), JSON.stringify(_cache));
      } catch {
        // cache write is best effort
      }
      log.info(`[Codex] profile scans fetched: ${scans.length} entries`);
      return _cache;
    } catch (err) {
      log.warn("[Codex] profile fetch failed:", normalizeErrorMessage(err));
      return _cache ?? { error: "fetch-failed" };
    } finally {
      _inFlight = null;
    }
  })();
  return _inFlight;
}

interface PersonalCache {
  accountId: string;
  fetchedAt: number;
  profile: PersonalProfile;
}

const personalDiskCache = createJsonCache<PersonalCache>("personal-profile.json", (value) => {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.accountId !== "string" ||
    !/^[a-f0-9]{24}$/.test(raw.accountId) ||
    typeof raw.fetchedAt !== "number" ||
    !Number.isFinite(raw.fetchedAt) ||
    raw.fetchedAt <= 0 ||
    raw.fetchedAt > Date.now() + 300000
  )
    return null;
  const profile = revivePersonalProfile(raw.profile);
  return profile ? { accountId: raw.accountId, fetchedAt: raw.fetchedAt, profile } : null;
});
let personalCache: PersonalCache | null = null;
let personalCacheAccount: string | null = null;
let personalAttempt: { accountId: string; at: number; failed: boolean } | null = null;
let personalRequest: { accountId: string; promise: Promise<PersonalProfileResult> } | null = null;

type ProfileSnapshot = {
  profile: PersonalProfile | null;
  scans: CodexScanEntry[] | null;
  fetchedAt: number;
};
let lastSnapshot: { accountId: string; value: ProfileSnapshot } | null = null;
const profileRequests = new Map<string, Promise<ProfileSnapshot>>();

async function fetchProfileSnapshot(accountId: string): Promise<ProfileSnapshot> {
  if (
    lastSnapshot?.accountId === accountId &&
    Date.now() - lastSnapshot.value.fetchedAt < REFRESH_MIN_INTERVAL_MS
  )
    return lastSnapshot.value;
  const pending = profileRequests.get(accountId);
  if (pending) return pending;
  const request = (async () => {
    const body = await _httpsGetString(
      `https://api.warframe.com/cdn/getProfileViewingData.php?playerId=${accountId}`,
    );
    const raw: unknown = JSON.parse(body);
    const value = {
      profile: parsePersonalProfile(raw),
      scans: parseProfileScans(raw),
      fetchedAt: Date.now(),
    };
    // Share the response between manual Codex and profile refreshes, not between accounts.
    if (_loadAccountId() === accountId) {
      lastSnapshot = { accountId, value };
      if (value.profile) {
        personalCacheAccount = accountId;
        personalCache = { accountId, fetchedAt: value.fetchedAt, profile: value.profile };
        personalDiskCache.write(personalCache);
      }
    }
    return value;
  })();
  profileRequests.set(accountId, request);
  try {
    return await request;
  } finally {
    if (profileRequests.get(accountId) === request) profileRequests.delete(accountId);
  }
}

function profileWithNames(profile: PersonalProfile): PersonalProfile {
  try {
    const pep = require("warframe-public-export-plus") as {
      ExportAbilities?: unknown;
      ExportWarframes?: unknown;
    };
    const translation = loadRegionTranslation();
    return enrichPersonalProfileNames(profile, {
      abilities: pep.ExportAbilities,
      warframes: pep.ExportWarframes,
      resolveName: localizedDictValue,
      missionName: (type) => {
        const region = translation.regions[type];
        if (!region) return null;
        return nodeLabel(
          {
            regions: {
              [type]: {
                ...region,
                name: localizedDictValue(region.name) ?? region.name,
                systemName: localizedDictValue(region.systemName) ?? region.systemName,
              },
            },
            dict: translation.dict,
          },
          type,
        );
      },
    });
  } catch {
    return profile;
  }
}

export async function getPersonalProfile(refresh = false): Promise<PersonalProfileResult> {
  const accountId = _loadAccountId();
  if (!accountId) return { profile: null, fetchedAt: null, status: "no-account", nextRefreshAt: 0 };
  if (personalCacheAccount !== accountId) {
    const stored = personalDiskCache.read();
    personalCache = stored?.accountId === accountId ? stored : null;
    personalCacheAccount = accountId;
  }
  const result = (status: PersonalProfileResult["status"]): PersonalProfileResult => ({
    profile:
      personalCache?.accountId === accountId ? profileWithNames(personalCache.profile) : null,
    fetchedAt: personalCache?.accountId === accountId ? personalCache.fetchedAt : null,
    status,
    nextRefreshAt: Math.max(
      personalCache?.accountId === accountId
        ? personalCache.fetchedAt + REFRESH_MIN_INTERVAL_MS
        : 0,
      personalAttempt?.accountId === accountId ? personalAttempt.at + REFRESH_MIN_INTERVAL_MS : 0,
    ),
  });
  const cachedStatus =
    personalAttempt?.accountId === accountId &&
    personalAttempt.failed &&
    (!personalCache || personalAttempt.at >= personalCache.fetchedAt)
      ? "fetch-failed"
      : personalCache
        ? "ready"
        : "no-data";
  if (!refresh) return result(cachedStatus);
  if (personalRequest?.accountId === accountId) return personalRequest.promise;
  if (Date.now() < result(cachedStatus).nextRefreshAt) return result(cachedStatus);
  const attempt = { accountId, at: Date.now(), failed: false };
  personalAttempt = attempt;
  const promise = (async (): Promise<PersonalProfileResult> => {
    try {
      const snapshot = await fetchProfileSnapshot(accountId);
      if (_loadAccountId() !== accountId)
        return { profile: null, fetchedAt: null, status: "account-changed", nextRefreshAt: 0 };
      if (!snapshot.profile) throw new Error("Profile data unavailable");
      if (
        personalCache?.accountId !== accountId ||
        personalCache.fetchedAt !== snapshot.fetchedAt
      ) {
        personalCache = { accountId, fetchedAt: snapshot.fetchedAt, profile: snapshot.profile };
        personalCacheAccount = accountId;
        personalDiskCache.write(personalCache);
      }
      return result("ready");
    } catch {
      attempt.failed = true;
      if (_loadAccountId() !== accountId)
        return { profile: null, fetchedAt: null, status: "account-changed", nextRefreshAt: 0 };
      return result("fetch-failed");
    }
  })();
  personalRequest = { accountId, promise };
  try {
    return await promise;
  } finally {
    if (personalRequest?.promise === promise) personalRequest = null;
  }
}
