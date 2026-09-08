import { toFiniteNumber } from "../config/shared/numeric";
import { toNonEmptyString } from "../config/shared/stringValidation";
import { asRecord } from "../config/shared/objectValidation";

export function isObject(value: unknown): value is Record<string, unknown> {
  return asRecord(value) !== null;
}

function boundedNumber(value: unknown, min: number, max: number): number | null {
  const parsed = toFiniteNumber(value);
  if (parsed == null || parsed < min || parsed > max) return null;
  return parsed;
}

export function boundedInt(value: unknown, min: number, max: number): number | null {
  const parsed = boundedNumber(value, min, max);
  if (parsed == null) return null;
  return Math.round(parsed);
}

export function stringArray(value: unknown, maxItems = 100, maxStringLength = 200): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => toNonEmptyString(entry, maxStringLength))
    .filter((entry): entry is string => Boolean(entry))
    .slice(0, maxItems);
}
