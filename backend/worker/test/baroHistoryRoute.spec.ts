import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { BARO_HISTORY_KEY } from '../../../config/shared/baroHistory';
import type { Env } from '../src/types';

const origin = 'https://baro-route.example.com';
const cacheKey = new Request(`${origin}/v1/baro-history?v=2`);

beforeEach(async () => {
	await caches.default.delete(cacheKey);
	await env.ITEM_META.delete(BARO_HISTORY_KEY);
	await env.ITEM_META.delete('archive:index:baro:v1');
});

async function request(overrides: Partial<Env> = {}, headers: Record<string, string> = {}) {
	const ctx = createExecutionContext();
	const response = await worker.fetch(
		new Request(`${origin}/v1/baro-history`, { headers }),
		{
			...env,
			PUBLIC_BOOTSTRAP_REQUIRED: '1',
			DAILY_BUDGET_ENABLED: '0',
			PUBLIC_RATE_LIMIT_ENABLED: '0',
			...overrides,
		},
		ctx,
	);
	await waitOnExecutionContext(ctx);
	return response;
}

describe('Baro history route', () => {
	it('returns empty materialized coverage and does not require bootstrap', async () => {
		await env.ITEM_META.put(
			BARO_HISTORY_KEY,
			JSON.stringify({ version: 1, updatedAt: Date.now(), coverageStart: null, visits: [], lastSeen: [] }),
		);
		const response = await request();
		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('public, max-age=300');
		expect(await response.json()).toMatchObject({ ok: true, data: { coverageStart: null, visits: [], lastSeen: [] } });
	});
	it('serves validated recorded dates from the shared cache', async () => {
		const data = {
			version: 1,
			updatedAt: Date.now(),
			coverageStart: 1700000000000,
			visits: [],
			lastSeen: [{ uniqueName: '/Lotus/Fixture/Item', ducats: 100, credits: 2000, visitId: 'visit1', lastSeen: 1700000000000 }],
		};
		await env.ITEM_META.put(BARO_HISTORY_KEY, JSON.stringify(data));
		const first = await request();
		expect(first.status).toBe(200);
		expect(await first.json()).toEqual({ ok: true, data });
		await env.ITEM_META.put(BARO_HISTORY_KEY, 'broken');
		expect((await request()).status).toBe(200);
	});
	it('rejects invalid durable data without caching a false empty result', async () => {
		await env.ITEM_META.put(BARO_HISTORY_KEY, 'broken');
		expect((await request()).status).toBe(503);
		expect(await caches.default.match(cacheKey)).toBeUndefined();
	});
	it('applies CORS and rate limits before serving cached history', async () => {
		await env.ITEM_META.put(
			BARO_HISTORY_KEY,
			JSON.stringify({ version: 1, updatedAt: Date.now(), coverageStart: null, visits: [], lastSeen: [] }),
		);
		expect((await request()).status).toBe(200);
		expect((await request({}, { Origin: 'https://untrusted.example' })).status).toBe(403);
		const limiter = { limit: async () => ({ success: false }) } as unknown as RateLimit;
		const get = vi.fn();
		expect(
			(await request({ PUBLIC_RATE_LIMIT_ENABLED: '1', PUBLIC_API_RATE_LIMITER: limiter, ITEM_META: { get } as unknown as KVNamespace }))
				.status,
		).toBe(429);
		expect(get).not.toHaveBeenCalled();
	});
});

afterEach(() => vi.restoreAllMocks());

describe('Baro route failure boundaries', () => {
	it('uses one KV read on a cold request and never reconstructs legacy archives', async () => {
		const get = vi.fn(async () => null);
		const response = await request({ ITEM_META: { get } as unknown as KVNamespace });
		expect(response.status).toBe(503);
		expect(get.mock.calls).toEqual([[BARO_HISTORY_KEY]]);
	});
	it('contains KV and Cache API failures', async () => {
		vi.spyOn(caches.default, 'match').mockRejectedValue(new Error('cache down'));
		const response = await request({
			ITEM_META: {
				get: async () => {
					throw new Error('KV down');
				},
			} as unknown as KVNamespace,
		});
		expect(response.status).toBe(503);
		expect(await response.json()).toEqual({ ok: false, error: 'baro_history_unavailable' });
	});
	it('serves valid KV data when edge cache writes fail', async () => {
		await env.ITEM_META.put(
			BARO_HISTORY_KEY,
			JSON.stringify({ version: 1, updatedAt: Date.now(), coverageStart: null, visits: [], lastSeen: [] }),
		);
		vi.spyOn(caches.default, 'put').mockRejectedValue(new Error('cache write unavailable'));
		expect((await request()).status).toBe(200);
	});
	it('returns 304 for both cold and cached matching ETags', async () => {
		await env.ITEM_META.put(
			BARO_HISTORY_KEY,
			JSON.stringify({ version: 1, updatedAt: Date.now(), coverageStart: null, visits: [], lastSeen: [] }),
		);
		const first = await request();
		const etag = first.headers.get('etag');
		expect(etag).toBeTruthy();
		expect((await request({}, { 'if-none-match': etag! })).status).toBe(304);
		await caches.default.delete(cacheKey);
		expect((await request({}, { 'if-none-match': etag! })).status).toBe(304);
	});
});
