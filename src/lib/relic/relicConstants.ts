import type { MessageKey } from "../i18n.js";
import type { RelicQuality } from "../../types/relics.js";
import { RELIC_ICON_URLS } from "../assetUrls.js";

export const RELIC_ICON_PATHS: Record<string, string> = RELIC_ICON_URLS;

export const RELIC_TIER_ORDER: Record<string, number> = {
  Lith: 0,
  Meso: 1,
  Neo: 2,
  Axi: 3,
  Requiem: 4,
};

export const QUALITY_MODES: RelicQuality[] = ["intact", "exceptional", "flawless", "radiant"];

/** Int / Ex / Fl / Rad. */
export const RELIC_QUALITY_SHORT_KEY: Record<RelicQuality, MessageKey> = {
  intact: "relics.qualityShort.intact",
  exceptional: "relics.qualityShort.exceptional",
  flawless: "relics.qualityShort.flawless",
  radiant: "relics.qualityShort.radiant",
};

/** Highest owned grade, scanning best-first. Null when none owned. */
export function highestOwnedQuality(
  qualities: readonly RelicQuality[],
  ownedCount: (quality: RelicQuality) => number,
): RelicQuality | null {
  for (let i = qualities.length - 1; i >= 0; i--) {
    if (ownedCount(qualities[i]) > 0) return qualities[i];
  }
  return null;
}

export function fissureTierClass(tier: string = ""): string {
  const t = tier.toLowerCase();
  if (t.includes("lith")) return "lith";
  if (t.includes("meso")) return "meso";
  if (t.includes("neo")) return "neo";
  if (t.includes("axi")) return "axi";
  if (t.includes("requiem")) return "requiem";
  if (t.includes("omnia")) return "omnia";
  return "default";
}
