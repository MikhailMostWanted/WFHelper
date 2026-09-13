import { describe, expect, it } from "vitest";

import { resolveRepOffer, summarizeMatches, summarizeTrade } from "../../config/shared/tradeMatch";
import type { TradeMatchPayload } from "../../config/shared/tradeMatch";
import type { TradeEvent } from "../../config/shared/statsTypes";

function trade(overrides: Partial<TradeEvent> = {}): TradeEvent {
  return {
    id: "trade-1",
    date: "2026-07-30T10:00:00.000Z",
    type: "sale",
    platChange: 45,
    partner: "Buyer",
    items: [
      {
        internalName: "",
        displayName: "Ash Prime Chassis",
        count: 1,
        direction: "given",
        wfmSlug: "ash_prime_chassis",
        wfmThumb: "/items/ash.png",
      },
      { internalName: "", displayName: "Platinum", count: 45, direction: "received" },
    ],
    ...overrides,
  };
}

function match(itemName: string, platinum: number): TradeMatchPayload {
  return {
    kind: "order",
    orderId: itemName,
    itemName,
    itemUrlName: null,
    itemThumb: null,
    quantity: 1,
    platinum,
    partner: "Buyer",
    type: "sale",
  };
}

describe("summarizeMatches", () => {
  it("passes a lone match through untouched", () => {
    expect(summarizeMatches([match("Boar Prime Stock", 30)], 30)).toEqual(
      match("Boar Prime Stock", 30),
    );
  });

  it("counts the rest and keeps the negotiated trade total", () => {
    const summary = summarizeMatches(
      [match("Boar Prime Stock", 30), match("Boar Prime Barrel", 25), match("Arcane Energize", 40)],
      80,
    );

    expect(summary?.itemName).toBe("Boar Prime Stock +2");
    expect(summary?.platinum).toBe(80);
  });

  it("returns null when nothing closed", () => {
    expect(summarizeMatches([], 0)).toBeNull();
  });
});

describe("resolveRepOffer", () => {
  const enabled = { enabled: true, hotkey: "F9" };

  it("offers rep for a closed WFM sale", () => {
    expect(resolveRepOffer(match("Ash Prime Chassis", 45), "closed", enabled)).toEqual({
      partner: "Buyer",
      hotkey: "F9",
    });
  });

  it("still offers rep when the matched listing failed to close", () => {
    expect(resolveRepOffer(match("Ash Prime Chassis", 45), "close-failed", enabled)).not.toBeNull();
  });

  it("offers rep for a closed riven contract sale", () => {
    const contract = { ...match("Karak Visican", 200), kind: "contract" as const };
    expect(resolveRepOffer(contract, "closed", enabled)?.partner).toBe("Buyer");
  });

  it("offers rep for a purchase that closed a buy order", () => {
    const purchase = { ...match("Serration", 20), type: "purchase" as const };
    expect(resolveRepOffer(purchase, "closed", enabled)).toEqual({
      partner: "Buyer",
      hotkey: "F9",
    });
    expect(resolveRepOffer(purchase, "close-failed", enabled)).not.toBeNull();
  });

  // Buying on warframe.market means whispering somebody else's sell order, which
  // closes no listing of ours, so the common case arrives with no order id.
  it("offers rep for a purchase that matched no order once the orders were checked", () => {
    const purchase = { ...match("Serration", 20), type: "purchase" as const, orderId: "" };
    expect(resolveRepOffer(purchase, "no-match", enabled)).toEqual({
      partner: "Buyer",
      hotkey: "F9",
    });
  });

  it("refuses an unmatched purchase that warframe.market never saw", () => {
    const purchase = { ...match("Serration", 20), type: "purchase" as const, orderId: "" };
    // "detected" is auto-close off or signed out: no orders were ever consulted.
    expect(resolveRepOffer(purchase, "detected", enabled)).toBeNull();
    // "match-failed" is the lookup throwing, so nothing was compared either.
    expect(resolveRepOffer(purchase, "match-failed", enabled)).toBeNull();
    expect(resolveRepOffer({ ...purchase, platinum: 0 }, "no-match", enabled)).toBeNull();
    const barter = { ...purchase, type: "trade" as const };
    expect(resolveRepOffer(barter, "no-match", enabled)).toBeNull();
  });

  it("never offers rep for sales that matched no WFM listing", () => {
    const unmatched = { ...match("Ash Prime Chassis", 45), orderId: "" };
    expect(resolveRepOffer(unmatched, "no-match", enabled)).toBeNull();
    expect(resolveRepOffer(unmatched, "detected", enabled)).toBeNull();
    expect(resolveRepOffer(match("Ash Prime Chassis", 45), "no-match", enabled)).toBeNull();
    expect(resolveRepOffer(match("Ash Prime Chassis", 45), "detected", enabled)).toBeNull();
  });

  it("respects the setting toggle, missing hotkey, and missing partner", () => {
    expect(resolveRepOffer(match("X", 1), "closed", { enabled: false, hotkey: "F9" })).toBeNull();
    expect(resolveRepOffer(match("X", 1), "closed", { enabled: true, hotkey: "  " })).toBeNull();
    const anonymous = { ...match("X", 1), partner: "" };
    expect(resolveRepOffer(anonymous, "closed", enabled)).toBeNull();
  });
});

describe("summarizeTrade", () => {
  it("describes a sale by what was given away", () => {
    expect(summarizeTrade(trade())).toEqual({
      kind: "order",
      orderId: "",
      itemName: "Ash Prime Chassis",
      itemUrlName: "ash_prime_chassis",
      itemThumb: "/items/ash.png",
      quantity: 1,
      platinum: 45,
      partner: "Buyer",
      type: "sale",
    });
  });

  it("counts the remaining items instead of listing them all", () => {
    const summary = summarizeTrade(
      trade({
        items: [
          { internalName: "", displayName: "Braton Prime Barrel", count: 1, direction: "given" },
          { internalName: "", displayName: "Braton Prime Stock", count: 1, direction: "given" },
          { internalName: "", displayName: "Braton Prime Blueprint", count: 1, direction: "given" },
        ],
      }),
    );

    expect(summary.itemName).toBe("Braton Prime Barrel +2");
  });

  it("describes a purchase by what was received", () => {
    const summary = summarizeTrade(
      trade({
        type: "purchase",
        items: [
          { internalName: "", displayName: "Platinum", count: 20, direction: "given" },
          { internalName: "", displayName: "Serration", count: 1, direction: "received" },
        ],
      }),
    );

    expect(summary.itemName).toBe("Serration");
    expect(summary.type).toBe("purchase");
  });

  it("describes both sides of a barter without treating it as a purchase", () => {
    const summary = summarizeTrade(
      trade({
        type: "trade",
        platChange: 0,
        items: [
          { internalName: "", displayName: "Serration", count: 1, direction: "given" },
          { internalName: "", displayName: "Split Chamber", count: 1, direction: "received" },
        ],
      }),
    );

    expect(summary.itemName).toBe("Serration +1");
    expect(summary.platinum).toBe(0);
    expect(summary.type).toBe("trade");
  });

  it("still renders when nothing matched the traded side", () => {
    const summary = summarizeTrade(trade({ items: [], partner: undefined }));

    expect(summary.itemName).toBe("Trade");
    expect(summary.partner).toBe("");
  });
});
