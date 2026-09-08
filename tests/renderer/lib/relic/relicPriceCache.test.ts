import { describe, expect, it, vi } from "vitest";

import {
  configureRelicRuntimeCacheFingerprint,
  getCachedEv,
  warmupRelicEvs,
} from "../../../../src/lib/relic/relicPriceCache.js";
import { fetchPriceBySlug } from "../../../../src/lib/wfm/wfmPrice.js";
import type { RelicDatabase, RelicGroup } from "../../../../src/types/relics.js";

vi.mock("../../../../src/lib/wfm/wfmPrice.js", () => ({
  fetchPriceBySlug: vi.fn(),
  onPriceCacheUpdate: vi.fn(),
}));

describe("relic EV cache fingerprint", () => {
  it("recomputes EV when drop chances change for the same reward slugs", async () => {
    vi.mocked(fetchPriceBySlug).mockImplementation(async (slug) => ({
      status: "ok",
      slug: slug ?? null,
      median: slug === "part_a" ? 10 : 100,
    }));
    const group: RelicGroup = {
      key: "Lith A1",
      name: "Lith A1",
      tier: "Lith",
      code: "A1",
      imageUrl: null,
      qualities: {
        intact: {
          uniqueName: "/fixture/LithA1",
          rewards: [
            { name: "Part A", urlName: "part_a", chance: 50, rarity: "Common", ducats: 15 },
            { name: "Part B", urlName: "part_b", chance: 50, rarity: "Rare", ducats: 100 },
          ],
        },
      },
    };
    const db: RelicDatabase = { groups: { [group.key]: group }, byUniqueName: {} };
    configureRelicRuntimeCacheFingerprint(db);
    await warmupRelicEvs([group], () => {});
    expect(getCachedEv(group.key, 1, "intact")).toBe(55);

    const rewards = group.qualities.intact!.rewards;
    rewards[0].chance = 90;
    rewards[1].chance = 10;
    configureRelicRuntimeCacheFingerprint(db);
    await warmupRelicEvs([group], () => {});
    expect(getCachedEv(group.key, 1, "intact")).toBe(19);
    expect(getCachedEv(group.key, 4, "intact")).toBeCloseTo(40.951, 6);
    expect(fetchPriceBySlug).toHaveBeenCalledTimes(4);

    rewards.reverse();
    configureRelicRuntimeCacheFingerprint(db);
    await warmupRelicEvs([group], () => {});
    expect(getCachedEv(group.key, 1, "intact")).toBe(19);
    expect(fetchPriceBySlug).toHaveBeenCalledTimes(4);
  });
});
