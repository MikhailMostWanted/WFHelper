import { nightwaveOfferingOverride } from "./nightwaveShop";
import { toFiniteNumber } from "./numeric";
import { asRecord } from "./objectValidation";

export const NIGHTWAVE_OFFERING_LIMITS = {
  tabs: 12,
  sectionsPerTab: 40,
  itemsPerSection: 120,
  nameLength: 60,
  minCreds: 1,
  maxCreds: 1000,
} as const;

export interface NightwaveOfferingItem {
  name: string;
  always: boolean;
  creds: number | null;
  quantity: number;
}

export interface NightwaveOfferingSection {
  name: string;
  creds: number | null;
  items: NightwaveOfferingItem[];
}

export interface NightwaveOfferingTab {
  name: string;
  sections: NightwaveOfferingSection[];
}

export interface NightwaveOfferingsDoc {
  generatedAt: number;
  tabs: NightwaveOfferingTab[];
}

function parseName(value: unknown): string {
  return typeof value === "string"
    ? value.trim().slice(0, NIGHTWAVE_OFFERING_LIMITS.nameLength)
    : "";
}

export function parseNightwaveOfferingCreds(value: unknown): number | null {
  const creds = toFiniteNumber(value);
  return creds != null &&
    Number.isInteger(creds) &&
    creds >= NIGHTWAVE_OFFERING_LIMITS.minCreds &&
    creds <= NIGHTWAVE_OFFERING_LIMITS.maxCreds
    ? creds
    : null;
}

export function nightwaveOfferingQuantity(name: string, value?: unknown): number {
  const explicit = toFiniteNumber(value);
  if (explicit != null && Number.isSafeInteger(explicit) && explicit > 0) return explicit;
  // Older cached documents kept bundle sizes only in the wiki caption.
  const caption = /^[\d,]+\s*x\s+/i.exec(name);
  const quantity = caption ? Number(caption[0].replace(/[,x\s]/gi, "")) : null;
  return quantity != null && Number.isSafeInteger(quantity) && quantity > 0
    ? quantity
    : (nightwaveOfferingOverride(name)?.quantity ?? 1);
}

function parseItems(value: unknown): NightwaveOfferingItem[] {
  if (!Array.isArray(value)) return [];
  const items: NightwaveOfferingItem[] = [];
  for (const valueRow of value.slice(0, NIGHTWAVE_OFFERING_LIMITS.itemsPerSection)) {
    const row = asRecord(valueRow);
    if (!row) continue;
    const name = parseName(row.name);
    if (!name) continue;
    items.push({
      name,
      always: row.always === true,
      creds: parseNightwaveOfferingCreds(row.creds),
      quantity: nightwaveOfferingQuantity(name, row.quantity),
    });
  }
  return items;
}

function parseSections(value: unknown): NightwaveOfferingSection[] {
  if (!Array.isArray(value)) return [];
  const sections: NightwaveOfferingSection[] = [];
  for (const valueRow of value.slice(0, NIGHTWAVE_OFFERING_LIMITS.sectionsPerTab)) {
    const row = asRecord(valueRow);
    if (!row) continue;
    const name = parseName(row.name);
    const items = parseItems(row.items);
    if (name && items.length > 0)
      sections.push({ name, creds: parseNightwaveOfferingCreds(row.creds), items });
  }
  return sections;
}

export function parseNightwaveOfferingsDoc(value: unknown): NightwaveOfferingsDoc | null {
  const doc = asRecord(value);
  if (!doc) return null;
  const generatedAt = toFiniteNumber(doc.generatedAt);
  if (generatedAt == null || generatedAt <= 0 || !Array.isArray(doc.tabs)) return null;
  const tabs: NightwaveOfferingTab[] = [];
  for (const valueRow of doc.tabs.slice(0, NIGHTWAVE_OFFERING_LIMITS.tabs)) {
    const row = asRecord(valueRow);
    if (!row) continue;
    const name = parseName(row.name);
    const sections = parseSections(row.sections);
    if (name && sections.length > 0) tabs.push({ name, sections });
  }
  return tabs.length > 0 ? { generatedAt: Math.floor(generatedAt), tabs } : null;
}
