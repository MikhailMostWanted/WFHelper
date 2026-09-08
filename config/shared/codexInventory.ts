import type { CodexScanEntry } from "./codexTypes";
import { asRecord } from "./objectValidation";

// The caller must bind the inventory snapshot to the profile account first.
export function mergeCodexInventoryScans(
  scans: readonly CodexScanEntry[],
  trustedInventory: unknown,
): CodexScanEntry[] {
  const counts = new Map<string, number>();
  for (const entry of scans) {
    counts.set(entry.type, Math.max(counts.get(entry.type) ?? 0, entry.count));
  }
  const fragments = asRecord(trustedInventory)?.LoreFragmentScans;
  if (Array.isArray(fragments)) {
    for (const entry of fragments) {
      const fragment = asRecord(entry);
      const type = fragment?.ItemType;
      const count = fragment?.Progress;
      if (
        typeof type !== "string" ||
        !type.startsWith("/Lotus/") ||
        type.length > 512 ||
        typeof count !== "number" ||
        !Number.isSafeInteger(count) ||
        count < 0
      )
        continue;
      counts.set(type, Math.max(counts.get(type) ?? 0, count));
    }
  }
  return [...counts].map(([type, count]) => ({ type, count }));
}
