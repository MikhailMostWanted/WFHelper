// A plat bound the user typed applies to both selling lists, so the rule for a
// row whose price is not known yet lives in one place: it drops out of the list
// instead of quietly passing a filter it was never measured against.

export interface PlatRange {
  min: number | null;
  max: number | null;
}

export const NO_PLAT_RANGE: PlatRange = { min: null, max: null };

export function platRangeActive(range: PlatRange): boolean {
  return range.min !== null || range.max !== null;
}

/** An unknown price passes only while neither bound is set. */
export function withinPlatRange(price: number | null | undefined, range: PlatRange): boolean {
  if (price == null) return !platRangeActive(range);
  if (range.min !== null && price < range.min) return false;
  if (range.max !== null && price > range.max) return false;
  return true;
}
