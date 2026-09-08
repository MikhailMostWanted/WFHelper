import { NIGHTWAVE_OFFERINGS_DOC_KEY } from '../constants';
import { logEvent } from './logging';
import type { Env } from '../types';
import { getJsonFromKv } from '../utils';
import { withAbortTimeout } from '../../../../config/shared/fetchWithTimeout';
import {
	NIGHTWAVE_OFFERING_LIMITS,
	nightwaveOfferingQuantity,
	parseNightwaveOfferingCreds,
	parseNightwaveOfferingsDoc,
	type NightwaveOfferingItem as OfferingItem,
	type NightwaveOfferingSection as OfferingSection,
	type NightwaveOfferingTab as OfferingTab,
	type NightwaveOfferingsDoc,
} from '../../../../config/shared/nightwaveOfferings';
import { toFiniteNumber } from '../../../../config/shared/numeric';

// DE has no current rotating-stock feed; the wiki lists the offering pool.
const OFFERINGS_PAGE_URL = 'https://wiki.warframe.com/w/Nightwave/Offerings?action=raw';
// A spoofed browser user agent is answered with a 403 challenge page; this one passes.
const WIKI_USER_AGENT = 'WFHelper-worker/1.0 (+https://wfhelper.com)';
const FETCH_TIMEOUT_MS = 10_000;
const MAX_PAGE_CHARS = 2 * 1024 * 1024;
const REBUILD_INTERVAL_MS = 60 * 60 * 1000;
const DOC_TTL_SEC = 30 * 24 * 60 * 60;
const {
	tabs: MAX_TABS,
	sectionsPerTab: MAX_SECTIONS_PER_TAB,
	itemsPerSection: MAX_ITEMS_PER_SECTION,
	nameLength: MAX_NAME_LENGTH,
} = NIGHTWAVE_OFFERING_LIMITS;
// The store carries roughly 270 items across eight tabs; well under either floor
// means the page changed shape and the stored copy is the better answer.
const MIN_TABS = 8;
const MIN_ITEMS = 150;

type WikiOfferingsDoc = NightwaveOfferingsDoc & { source: 'wiki' };

/** Unwraps the caption markup: `{{M|X}}`, `[[Page|X]]` and `[[Page#Anchor]]` all name items. */
function cleanText(value: string): string {
	return value
		.replace(/\{\{\s*Nc\s*\|[^}]*\}\}/gi, ' ')
		.replace(/\{\{\s*[^{}|]*\|\s*([^{}|]*?)\s*(?:\|[^{}]*)?\}\}/g, '$1')
		.replace(/\{\{[^{}]*\}\}/g, ' ')
		.replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1')
		.replace(/\[\[([^\]|]*)\]\]/g, (_match, target: string) => target.split('#')[0].replace(/_/g, ' '))
		.replace(/'{2,}/g, '')
		.replace(/<[^>]*>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function credsIn(value: string): number | null {
	const match = /\{\{\s*Nc\s*\|\s*([\d,]+)\s*\}\}/i.exec(value);
	return parseNightwaveOfferingCreds(match ? match[1].replace(/,/g, '') : null);
}

/** `File.png |link=Page |caption`; the link parameter is optional and never holds a pipe. */
function galleryCaption(line: string): string | null {
	const pipe = line.indexOf('|');
	if (pipe < 0) return null;
	const rest = line.slice(pipe + 1);
	const link = /^\s*link\s*=\s*[^|]*\|/i.exec(rest);
	const caption = (link ? rest.slice(link[0].length) : rest).trim();
	return caption || null;
}

function isAlwaysHeading(name: string): boolean {
	return /always available/i.test(name);
}

function itemFromCaption(caption: string): OfferingItem | null {
	const creds = credsIn(caption);
	// The wiki bolds the offerings that never rotate out of the store.
	const always = caption.includes("'''");
	const name = cleanText(caption.replace(/<br\s*\/?>[\s\S]*$/i, ' ')).slice(0, MAX_NAME_LENGTH);
	return name ? { name, always, creds, quantity: nightwaveOfferingQuantity(name) } : null;
}

/** `=== Auras ({{Nc|20}} each) ===` prices the whole section; the parenthetical is not part of its name. */
function sectionFromHeading(title: string): OfferingSection {
	const creds = credsIn(title);
	const name = cleanText(title.replace(/\(\s*\{\{\s*Nc\s*\|[^}]*\}\}[^)]*\)/gi, ' ')).slice(0, MAX_NAME_LENGTH);
	return { name, creds, items: [] };
}

export function parseNightwaveOfferings(wikitext: string, now = 0): WikiOfferingsDoc | null {
	const tabs: OfferingTab[] = [];
	let tab: OfferingTab | null = null;
	let section: OfferingSection | null = null;
	let seen = new Set<string>();
	let inGallery = false;
	let alwaysHeading = false;
	let total = 0;

	for (const rawLine of wikitext.split(/\r?\n/)) {
		const line = rawLine.trim();

		const tabHeader = /^\|-\|(.+?)=$/.exec(line);
		if (tabHeader) {
			const name = cleanText(tabHeader[1]).slice(0, MAX_NAME_LENGTH);
			tab = name && tabs.length < MAX_TABS ? { name, sections: [] } : null;
			if (tab) tabs.push(tab);
			section = null;
			seen = new Set();
			inGallery = false;
			alwaysHeading = isAlwaysHeading(name);
			continue;
		}
		if (!tab) continue;

		if (/^<\/gallery/i.test(line)) {
			inGallery = false;
			continue;
		}
		if (/^<gallery/i.test(line)) {
			inGallery = true;
			continue;
		}
		if (!inGallery) {
			const heading = /^={2,4}(.+?)={2,4}$/.exec(line);
			if (!heading) continue;
			const next = sectionFromHeading(heading[1]);
			section = next.name && tab.sections.length < MAX_SECTIONS_PER_TAB ? next : null;
			if (section) tab.sections.push(section);
			alwaysHeading = isAlwaysHeading(tab.name) || isAlwaysHeading(next.name);
			continue;
		}

		if (!section || section.items.length >= MAX_ITEMS_PER_SECTION) continue;
		const caption = galleryCaption(line);
		const item = caption ? itemFromCaption(caption) : null;
		if (!item) continue;
		// The recovered-artifacts tab says "always available" in its heading instead of
		// bolding each of its rows.
		if (alwaysHeading) item.always = true;
		// The always-available tab repeats offers listed under their own category.
		const key = item.name.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		section.items.push({ ...item, creds: item.creds ?? section.creds });
		total += 1;
	}

	const kept = tabs.filter((entry) => entry.sections.some((part) => part.items.length > 0));
	if (kept.length < MIN_TABS || total < MIN_ITEMS) return null;
	return { generatedAt: now, source: 'wiki', tabs: kept };
}

async function fetchOfferingsPage(): Promise<string | null> {
	try {
		return await withAbortTimeout(FETCH_TIMEOUT_MS, async (signal) => {
			const response = await fetch(OFFERINGS_PAGE_URL, {
				headers: { 'user-agent': WIKI_USER_AGENT, accept: 'text/plain' },
				signal,
			});
			if (!response.ok) return null;
			const declared = toFiniteNumber(response.headers.get('content-length'));
			if (declared != null && declared > MAX_PAGE_CHARS) return null;
			const text = await response.text();
			return text.length > MAX_PAGE_CHARS ? null : text;
		});
	} catch {
		return null;
	}
}

// Keep the last complete document if the wiki fetch or parser fails.
export async function refreshNightwaveOfferings(
	env: Env,
	options: { now?: number; force?: boolean } = {},
): Promise<'built' | 'skipped' | 'failed'> {
	const now = options.now ?? Date.now();
	if (!options.force) {
		const existing = await getJsonFromKv(env.ITEM_META, NIGHTWAVE_OFFERINGS_DOC_KEY);
		const generatedAt = toFiniteNumber(existing?.generatedAt) ?? 0;
		if (now - generatedAt < REBUILD_INTERVAL_MS && generatedAt <= now) return 'skipped';
	}

	const page = await fetchOfferingsPage();
	const doc = page ? parseNightwaveOfferings(page, now) : null;
	if (!doc) {
		logEvent({
			type: 'cron',
			route: 'nightwave-offerings:refresh',
			status: 204,
			error: page ? 'wiki_unparsed' : 'wiki_unavailable',
		});
		return 'failed';
	}

	const body = JSON.stringify(doc);
	await env.ITEM_META.put(NIGHTWAVE_OFFERINGS_DOC_KEY, body, { expirationTtl: DOC_TTL_SEC });
	logEvent({
		type: 'cron',
		route: 'nightwave-offerings:refresh',
		status: 200,
		count: doc.tabs.reduce((sum, tab) => sum + tab.sections.reduce((rows, section) => rows + section.items.length, 0), 0),
		bytes: body.length,
	});
	return 'built';
}

export async function readNightwaveOfferingsDoc(env: Env): Promise<WikiOfferingsDoc | null> {
	const stored = await getJsonFromKv(env.ITEM_META, NIGHTWAVE_OFFERINGS_DOC_KEY);
	const doc = parseNightwaveOfferingsDoc(stored);
	if (!doc) return null;
	const { tabs } = doc;
	const total = tabs.reduce((sum, tab) => sum + tab.sections.reduce((rows, section) => rows + section.items.length, 0), 0);
	if (tabs.length < MIN_TABS || total < MIN_ITEMS) return null;
	return { ...doc, source: 'wiki' };
}
