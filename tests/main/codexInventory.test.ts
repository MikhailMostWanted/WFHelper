import { describe, expect, it } from "vitest";
import { mergeCodexInventoryScans } from "../../config/shared/codexInventory";

const A = "/Lotus/Types/Lore/Fragments/GlassFragments/GlassFragmentA";
const B = "/Lotus/Types/Lore/Fragments/GlassFragments/GlassFragmentB";

describe("same-account Codex inventory merge", () => {
  it("adds exact fragment progress without distributing generic scans", () => {
    const scans = [{ type: "/Lotus/Types/Lore/LoreFragmentScanDeco", count: 40 }];
    expect(
      mergeCodexInventoryScans(scans, {
        LoreFragmentScans: [
          { ItemType: A, Progress: 1 },
          { ItemType: B, Progress: 2 },
        ],
      }),
    ).toEqual([...scans, { type: A, count: 1 }, { type: B, count: 2 }]);
    expect(scans).toHaveLength(1);
  });

  it("takes maximum evidence without double counting aliases or changing path case", () => {
    expect(
      mergeCodexInventoryScans([{ type: A, count: 3 }], {
        LoreFragmentScans: [
          { ItemType: A, Progress: 2 },
          { ItemType: A, Progress: 5 },
          { ItemType: B, Progress: 0 },
        ],
      }),
    ).toEqual([
      { type: A, count: 5 },
      { type: B, count: 0 },
    ]);
  });

  it("rejects malformed progress and ignores undocumented collection counters", () => {
    const invalid = [null, true, "4", -1, 0.2, Infinity, Number.MAX_SAFE_INTEGER + 1];
    expect(
      mergeCodexInventoryScans([], {
        LoreFragmentScans: [
          ...invalid.map((Progress) => ({ ItemType: A, Progress })),
          { ItemType: "untrusted", Progress: 3 },
          null,
        ],
        CollectibleSeries: [{ ItemType: B, Count: 10, ReqScans: 1 }],
      }),
    ).toEqual([]);
  });

  it.each([null, {}, { LoreFragmentScans: {} }])(
    "leaves profile evidence when inventory is absent",
    (inventory) => {
      expect(mergeCodexInventoryScans([{ type: A, count: 3 }], inventory)).toEqual([
        { type: A, count: 3 },
      ]);
    },
  );
});
