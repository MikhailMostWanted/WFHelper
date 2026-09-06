import { makeItemRefResolver } from "./tradeAnalytics.js";
import type { ItemDbLookup, WfmItemsLookup } from "../../types/ipc.js";

export interface AnalyticsItemLink {
  resolve: (key: string, name: string) => string | null;
  open: (uniqueName: string) => void;
}

/** An analytics row's key may be a market slug, an internal name or a display
 *  name, so it goes to the resolver as all three. */
export function createAnalyticsItemResolver(
  itemDb: ItemDbLookup,
  wfmItems: WfmItemsLookup,
): AnalyticsItemLink["resolve"] {
  const resolveRef = makeItemRefResolver(itemDb, wfmItems);
  return (key, name) =>
    resolveRef({
      internalName: (key ?? "").trim(),
      wfmSlug: (key ?? "").trim(),
      displayName: (name ?? "").trim(),
    });
}
