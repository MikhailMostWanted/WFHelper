import { describe, expect, it } from "vitest";

import {
  NO_PLAT_RANGE,
  platRangeActive,
  withinPlatRange,
} from "../../../src/lib/market/platRange.js";

describe("withinPlatRange", () => {
  it("passes everything while no bound is set", () => {
    expect(platRangeActive(NO_PLAT_RANGE)).toBe(false);
    expect(withinPlatRange(3, NO_PLAT_RANGE)).toBe(true);
    expect(withinPlatRange(null, NO_PLAT_RANGE)).toBe(true);
  });

  it("keeps the bounds inclusive", () => {
    const range = { min: 10, max: 20 };
    expect(withinPlatRange(10, range)).toBe(true);
    expect(withinPlatRange(20, range)).toBe(true);
    expect(withinPlatRange(9, range)).toBe(false);
    expect(withinPlatRange(21, range)).toBe(false);
  });

  it("applies a single bound on its own", () => {
    expect(withinPlatRange(5, { min: 10, max: null })).toBe(false);
    expect(withinPlatRange(50, { min: 10, max: null })).toBe(true);
    expect(withinPlatRange(50, { min: null, max: 20 })).toBe(false);
  });

  it("drops a row with no price once a bound is set", () => {
    expect(withinPlatRange(null, { min: 10, max: null })).toBe(false);
    expect(withinPlatRange(undefined, { min: null, max: 20 })).toBe(false);
  });
});
