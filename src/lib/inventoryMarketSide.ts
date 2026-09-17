import type { InventoryGroup } from "../types/inventory.js";

export type InventoryMarketSide = "wtb" | "wts";

interface InventoryMarketPriceItem {
  inventoryGroup: InventoryGroup;
  rank: number;
  maxRank: number;
  platinum: number | null;
  wtsR0: number | null;
  wtbR0: number | null;
  wtsRmax: number | null;
  wtbRmax: number | null;
}

/**
 * Price represented by the currently selected market side.
 * Relics keep their subtype-aware price because a rankless summary cache cannot
 * distinguish Intact/Exceptional/Flawless/Radiant listings by slug alone.
 */
export function inventoryMarketPrice(
  item: InventoryMarketPriceItem,
  side: InventoryMarketSide,
): number | null {
  if (item.inventoryGroup === "relics") return item.platinum;

  const maxed = item.maxRank > 0 && item.rank >= item.maxRank;
  if (maxed) {
    return side === "wtb" ? item.wtbRmax : item.wtsRmax;
  }
  return side === "wtb" ? item.wtbR0 : item.wtsR0;
}
