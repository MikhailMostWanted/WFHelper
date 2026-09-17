import { beforeEach, describe, expect, it } from "vitest";

import {
  clearOrderSummaryCache,
  getCachedOrderSummaryState,
  setCachedOrderSummary,
} from "../../../src/lib/wfm/orderSummaryCache.js";
import { inventoryMarketPrice } from "../../../src/lib/inventoryMarketSide.js";

describe("instant inventory market pricing", () => {
  beforeEach(() => clearOrderSummaryCache());

  it("keeps rankless orders separate from real rank zero", () => {
    setCachedOrderSummary("braton_prime_receiver", null, { wts: 8, wtb: 5 });

    expect(getCachedOrderSummaryState("braton_prime_receiver", null)?.wtb).toBe(5);
    expect(getCachedOrderSummaryState("braton_prime_receiver", 0)).toBeNull();
  });

  it("selects live WTB or WTS for rankless tradables", () => {
    const item = {
      inventoryGroup: "all_parts" as const,
      rank: 0,
      maxRank: 0,
      platinum: 11,
      wtsR0: 9,
      wtbR0: 6,
      wtsRmax: null,
      wtbRmax: null,
    };

    expect(inventoryMarketPrice(item, "wtb")).toBe(6);
    expect(inventoryMarketPrice(item, "wts")).toBe(9);
  });

  it("uses max-rank orders for a maxed ranked item", () => {
    const item = {
      inventoryGroup: "mods" as const,
      rank: 10,
      maxRank: 10,
      platinum: 75,
      wtsR0: 18,
      wtbR0: 12,
      wtsRmax: 92,
      wtbRmax: 70,
    };

    expect(inventoryMarketPrice(item, "wtb")).toBe(70);
    expect(inventoryMarketPrice(item, "wts")).toBe(92);
  });

  it("keeps subtype-aware relic pricing untouched", () => {
    const item = {
      inventoryGroup: "relics" as const,
      rank: 0,
      maxRank: 0,
      platinum: 4,
      wtsR0: null,
      wtbR0: null,
      wtsRmax: null,
      wtbRmax: null,
    };

    expect(inventoryMarketPrice(item, "wtb")).toBe(4);
    expect(inventoryMarketPrice(item, "wts")).toBe(4);
  });
});
