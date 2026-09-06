import { describe, expect, it } from "vitest";

import { createAnalyticsItemResolver } from "../../../../src/lib/stats/analyticsItemLink.js";
import type { ItemDbEntry } from "../../../../src/types/inventory.js";
import type { ItemDbLookup, WfmItemsLookup } from "../../../../src/types/ipc.js";

const FORMA = "/Lotus/Types/Items/MiscItems/Forma";
const CELL = "/Lotus/Types/Items/MiscItems/OrokinCell";
const SERRATION = "/Lotus/Upgrades/Mods/Rifle/WeaponDamageAmountMod";

function entry(name: string): ItemDbEntry {
  return { name, category: "Misc" } as ItemDbEntry;
}

const itemDb: ItemDbLookup = {
  [FORMA]: entry("Forma"),
  [CELL]: entry("Orokin Cell"),
  [SERRATION]: entry("Serration"),
};

const wfmItems: WfmItemsLookup = {
  forma: { url_name: "forma", gameRef: FORMA },
  "orokin cell": { url_name: "orokin_cell", gameRef: CELL },
  // WFM's gameRef does not promise DE's casing, so this one differs from the key.
  serration: { url_name: "serration", gameRef: SERRATION.toLowerCase() },
  "mirage prime set": { url_name: "mirage_prime_set", gameRef: "/Lotus/Types/Absent" },
};

describe("analytics item link resolver", () => {
  it("takes an internal name straight from the item database", () => {
    expect(createAnalyticsItemResolver(itemDb, wfmItems)(FORMA, "Forma")).toBe(FORMA);
  });

  it("resolves a warframe.market slug through the catalog", () => {
    const resolve = createAnalyticsItemResolver(itemDb, wfmItems);
    expect(resolve("orokin_cell", "Orokin Cell")).toBe(CELL);
  });

  it("folds a lowercased display-name key into the slug it matches", () => {
    const resolve = createAnalyticsItemResolver(itemDb, wfmItems);
    expect(resolve("orokin cell", "Orokin Cell")).toBe(CELL);
  });

  it("falls back to the catalog name when the key resolves to nothing", () => {
    const resolve = createAnalyticsItemResolver(itemDb, wfmItems);
    expect(resolve("", "Forma")).toBe(FORMA);
  });

  it("folds a gameRef whose casing differs from the item-database key", () => {
    const resolve = createAnalyticsItemResolver(itemDb, wfmItems);
    expect(resolve("serration", "Serration")).toBe(SERRATION);
  });

  it("resolves a ranked row through its bare name", () => {
    const resolve = createAnalyticsItemResolver(itemDb, wfmItems);
    expect(resolve("serration (rank 10)", "Serration (Rank 10)")).toBe(SERRATION);
  });

  it("returns null for a riven roll and for a catalog entry the database lacks", () => {
    const resolve = createAnalyticsItemResolver(itemDb, wfmItems);
    expect(resolve("braton riven", "Braton Riven")).toBeNull();
    expect(resolve("mirage_prime_set", "Mirage Prime Set")).toBeNull();
  });

  it("keeps resolving the same keys after the lazy indices are built", () => {
    const resolve = createAnalyticsItemResolver(itemDb, wfmItems);
    expect(resolve("serration", "Serration")).toBe(SERRATION);
    expect(resolve("orokin_cell", "Orokin Cell")).toBe(CELL);
    expect(resolve("serration", "Serration")).toBe(SERRATION);
    expect(resolve("mirage_prime_set", "Mirage Prime Set")).toBeNull();
  });
});
