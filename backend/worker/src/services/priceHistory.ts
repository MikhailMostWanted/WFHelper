import {
	ARCHIVE_PRICES_PREFIX,
	MAX_ARCHIVE_BYTES,
	PRICE_HISTORY_BUCKETS,
	PRICE_HISTORY_PREFIX,
	PRICE_HISTORY_STATE_KEY,
} from '../constants';
import { getWorkerConfig } from '../config';
import { DAILY_MEDIAN_BASIS, readPriceArchiveRevisions, storedPriceMetadata, storedPriceRows } from './history';
import { readRankedSlugsFromKv } from './prewarmCatalog';
import { logEvent } from './logging';
import { isDateId } from './wfmStatistics';
import { byteLength, clamp, getJsonFromKv, isRecord } from '../utils';
import type { Env } from '../types';
import { toFiniteNumber } from '../../../../config/shared/numeric';
import { isWfmSlug } from '../../../../config/shared/textNormalize';
import { parseWfmCacheKey, rendererPriceCacheKey } from '../../../../config/shared/wfmCacheKeys';

const DEFAULT_DAYS_PER_TICK = 30;
const MAX_DAYS_PER_TICK = 90;
// Roughly a year of daily rows per key; the day archives keep the longer window.
const MAX_ENTRIES_PER_KEY = 400;
const MAX_RANK = 20;

/** `[date, median, volume]`; volume is null on a day the archive never got one. */
type PriceHistoryEntry = [string, number, number | null];

interface PriceHistoryDoc {
	v: 2;
	updatedAt: number;
	revisions: Record<string, string>;
	afterDate: string | null;
	series: Record<string, PriceHistoryEntry[]>;
}

interface PriceHistoryFoldResult {
	status: 'folded' | 'idle' | 'too_large' | 'disabled' | 'error';
	bucket: number;
	dates: number;
	keys: number;
	bytes: number;
}

/** `[date, rank, median, volume]` as the public route serves it. */
type PriceHistoryRow = [string, number | null, number, number | null];

type PriceHistoryLookup =
	| { status: 'not_ready' }
	| { status: 'not_found' }
	| { status: 'catalog_unavailable' }
	| { status: 'ok'; generatedAt: number; rows: PriceHistoryRow[] };

/** fnv1a-32 of the bare slug, so every rank of an item folds into one doc. */
export function priceHistoryBucket(slug: string): number {
	let hash = 0x811c9dc5;
	for (let index = 0; index < slug.length; index += 1) {
		hash ^= slug.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0) % PRICE_HISTORY_BUCKETS;
}

function bucketKey(bucket: number): string {
	return `${PRICE_HISTORY_PREFIX}${bucket}`;
}

/** Bare slug and rank of an archive row key, or null when it is not a price key. */
function archiveKeyParts(key: string): { slug: string; rank: number | null } | null {
	const parsed = parseWfmCacheKey(key);
	if (!parsed || !isWfmSlug(parsed.slug)) return null;
	if (parsed.namespace === 'renderer-price') {
		return parsed.rank != null && Number.isInteger(parsed.rank) && parsed.rank >= 0 && parsed.rank <= MAX_RANK
			? { slug: parsed.slug, rank: parsed.rank }
			: null;
	}
	// A bare slug parses as the rankless renderer namespace; any other suffix is not ours.
	return parsed.namespace === 'renderer-ranked' && parsed.rank == null ? { slug: parsed.slug, rank: null } : null;
}

function parseEntries(value: unknown): PriceHistoryEntry[] {
	if (!Array.isArray(value)) return [];
	const entries: PriceHistoryEntry[] = [];
	for (const entry of value.slice(-MAX_ENTRIES_PER_KEY)) {
		if (!Array.isArray(entry) || entry.length < 2) continue;
		const date = entry[0];
		if (!isDateId(date)) continue;
		const median = toFiniteNumber(entry[1]);
		if (median == null || median <= 0) continue;
		const volume = entry.length > 2 ? toFiniteNumber(entry[2]) : null;
		entries.push([date, median, volume != null && volume >= 0 ? volume : null]);
	}
	return entries;
}

function parseDoc(value: Record<string, unknown> | null): PriceHistoryDoc | null {
	if (!value || value.v !== 2 || !isRecord(value.series)) return null;
	const series: Record<string, PriceHistoryEntry[]> = Object.create(null);
	for (const [key, raw] of Object.entries(value.series)) {
		if (!archiveKeyParts(key)) continue;
		const entries = parseEntries(raw);
		if (entries.length > 0) series[key] = entries;
	}
	const updatedAt = toFiniteNumber(value.updatedAt);
	return {
		v: 2,
		updatedAt: updatedAt != null && updatedAt > 0 ? Math.floor(updatedAt) : 0,
		revisions: Object.fromEntries(
			Object.entries(isRecord(value.revisions) ? value.revisions : {}).filter(
				([date, revision]) => isDateId(date) && typeof revision === 'string',
			),
		) as Record<string, string>,
		afterDate: isDateId(value.afterDate) ? value.afterDate : null,
		series,
	};
}

async function readDoc(env: Env, bucket: number): Promise<PriceHistoryDoc | null> {
	return parseDoc(await getJsonFromKv(env.ITEM_META, bucketKey(bucket)));
}

function currentBucket(value: Record<string, unknown> | null): number {
	const bucket = toFiniteNumber(value?.bucket);
	if (bucket == null || !Number.isInteger(bucket) || bucket < 0 || bucket >= PRICE_HISTORY_BUCKETS) return 0;
	return bucket;
}

/** One date per key: a re-folded day replaces its entry rather than duplicating it. */
function foldEntry(entries: PriceHistoryEntry[], entry: PriceHistoryEntry): void {
	const at = entries.findIndex((row) => row[0] === entry[0]);
	if (at >= 0) entries[at] = entry;
	else entries.push(entry);
}

function foldDay(doc: PriceHistoryDoc, bucket: number, date: string, day: Record<string, unknown> | null): void {
	for (const [key, entries] of Object.entries(doc.series)) {
		doc.series[key] = entries.filter((entry) => entry[0] !== date);
	}
	const metadata = storedPriceMetadata(day);
	for (const row of storedPriceRows(day)) {
		const parts = archiveKeyParts(row[0]);
		if (!parts || priceHistoryBucket(parts.slug) !== bucket) continue;
		const basis = metadata.priceBasisByKey[row[0]];
		const median = basis && basis !== DAILY_MEDIAN_BASIS ? metadata.dailyMedians[row[0]] : row[1];
		if (median == null || !Number.isFinite(median) || median <= 0) continue;
		const raw = row.length === 3 ? row[2] : null;
		const volume = raw != null && Number.isFinite(raw) && raw >= 0 ? raw : null;
		const entries = doc.series[row[0]] ?? [];
		foldEntry(entries, [date, median, volume]);
		doc.series[row[0]] = entries;
	}
}

function pruneSeries(doc: PriceHistoryDoc): number {
	let keys = 0;
	for (const [key, entries] of Object.entries(doc.series)) {
		if (entries.length === 0) {
			delete doc.series[key];
			continue;
		}
		entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
		if (entries.length > MAX_ENTRIES_PER_KEY) doc.series[key] = entries.slice(-MAX_ENTRIES_PER_KEY);
		keys += 1;
	}
	return keys;
}

/** Advances one bucket per call: the day archives are folded into per-item series so a
 *  client can read one item's year without downloading every day. Never holds more than
 *  one day archive at a time, and the state key carries the bucket the next call takes. */
export async function foldPriceHistory(env: Env, options: { now?: number; daysPerTick?: number } = {}): Promise<PriceHistoryFoldResult> {
	const now = options.now ?? Date.now();
	const config = getWorkerConfig(env);
	const base: PriceHistoryFoldResult = { status: 'disabled', bucket: 0, dates: 0, keys: 0, bytes: 0 };
	if (!config.historyArchiveEnabled) return base;

	let bucket = 0;
	try {
		bucket = currentBucket(await getJsonFromKv(env.ITEM_META, PRICE_HISTORY_STATE_KEY));
		const doc: PriceHistoryDoc = (await readDoc(env, bucket)) ?? {
			v: 2,
			updatedAt: 0,
			revisions: {},
			afterDate: null,
			series: Object.create(null),
		};
		const daysPerTick = clamp(options.daysPerTick ?? DEFAULT_DAYS_PER_TICK, 1, MAX_DAYS_PER_TICK);
		const revisions = await readPriceArchiveRevisions(env);
		const pending = Object.keys(revisions)
			.filter((date) => isDateId(date) && doc.revisions[date] !== revisions[date])
			.sort();
		// Rotate retries so unreadable old days cannot starve newly archived dates.
		const afterDate = doc.afterDate;
		const split = afterDate == null ? 0 : pending.findIndex((date) => date > afterDate);
		const ordered = split > 0 ? [...pending.slice(split), ...pending.slice(0, split)] : pending;
		const dates = ordered.slice(0, daysPerTick);

		if (dates.length === 0) {
			await advanceBucket(env, bucket, now);
			return { ...base, status: 'idle', bucket, keys: Object.keys(doc.series).length };
		}

		for (const date of dates) {
			const day = await getJsonFromKv(env.ITEM_META, `${ARCHIVE_PRICES_PREFIX}${date}`).catch(() => null);
			// KV can expose the new index before its day value; acknowledge only that revision.
			if (!day || !Array.isArray(day.rows) || (revisions[date] !== 'legacy' && day.revision !== revisions[date])) continue;
			foldDay(doc, bucket, date, day);
			doc.revisions[date] = revisions[date];
		}
		doc.afterDate = dates[dates.length - 1];
		for (const date of Object.keys(doc.revisions)) if (!(date in revisions)) delete doc.revisions[date];
		doc.updatedAt = now;
		const keys = pruneSeries(doc);

		const body = JSON.stringify(doc);
		const bytes = byteLength(body);
		if (bytes > MAX_ARCHIVE_BYTES) {
			logEvent({ type: 'error', route: 'history:prices', status: 500, bytes, error: 'history_too_large' });
			await advanceBucket(env, bucket, now);
			return { ...base, status: 'too_large', bucket, dates: dates.length, keys, bytes };
		}

		await env.ITEM_META.put(bucketKey(bucket), body);
		await advanceBucket(env, bucket, now);
		logEvent({ type: 'cron', route: 'history:prices', status: 200, count: keys, bytes });
		return { status: 'folded', bucket, dates: dates.length, keys, bytes };
	} catch (err) {
		logEvent({
			type: 'error',
			route: 'history:prices',
			status: 500,
			error: err instanceof Error ? err.message : 'unknown_error',
		});
		return { ...base, status: 'error', bucket };
	}
}

async function advanceBucket(env: Env, bucket: number, now: number): Promise<void> {
	await env.ITEM_META.put(PRICE_HISTORY_STATE_KEY, JSON.stringify({ bucket: (bucket + 1) % PRICE_HISTORY_BUCKETS, updatedAt: now }));
}

/** Bare mod rows are rank 0 even when the archive has no ranked siblings. */
export async function readPriceHistory(env: Env, slug: string): Promise<PriceHistoryLookup> {
	const doc = await readDoc(env, priceHistoryBucket(slug));
	if (!doc) return { status: 'not_ready' };

	const bare = doc.series[slug] ?? [];
	const ranked: Array<{ rank: number; entries: PriceHistoryEntry[] }> = [];
	for (let rank = 0; rank <= MAX_RANK; rank += 1) {
		const entries = doc.series[rendererPriceCacheKey(slug, rank)];
		if (entries) ranked.push({ rank, entries });
	}
	if (bare.length === 0 && ranked.length === 0) return { status: 'not_found' };
	const rankedSlugs = bare.length > 0 ? await readRankedSlugsFromKv(env) : null;
	if (bare.length > 0 && !rankedSlugs) return { status: 'catalog_unavailable' };

	const rows: PriceHistoryRow[] = [];
	const bareRank = rankedSlugs?.has(slug) ? 0 : null;
	const bareDates = new Set(bare.map((entry) => entry[0]));
	for (const entry of bare) rows.push([entry[0], bareRank, entry[1], entry[2]]);
	for (const { rank, entries } of ranked) {
		for (const entry of entries) {
			// The volume sweep enriches the bare rank-0 row; keep it over a snapshot sibling.
			if (rank === bareRank && bareDates.has(entry[0])) continue;
			rows.push([entry[0], rank, entry[1], entry[2]]);
		}
	}
	rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : (a[1] ?? -1) - (b[1] ?? -1)));
	return { status: 'ok', generatedAt: doc.updatedAt, rows };
}
