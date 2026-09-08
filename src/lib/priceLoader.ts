import { fetchPriceByName, fetchPriceBySlug } from "./wfm/wfmPrice.js";
import { send } from "./ipc.js";
import type { MessageKey } from "../i18n/en.js";

export interface PriceState {
  messageKey: MessageKey | null;
  messageParams?: Record<string, string | number>;
  slug: string | null;
}

/** WFM price via a known slug. Null on transient/unusable-slug results so the
 *  caller can fall back to name-based resolution. */
export async function loadItemPriceBySlug(slug: string): Promise<PriceState | null> {
  try {
    const result = await fetchPriceBySlug(slug, { priority: "high" });
    if (result?.median != null) {
      return {
        messageKey: "market.priceAverage48h",
        messageParams: { plat: result.median },
        slug: result.slug,
      };
    }
    if (result?.status === "no_data") {
      return { messageKey: "market.noRecentPriceData", slug: result.slug };
    }
    return null;
  } catch {
    return null;
  }
}

/** WFM price for an item/component - { messageKey, slug }. */
export async function loadItemPrice(
  name: string,
  wfmItems: Record<string, { url_name: string }>,
  isTradable: boolean,
): Promise<PriceState> {
  if (!isTradable) {
    return { messageKey: "market.itemNotTradable", slug: null };
  }
  try {
    const result = await fetchPriceByName(name, wfmItems, { priority: "high" });
    if (result?.median != null) {
      return {
        messageKey: "market.priceAverage48h",
        messageParams: { plat: result.median },
        slug: result.slug,
      };
    }
    const mapping = (wfmItems || {})[name?.toLowerCase()];
    if (mapping) {
      return { messageKey: "market.noRecentPriceData", slug: mapping.url_name };
    }
    return { messageKey: "market.noListingFound", slug: null };
  } catch {
    return { messageKey: "market.priceLoadFailed", slug: null };
  }
}

/** Open an item on warframe.market by slug. */
export function openOnWfm(slug: string | null): void {
  if (slug) send("open-external", `https://warframe.market/items/${slug}`);
}
