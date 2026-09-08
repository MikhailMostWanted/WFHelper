import { FEEDBACK_LIMITS, normalizeFeedback } from '../../../../config/shared/feedback';
import type { FeedbackReport, FeedbackResult } from '../../../../config/shared/feedback';
import { withAbortTimeout } from '../../../../config/shared/fetchWithTimeout';
import { jsonResponse } from '../security/cors';
import { logEvent } from '../services/logging';
import type { Env } from '../types';
import { clientIp } from '../utils';

function webhookUrl(value: string | undefined): URL | null {
	if (!value || !/^https:\/\/discord\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/.test(value)) return null;
	const url = new URL(value);
	url.searchParams.set('wait', 'true');
	return url;
}

async function readJson(body: ReadableStream<Uint8Array> | null, limit: number, signal: AbortSignal): Promise<unknown> {
	if (!body) throw new Error('missing_body');
	const reader = body.getReader();
	const cancel = (): void => {
		void reader.cancel().catch(() => undefined);
	};
	signal.addEventListener('abort', cancel, { once: true });
	try {
		const chunks: Uint8Array[] = [];
		let size = 0;
		while (true) {
			signal.throwIfAborted();
			const { done, value } = await reader.read();
			signal.throwIfAborted();
			if (done) break;
			size += value.byteLength;
			if (size > limit) {
				cancel();
				throw new Error('body_too_large');
			}
			chunks.push(value);
		}
		const bytes = new Uint8Array(size);
		let offset = 0;
		for (const chunk of chunks) {
			bytes.set(chunk, offset);
			offset += chunk.byteLength;
		}
		return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes));
	} finally {
		signal.removeEventListener('abort', cancel);
		reader.releaseLock();
	}
}

function discordBody(report: FeedbackReport, forum: boolean): { body: BodyInit; headers?: Record<string, string> } {
	const fields = [
		{ name: 'App version', value: report.appVersion, inline: true },
		{ name: 'Platform', value: report.platform, inline: true },
	];
	if (report.contact) fields.push({ name: 'Contact', value: report.contact, inline: false });
	if (report.diagnostics) {
		const details = report.diagnostics;
		fields.push({
			name: 'Diagnostics',
			value: `OS: ${details.osVersion}\nArchitecture: ${details.arch}\nLanguage: ${details.locale}\nView: ${details.view}\nUI scale: ${details.uiScale}`,
			inline: false,
		});
	}
	const files: { filename: string; blob: Blob }[] = [];
	if (report.screenshot) {
		const binary = atob(report.screenshot.data);
		const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
		files.push({
			filename: `screenshot.${report.screenshot.mediaType.split('/')[1]}`,
			blob: new Blob([bytes], { type: report.screenshot.mediaType }),
		});
	}
	if (report.diagnostics?.log) {
		files.push({ filename: 'main.log', blob: new Blob([report.diagnostics.log], { type: 'text/plain' }) });
	}
	const imageName = report.screenshot ? files[0].filename : null;
	const payload = {
		allowed_mentions: { parse: [] },
		// A forum channel webhook only accepts posts that open a thread; text channels reject the field.
		...(forum ? { thread_name: `${report.kind === 'bug' ? 'Bug' : 'Feature'}: ${report.title}`.slice(0, 100) } : {}),
		embeds: [
			{
				author: { name: report.kind === 'bug' ? 'Bug report' : 'Feature request' },
				title: report.title,
				description: report.description,
				fields,
				...(imageName ? { image: { url: `attachment://${imageName}` } } : {}),
			},
		],
		...(files.length ? { attachments: files.map((file, id) => ({ id, filename: file.filename })) } : {}),
	};
	if (files.length === 0) return { body: JSON.stringify(payload), headers: { 'content-type': 'application/json' } };
	const body = new FormData();
	body.set('payload_json', JSON.stringify(payload));
	files.forEach((file, index) => body.set(`files[${index}]`, file.blob, file.filename));
	return { body };
}

export async function handleFeedbackRoute(req: Request, env: Env): Promise<Response> {
	const reply = (result: FeedbackResult, status = 200): Response =>
		jsonResponse(result, req, env, status, status === 429 ? { 'retry-after': '60' } : undefined);
	const url = webhookUrl(env.FEEDBACK_DISCORD_WEBHOOK_URL);
	if (!url || !env.FEEDBACK_RATE_LIMITER || !env.FEEDBACK_GLOBAL_LIMITER) return reply({ ok: false, error: 'unavailable' }, 503);
	try {
		const result = await env.FEEDBACK_RATE_LIMITER.limit({ key: clientIp(req) });
		if (!result.success) return reply({ ok: false, error: 'rate_limited' }, 429);
		// One ceiling for every sender: per-IP limits do not bound thread creation in the forum.
		const global = await env.FEEDBACK_GLOBAL_LIMITER.limit({ key: 'global' });
		if (!global.success) return reply({ ok: false, error: 'rate_limited' }, 429);
	} catch {
		return reply({ ok: false, error: 'unavailable' }, 503);
	}
	let report: FeedbackReport | null;
	try {
		if (req.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
			return reply({ ok: false, error: 'invalid' }, 400);
		}
		report = normalizeFeedback(await withAbortTimeout(10000, (signal) => readJson(req.body, FEEDBACK_LIMITS.requestBytes, signal)));
	} catch {
		return reply({ ok: false, error: 'invalid' }, 400);
	}
	if (!report) return reply({ ok: false, error: 'invalid' }, 400);
	try {
		return await withAbortTimeout(15000, async (signal) => {
			const response = await fetch(url, {
				method: 'POST',
				...discordBody(report, env.FEEDBACK_DISCORD_FORUM === '1'),
				signal,
				// workerd has no redirect: 'error'; a redirect surfaces as a non-ok status below instead.
				redirect: 'manual',
			});
			if (!response.ok) {
				// Discord's numeric error code names the cause (220001 = forum post without a thread) without the report.
				let code = 'rejected';
				try {
					const detail = await readJson(response.body, 4096, signal);
					if (detail && typeof detail === 'object' && 'code' in detail && typeof detail.code === 'number') code = String(detail.code);
				} catch {
					await response.body?.cancel().catch(() => undefined);
				}
				logEvent({ type: 'error', route: '/v1/feedback', status: response.status, error: `discord_${code}` });
				return response.status === 429 ? reply({ ok: false, error: 'rate_limited' }, 429) : reply({ ok: false, error: 'failed' }, 502);
			}
			const receipt = await readJson(response.body, 65536, signal);
			if (!receipt || typeof receipt !== 'object' || !('id' in receipt) || typeof receipt.id !== 'string' || !/^\d+$/.test(receipt.id)) {
				return reply({ ok: false, error: 'failed' }, 502);
			}
			return reply({ ok: true });
		});
	} catch (error) {
		// The class alone: a fetch error message can carry the webhook URL.
		logEvent({ type: 'error', route: '/v1/feedback', status: 502, error: `discord_${error instanceof Error ? error.name : 'throw'}` });
		return reply({ ok: false, error: 'failed' }, 502);
	}
}
