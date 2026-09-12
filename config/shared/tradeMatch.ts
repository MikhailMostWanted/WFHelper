import type { TradeEvent, TradeType } from "./statsTypes";

export interface TradeMatchPayload {
  /** Regular market order, or a riven auction (closed through a different route). */
  kind: "order" | "contract";
  orderId: string;
  itemName: string;
  itemUrlName: string | null;
  itemThumb: string | null;
  quantity: number;
  platinum: number;
  partner: string;
  type: TradeType;
}

/** Listing closed, nothing matched, close rejected, or never checked. */
export type TradeNotificationStatus = "closed" | "no-match" | "close-failed" | "detected";

/** Toast content for however many listings one trade closed. */
export function summarizeMatches(
  matches: TradeMatchPayload[],
  tradePlatinum: number,
): TradeMatchPayload | null {
  const first = matches[0];
  if (!first) return null;
  return {
    ...first,
    itemName: `${first.itemName}${matches.length > 1 ? ` +${matches.length - 1}` : ""}`,
    platinum: tradePlatinum,
  };
}

export interface TradeRepOffer {
  partner: string;
  hotkey: string;
}

/** Whether the trade is one warframe.market can be credited for. A listing of
 *  ours proves it. Buying usually closes no listing, because the WFM way to buy
 *  is whispering somebody else's sell order, so the evidence there is that we
 *  held a live session and compared this trade against our own orders. */
function repTradeIsAttributable(
  match: TradeMatchPayload,
  status: TradeNotificationStatus,
): boolean {
  const settled = status === "closed" || status === "close-failed";
  if (match.orderId) return settled;
  // A sale that closed nothing is evidence against warframe.market: selling
  // through it always starts with an order of our own.
  if (match.type !== "purchase") return false;
  // Only "no-match" means the orders were fetched and checked for this trade;
  // "detected" is the status for never having looked. Plain platinum keeps
  // gifts and barter out.
  return status === "no-match" && match.platinum > 0;
}

export function resolveRepOffer(
  match: TradeMatchPayload | null | undefined,
  status: TradeNotificationStatus,
  options: { enabled: boolean; hotkey: string },
): TradeRepOffer | null {
  if (!options.enabled) return null;
  const hotkey = String(options.hotkey || "").trim();
  if (!hotkey) return null;
  if (!match || !repTradeIsAttributable(match, status)) return null;
  const partner = String(match.partner || "").trim();
  if (!partner) return null;
  return { partner, hotkey };
}

/** Toast content when no listing closed. */
export function summarizeTrade(trade: TradeEvent): TradeMatchPayload {
  const sideItems = trade.items.filter((item) => {
    if (trade.type === "trade") return item.displayName.toLowerCase() !== "platinum";
    return trade.type === "sale" ? item.direction === "given" : item.direction === "received";
  });
  const items = sideItems.length > 0 ? sideItems : trade.items;
  const first = items[0];
  const extra = items.length - 1;
  return {
    kind: "order",
    orderId: "",
    itemName: first ? `${first.displayName}${extra > 0 ? ` +${extra}` : ""}` : "Trade",
    itemUrlName: first?.wfmSlug ?? null,
    itemThumb: first?.wfmThumb ?? null,
    quantity: first?.count ?? 1,
    platinum: trade.platChange,
    partner: trade.partner ?? "",
    type: trade.type,
  };
}
