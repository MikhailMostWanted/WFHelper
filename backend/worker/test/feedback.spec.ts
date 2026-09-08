import { createExecutionContext, env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import type { Env } from '../src/types';
import { resetDailyBudgetTripStateForTest } from '../src/security/dailyBudget';
import { FEEDBACK_LIMITS } from '../../../config/shared/feedback';

const webhook = 'https://discord.com/api/webhooks/123456/test-token';
const report = {
	kind: 'bug',
	title: 'Cannot open panel',
	description: '@everyone panel stays closed',
	appVersion: '2.0.0',
	platform: 'win32',
};
let target: Env;
let upstream: ReturnType<typeof vi.spyOn<typeof globalThis, 'fetch'>>;
let logs: ReturnType<typeof vi.spyOn<typeof console, 'log'>>;

function request(body: BodyInit = JSON.stringify(report), headers: Record<string, string> = {}): Request {
	return new Request('https://example.com/v1/feedback', {
		method: 'POST',
		body,
		headers: { 'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.1', ...headers },
	});
}

const send = (req = request()): Promise<Response> => worker.fetch(req, target, createExecutionContext());

beforeEach(() => {
	resetDailyBudgetTripStateForTest();
	target = {
		...env,
		DAILY_BUDGET_ENABLED: '0',
		PUBLIC_RATE_LIMIT_ENABLED: '0',
		PUBLIC_BOOTSTRAP_REQUIRED: '1',
		FEEDBACK_DISCORD_WEBHOOK_URL: webhook,
		FEEDBACK_RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) } as unknown as RateLimit,
		FEEDBACK_GLOBAL_LIMITER: { limit: vi.fn(async () => ({ success: true })) } as unknown as RateLimit,
	};
	upstream = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ id: '123456789' }));
	logs = vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => vi.restoreAllMocks());

describe('private Discord feedback', () => {
	it('delivers without bootstrap, disables mentions and confirms the message receipt', async () => {
		const response = await send();
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(target.FEEDBACK_RATE_LIMITER?.limit).toHaveBeenCalledWith({ key: '192.0.2.1' });
		const [url, options] = upstream.mock.calls[0];
		expect(String(url)).toBe(`${webhook}?wait=true`);
		expect(options).toMatchObject({ method: 'POST', redirect: 'manual', signal: expect.any(AbortSignal) });
		// The runtime rejects unsupported RequestInit values that a mocked fetch would never see.
		expect(() => new Request(String(url), options)).not.toThrow();
		expect(JSON.parse(String(options?.body))).toMatchObject({
			allowed_mentions: { parse: [] },
			embeds: [{ author: { name: 'Bug report' }, title: report.title }],
		});
		expect(JSON.stringify(logs.mock.calls)).not.toContain(report.title);
	});

	it('attaches only normalized image bytes with a controlled filename and bounded embed', async () => {
		const rich = {
			...report,
			kind: 'feature',
			title: 'x'.repeat(120),
			description: 'd'.repeat(4000),
			contact: 'c'.repeat(120),
			diagnostics: { osVersion: 'o'.repeat(128), arch: 'a'.repeat(32), locale: 'l'.repeat(32), view: 'v'.repeat(64), uiScale: 4 },
			screenshot: { mediaType: 'image/png', data: btoa('\x89PNG\r\n\x1a\nfixture') },
			privateToken: 'must be stripped',
		};
		expect((await send(request(JSON.stringify(rich)))).status).toBe(200);
		const body = upstream.mock.calls[0][1]?.body as FormData;
		const payload = JSON.parse(String(body.get('payload_json')));
		expect(payload.embeds[0].author.name).toBe('Feature request');
		expect(payload.embeds[0].image.url).toBe('attachment://screenshot.png');
		expect(JSON.stringify(payload)).not.toContain('must be stripped');
		expect(JSON.stringify(payload).length).toBeLessThan(6000);
		const image = body.get('files[0]') as File;
		expect(image.name).toBe('screenshot.png');
		expect(image.type).toBe('image/png');
		expect(image.size).toBe(15);
	});

	it('attaches the log tail as a plain-text file after the screenshot', async () => {
		const log = 'line 1\nline 2 with `code` and <tags>\n';
		const withBoth = {
			...report,
			diagnostics: { osVersion: 'o', arch: 'a', locale: 'l', view: 'v', uiScale: 1, log },
			screenshot: { mediaType: 'image/png', data: btoa('\x89PNG\r\n\x1a\nfixture') },
		};
		expect((await send(request(JSON.stringify(withBoth)))).status).toBe(200);
		let body = upstream.mock.calls[0][1]?.body as FormData;
		let payload = JSON.parse(String(body.get('payload_json')));
		expect(payload.attachments).toEqual([
			{ id: 0, filename: 'screenshot.png' },
			{ id: 1, filename: 'main.log' },
		]);
		expect(payload.embeds[0].image.url).toBe('attachment://screenshot.png');
		expect(JSON.stringify(payload)).not.toContain('line 2');
		let file = body.get('files[1]') as File;
		expect([file.name, file.type, await file.text()]).toEqual(['main.log', 'text/plain', log]);

		upstream.mockClear();
		const { screenshot: _screenshot, ...logOnly } = withBoth;
		expect((await send(request(JSON.stringify(logOnly)))).status).toBe(200);
		body = upstream.mock.calls[0][1]?.body as FormData;
		payload = JSON.parse(String(body.get('payload_json')));
		expect(payload.attachments).toEqual([{ id: 0, filename: 'main.log' }]);
		expect(payload.embeds[0]).not.toHaveProperty('image');
		file = body.get('files[0]') as File;
		expect(file.name).toBe('main.log');
		expect(body.get('files[1]')).toBeNull();

		const oversized = { ...logOnly, diagnostics: { ...logOnly.diagnostics, log: 'x'.repeat(FEEDBACK_LIMITS.logChars + 1) } };
		expect((await send(request(JSON.stringify(oversized)))).status).toBe(400);
	});

	it('logs the Discord error code of a rejected post without its message', async () => {
		upstream.mockResolvedValueOnce(
			Response.json({ code: 220001, message: 'Webhooks posted to forum channels must have a thread_name or thread_id' }, { status: 400 }),
		);
		const response = await send();
		expect(response.status).toBe(502);
		expect(await response.json()).toEqual({ ok: false, error: 'failed' });
		const logged = JSON.stringify(logs.mock.calls);
		expect(logged).toContain('discord_220001');
		expect(logged).not.toContain('thread_name');
	});

	it('opens a forum thread per report only when FEEDBACK_DISCORD_FORUM is set', async () => {
		const long = { ...report, title: 't'.repeat(120) };
		// The test env inherits the production var, so start from a text-channel setup.
		delete target.FEEDBACK_DISCORD_FORUM;
		expect((await send(request(JSON.stringify(long)))).status).toBe(200);
		expect(JSON.parse(String(upstream.mock.calls[0][1]?.body))).not.toHaveProperty('thread_name');
		upstream.mockClear();
		target.FEEDBACK_DISCORD_FORUM = '1';
		expect((await send(request(JSON.stringify(long)))).status).toBe(200);
		const payload = JSON.parse(String(upstream.mock.calls[0][1]?.body));
		expect(payload.thread_name).toBe(`Bug: ${'t'.repeat(95)}`);
		expect(payload.thread_name).toHaveLength(100);
	});

	it.each([
		undefined,
		'http://discord.com/api/webhooks/123/token',
		`${webhook}?thread_id=123`,
		`${webhook}#x`,
		'https://discord.com.evil.test/api/webhooks/123/token',
		'https://discord.com/api/webhooks/123/token/messages/1',
		'https://user@discord.com/api/webhooks/123/token',
	])('rejects unavailable or unsafe webhook configuration %s', async (url) => {
		target.FEEDBACK_DISCORD_WEBHOOK_URL = url;
		const response = await send();
		expect(response.status).toBe(503);
		expect(await response.json()).toEqual({ ok: false, error: 'unavailable' });
		expect(upstream).not.toHaveBeenCalled();
	});

	it('fails closed if its limiter is missing or throws even with public limits disabled', async () => {
		delete target.FEEDBACK_RATE_LIMITER;
		expect((await send()).status).toBe(503);
		target.FEEDBACK_RATE_LIMITER = { limit: vi.fn().mockRejectedValue(new Error('secret details')) } as unknown as RateLimit;
		expect((await send()).status).toBe(503);
		target.FEEDBACK_RATE_LIMITER = { limit: vi.fn(async () => ({ success: true })) } as unknown as RateLimit;
		delete target.FEEDBACK_GLOBAL_LIMITER;
		expect((await send()).status).toBe(503);
		target.FEEDBACK_GLOBAL_LIMITER = { limit: vi.fn().mockRejectedValue(new Error('secret details')) } as unknown as RateLimit;
		expect((await send()).status).toBe(503);
		expect(upstream).not.toHaveBeenCalled();
	});

	it('caps every sender together once the global limiter is exhausted', async () => {
		target.FEEDBACK_GLOBAL_LIMITER = { limit: vi.fn(async () => ({ success: false })) } as unknown as RateLimit;
		const response = await send();
		expect(response.status).toBe(429);
		expect(response.headers.get('retry-after')).toBe('60');
		expect(target.FEEDBACK_GLOBAL_LIMITER.limit).toHaveBeenCalledWith({ key: 'global' });
		expect(upstream).not.toHaveBeenCalled();
	});

	it('rejects the third report and ignores spoofed forwarding headers', async () => {
		let count = 0;
		target.FEEDBACK_RATE_LIMITER = { limit: vi.fn(async () => ({ success: ++count <= 2 })) } as unknown as RateLimit;
		expect((await send()).status).toBe(200);
		expect((await send()).status).toBe(200);
		const response = await send(request(JSON.stringify(report), { 'x-forwarded-for': '203.0.113.2' }));
		expect(response.status).toBe(429);
		expect(response.headers.get('retry-after')).toBe('60');
		expect(upstream).toHaveBeenCalledTimes(2);
		expect(target.FEEDBACK_RATE_LIMITER.limit).toHaveBeenLastCalledWith({ key: '192.0.2.1' });
	});

	it('rejects malformed JSON, invalid fields, wrong media type and mismatched image signatures', async () => {
		for (const body of [
			'{',
			'{}',
			JSON.stringify({ ...report, title: '' }),
			JSON.stringify({ ...report, screenshot: { mediaType: 'image/png', data: btoa('not png') } }),
		]) {
			expect((await send(request(body))).status).toBe(400);
		}
		expect((await send(request(JSON.stringify(report), { 'content-type': 'text/plain' }))).status).toBe(400);
		expect(upstream).not.toHaveBeenCalled();
	});

	it('caps streamed bytes without trusting Content-Length and cancels oversized bodies', async () => {
		const cancel = vi.fn();
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new Uint8Array(FEEDBACK_LIMITS.requestBytes));
				controller.enqueue(new Uint8Array(1));
			},
			cancel,
		});
		expect((await send(request(body, { 'content-length': '2' }))).status).toBe(400);
		expect(cancel).toHaveBeenCalled();
		expect(upstream).not.toHaveBeenCalled();
	});

	it('preserves global CORS and daily budget rejection', async () => {
		expect((await send(request(JSON.stringify(report), { origin: 'https://untrusted.example' }))).status).toBe(403);
		target.DAILY_BUDGET_ENABLED = '1';
		target.DAILY_BUDGET_SAMPLE_RATE = '1';
		target.DAILY_BUDGET_MAX_REQUESTS = '1';
		target.DAILY_BUDGET = {
			getByName: () => ({ fetch: async () => Response.json({ ok: true, exceeded: true }) }),
		} as unknown as DurableObjectNamespace;
		expect((await send()).status).toBe(503);
		expect(upstream).not.toHaveBeenCalled();
	});

	it.each([429, 400, 500])('maps Discord %s without exposing the response or retrying', async (status) => {
		upstream.mockResolvedValue(new Response('private upstream details', { status }));
		const response = await send();
		expect(response.status).toBe(status === 429 ? 429 : 502);
		expect(await response.json()).toEqual({ ok: false, error: status === 429 ? 'rate_limited' : 'failed' });
		expect(upstream).toHaveBeenCalledTimes(1);
	});

	it('refuses success without a confirmed message ID and contains fetch errors', async () => {
		upstream.mockResolvedValue(Response.json({}));
		expect((await send()).status).toBe(502);
		upstream.mockRejectedValue(new Error(webhook));
		expect(await (await send()).json()).toEqual({ ok: false, error: 'failed' });
		expect(JSON.stringify(logs.mock.calls)).not.toContain(webhook);
	});
});
