import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/index';
import { foldPriceHistory, priceHistoryBucket } from '../src/services/priceHistory';
import { recordArchiveEntries, mergeVolumes, archiveDailyPrices } from '../src/services/history';
import { resetRankedSlugCacheForTest } from '../src/services/prewarmCatalog';
import type { Env } from '../src/types';

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

const STATE_KEY = 'history:prices:state:v2';
const INDEX_KEY = 'archive:index:prices:v1';
const NOW = Date.parse('2026-09-02T09:00:00.000Z');
const BUCKETS = 64;

beforeEach(async () => {
	resetRankedSlugCacheForTest();
	await env.ITEM_META.put('order-summary:catalog:v1', JSON.stringify({ entries: [{ slug: 'primed_flow', maxRank: 10 }] }));
	(env as unknown as Record<string, string>).HISTORY_ARCHIVE_ENABLED = '1';
	(env as unknown as Record<string, string>).PUBLIC_BOOTSTRAP_REQUIRED = '0';
	(env as unknown as Record<string, string>).DAILY_BUDGET_ENABLED = '0';
	(env as unknown as Record<string, string>).PUBLIC_RATE_LIMIT_ENABLED = '0';
	await env.ITEM_META.delete(STATE_KEY);
	await env.ITEM_META.delete(INDEX_KEY);
	for (let bucket = 0; bucket < BUCKETS; bucket += 1) await env.ITEM_META.delete(bucketKey(bucket));
}, 30_000);

function testEnv(overrides: Record<string, string> = {}): Env {
	return { ...env, ...overrides } as unknown as Env;
}

function bucketKey(bucket: number): string {
	return `history:prices:v2:${bucket}`;
}

/** A valid slug that hashes into (or away from) a bucket, so a test never guesses one. */
function probeSlug(bucket: number, match: boolean): string {
	for (let index = 0; index < 1000; index += 1) {
		const slug = `probe_slug_${index}`;
		if ((priceHistoryBucket(slug) === bucket) === match) return slug;
	}
	throw new Error(`No probe slug for bucket ${bucket}`);
}

async function readJson(key: string): Promise<Record<string, unknown> | null> {
	const raw = await env.ITEM_META.get(key);
	return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
}

async function seedDay(date: string, rows: unknown[]): Promise<void> {
	const revision = crypto.randomUUID();
	await env.ITEM_META.put(
		`archive:prices:${date}`,
		JSON.stringify({ v: 1, date, revision, generatedAt: 111, source: 'snapshot', columns: ['key', 'median', 'volume'], rows }),
	);
	await recordArchiveEntries(testEnv(), 'prices', [date], 730, { [date]: revision });
}

/** The fold walks one bucket per call, so the state is pointed at the slug under test. */
async function foldFor(slug: string, options: { now?: number; daysPerTick?: number } = {}) {
	await env.ITEM_META.put(STATE_KEY, JSON.stringify({ bucket: priceHistoryBucket(slug), updatedAt: NOW }));
	return foldPriceHistory(testEnv(), { now: options.now ?? NOW, ...options });
}

async function seriesOf(slug: string): Promise<Record<string, unknown>> {
	const doc = await readJson(bucketKey(priceHistoryBucket(slug)));
	return (doc?.series as Record<string, unknown>) ?? {};
}

async function get(path: string): Promise<Response> {
	const request = new IncomingRequest(`http://example.com${path}`);
	const ctx = createExecutionContext();
	const response = await worker.fetch(request, env, ctx);
	await waitOnExecutionContext(ctx);
	return response;
}

async function clearEdgeCache(slug: string): Promise<void> {
	await caches.default.delete(new Request(`http://example.com/v1/price-history/${slug}?v=2`));
}

describe('price history fold', () => {
	it('folds a bucket, records its revisions and hands the state to the next bucket', async () => {
		await seedDay('2026-08-30', [['forma', 12, 4]]);
		await seedDay('2026-08-31', [['forma', 13]]);

		const result = await foldFor('forma');

		expect(result).toMatchObject({ status: 'folded', bucket: priceHistoryBucket('forma'), dates: 2, keys: 1 });
		expect(await seriesOf('forma')).toEqual({
			forma: [
				['2026-08-30', 12, 4],
				['2026-08-31', 13, null],
			],
		});
		expect(await readJson(bucketKey(priceHistoryBucket('forma')))).toMatchObject({
			v: 2,
			revisions: { '2026-08-30': expect.any(String), '2026-08-31': expect.any(String) },
			updatedAt: NOW,
		});
		expect(await readJson(STATE_KEY)).toMatchObject({ bucket: (priceHistoryBucket('forma') + 1) % BUCKETS });
	});

	it('folds only the rows whose bare slug hashes to the bucket it is on', async () => {
		const other = probeSlug(priceHistoryBucket('forma'), false);
		await seedDay('2026-08-30', [
			['forma', 10, 1],
			[other, 20, 2],
		]);

		await foldFor('forma');

		expect(Object.keys(await seriesOf('forma'))).toEqual(['forma']);
		expect(await readJson(bucketKey(priceHistoryBucket(other)))).toBeNull();
	});

	it('takes only the oldest daysPerTick dates and resumes with unfinished revisions', async () => {
		await seedDay('2026-08-28', [['forma', 1]]);
		await seedDay('2026-08-29', [['forma', 2]]);
		await seedDay('2026-08-30', [['forma', 3]]);

		expect(await foldFor('forma', { daysPerTick: 2 })).toMatchObject({ status: 'folded', dates: 2 });
		expect(Object.keys((await readJson(bucketKey(priceHistoryBucket('forma'))))!.revisions as object)).toEqual([
			'2026-08-28',
			'2026-08-29',
		]);

		expect(await foldFor('forma', { daysPerTick: 2 })).toMatchObject({ status: 'folded', dates: 1 });
		expect((await seriesOf('forma')).forma).toEqual([
			['2026-08-28', 1, null],
			['2026-08-29', 2, null],
			['2026-08-30', 3, null],
		]);
	});

	it('replaces the entry of a date it folds again and skips unusable medians', async () => {
		const invalid = probeSlug(priceHistoryBucket('forma'), true);
		await seedDay('2026-08-30', [
			['forma', 10, 1],
			[invalid, 0, 5],
			[`${invalid}:rank-v3:r1`, 'x', 5],
		]);
		await foldFor('forma');

		expect(await seriesOf('forma')).toEqual({ forma: [['2026-08-30', 10, 1]] });
		await seedDay('2026-08-30', [['forma', 99, 7]]);
		await foldFor('forma');

		const series = await seriesOf('forma');
		expect(series.forma).toEqual([['2026-08-30', 99, 7]]);
		expect(series[invalid]).toBeUndefined();
		expect(series[`${invalid}:rank-v3:r1`]).toBeUndefined();
	});

	it('keeps at most 400 dates per key, newest first out of the archive', async () => {
		const dates: string[] = [];
		for (let back = 410; back >= 1; back -= 1) {
			const date = new Date(NOW - back * 86_400_000).toISOString().slice(0, 10);
			dates.push(date);
			await env.ITEM_META.put(`archive:prices:${date}`, JSON.stringify({ v: 1, date, rows: [['forma', 400 - (back % 400)]] }));
		}
		await env.ITEM_META.put(INDEX_KEY, JSON.stringify({ v: 1, updatedAt: NOW, entries: dates }));

		for (let pass = 0; pass < 5; pass += 1) await foldFor('forma', { daysPerTick: 90 });

		const entries = (await seriesOf('forma')).forma as Array<[string, number, number | null]>;
		expect(entries).toHaveLength(400);
		expect(entries[0][0]).toBe(dates[10]);
		expect(entries[399][0]).toBe(dates[409]);
	}, 60_000);

	it('refolds volume updates and newly indexed older days without resetting the bucket', async () => {
		await seedDay('2026-08-30', [['forma', 10]]);
		await foldFor('forma');
		await mergeVolumes(
			testEnv(),
			new Map([
				['2026-08-30', new Map([['forma', { median: 10, volume: 7 }]])],
				['2026-08-20', new Map([['forma', { median: 8, volume: 2 }]])],
			]),
			{ now: NOW },
		);
		expect(await foldFor('forma')).toMatchObject({ status: 'folded', dates: 2 });
		expect((await seriesOf('forma')).forma).toEqual([
			['2026-08-20', 8, 2],
			['2026-08-30', 10, 7],
		]);
		expect(await foldFor('forma')).toMatchObject({ status: 'idle', dates: 0 });
	});

	it('retries missing days and waits for the day revision referenced by the index', async () => {
		await recordArchiveEntries(testEnv(), 'prices', ['2026-08-30'], 730, { '2026-08-30': 'new' });
		await foldFor('forma');
		const key = bucketKey(priceHistoryBucket('forma'));
		expect((await readJson(key))?.revisions).toEqual({});
		await env.ITEM_META.put('archive:prices:2026-08-30', JSON.stringify({ rows: [['forma', 9]], revision: 'old' }));
		await foldFor('forma');
		expect((await readJson(key))?.revisions).toEqual({});
		await env.ITEM_META.put('archive:prices:2026-08-30', JSON.stringify({ rows: [['forma', 10]], revision: 'new' }));
		await foldFor('forma');
		expect((await seriesOf('forma')).forma).toEqual([['2026-08-30', 10, null]]);
	});

	it('advances the bucket without writing a document when no date is new', async () => {
		const result = await foldFor('forma');

		expect(result).toMatchObject({ status: 'idle', dates: 0 });
		expect(await env.ITEM_META.get(bucketKey(priceHistoryBucket('forma')))).toBeNull();
		expect(await readJson(STATE_KEY)).toMatchObject({ bucket: (priceHistoryBucket('forma') + 1) % BUCKETS });
	});

	it('rotates unreadable dates instead of letting them consume every batch', async () => {
		await recordArchiveEntries(testEnv(), 'prices', ['2026-08-28', '2026-08-29'], 730);
		await seedDay('2026-08-30', [['forma', 10]]);
		await foldFor('forma', { daysPerTick: 2 });
		expect(await seriesOf('forma')).toEqual({});
		await foldFor('forma', { daysPerTick: 2 });
		expect((await seriesOf('forma')).forma).toEqual([['2026-08-30', 10, null]]);
	});

	it('repairs an index lost after a successful day write when writers retry unchanged rows', async () => {
		await env.ITEM_META.put('archive:prices:2026-09-02', JSON.stringify({ revision: 'live', rows: [['forma', 10]] }));
		expect((await archiveDailyPrices(testEnv(), { now: NOW })).status).toBe('exists');
		await foldFor('forma');
		expect((await seriesOf('forma')).forma).toEqual([['2026-09-02', 10, null]]);
		await env.ITEM_META.put('archive:prices:2026-09-01', JSON.stringify({ revision: 'volume', rows: [['forma', 9, 4]] }));
		await mergeVolumes(testEnv(), new Map([['2026-09-01', new Map([['forma', { median: 9, volume: 4 }]])]]), { now: NOW });
		await foldFor('forma');
		expect((await seriesOf('forma')).forma).toEqual([
			['2026-09-01', 9, 4],
			['2026-09-02', 10, null],
		]);
	});

	it('is a no-op when the archive family is switched off', async () => {
		await seedDay('2026-08-30', [['forma', 10, 1]]);

		expect((await foldPriceHistory(testEnv({ HISTORY_ARCHIVE_ENABLED: '0' }), { now: NOW })).status).toBe('disabled');
		expect(await env.ITEM_META.get(STATE_KEY)).toBeNull();
	});
});

describe('GET /v1/price-history/{slug}', () => {
	it('answers 404 before the bucket has been folded', async () => {
		await clearEdgeCache('forma');
		const response = await get('/v1/price-history/forma');

		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({ ok: false, error: 'price_history_not_ready' });
	});

	it('answers 404 for a slug the folded bucket holds no series for', async () => {
		await seedDay('2026-08-30', [['forma', 10, 1]]);
		await foldFor('forma');
		const missing = probeSlug(priceHistoryBucket('forma'), true);
		await clearEdgeCache(missing);

		const response = await get(`/v1/price-history/${missing}`);

		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({ ok: false, error: 'not_found' });
	});

	it('serves an unranked slug with a null rank and an hour of edge cache', async () => {
		await seedDay('2026-08-30', [['forma', 10, 4]]);
		await seedDay('2026-08-31', [['forma', 11]]);
		await foldFor('forma');
		await clearEdgeCache('forma');

		const response = await get('/v1/price-history/forma');

		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('public, max-age=3600');
		expect(await response.json()).toEqual({
			ok: true,
			slug: 'forma',
			generatedAt: NOW,
			rows: [
				['2026-08-30', null, 10, 4],
				['2026-08-31', null, 11, null],
			],
		});
	});

	it('keeps the bare rank-0 median and volume while preserving other ranked dates', async () => {
		await seedDay('2026-08-30', [
			['primed_flow:rank-v3:r10', 200, 2],
			['primed_flow', 50, 9],
			['primed_flow:rank-v3:r0', 55],
		]);
		await seedDay('2026-08-31', [
			['primed_flow:rank-v3:r0', 51, 3],
			['primed_flow:rank-v3:r10', 210],
		]);
		await foldFor('primed_flow');
		await clearEdgeCache('primed_flow');

		const response = await get('/v1/price-history/primed_flow');

		expect(await response.json()).toMatchObject({
			ok: true,
			slug: 'primed_flow',
			rows: [
				['2026-08-30', 0, 50, 9],
				['2026-08-30', 10, 200, 2],
				['2026-08-31', 0, 51, 3],
				['2026-08-31', 10, 210, null],
			],
		});
	});

	it('answers 304 for a matching ETag', async () => {
		await seedDay('2026-08-30', [['forma', 10, 4]]);
		await foldFor('forma');
		await clearEdgeCache('forma');

		const first = await get('/v1/price-history/forma');
		const etag = first.headers.get('etag') as string;
		const request = new IncomingRequest('http://example.com/v1/price-history/forma', { headers: { 'if-none-match': etag } });
		const ctx = createExecutionContext();
		const second = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(etag).toBeTruthy();
		expect(second.status).toBe(304);
	});

	it('resolves bare-only mod archives from the catalog and retries an unavailable catalog', async () => {
		await seedDay('2026-08-30', [['primed_flow', 50, 9]]);
		await foldFor('primed_flow');
		await clearEdgeCache('primed_flow');
		await env.ITEM_META.delete('order-summary:catalog:v1');
		expect((await get('/v1/price-history/primed_flow')).status).toBe(503);
		await env.ITEM_META.put('order-summary:catalog:v1', JSON.stringify({ entries: [{ slug: 'primed_flow', maxRank: 10 }] }));
		const response = await get('/v1/price-history/primed_flow');
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ rows: [['2026-08-30', 0, 50, 9]] });
	});

	it('answers the shared 404 for a non-tradable slug without reading a bucket', async () => {
		const response = await get('/v1/price-history/vendor_relic');

		expect(response.status).toBe(404);
		expect(response.headers.get('cache-control')).toBe('public, max-age=3600');
		expect(await response.json()).toEqual({ ok: false, error: 'not_found' });
	});
});

describe('price history medians', () => {
	it('takes the daily closed-sale median where the row median is a rolling average', async () => {
		await env.ITEM_META.put(
			'archive:prices:2026-08-30',
			JSON.stringify({
				v: 1,
				date: '2026-08-30',
				source: 'snapshot',
				columns: ['key', 'median', 'volume'],
				priceBasisByKey: { forma: 'rolling-48h', 'forma:rank-v3:r0': 'rolling-48h' },
				dailyMedians: { forma: 15 },
				rows: [
					['forma', 12, 4],
					['forma:rank-v3:r0', 11],
				],
			}),
		);
		await env.ITEM_META.put(INDEX_KEY, JSON.stringify({ v: 1, updatedAt: NOW, entries: ['2026-08-30'] }));

		await foldFor('forma');

		expect(await seriesOf('forma')).toEqual({
			forma: [['2026-08-30', 15, 4]],
		});
	});
});
