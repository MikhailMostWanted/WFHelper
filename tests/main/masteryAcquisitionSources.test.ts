import { beforeAll, describe, expect, it } from "vitest";

import * as itemDb from "../../services/itemDatabase";
import { getAllMasterableItems } from "../../services/masteryHelper";

const MAG = "/Lotus/Powersuits/Mag/Mag";
const EXCALIBUR = "/Lotus/Powersuits/Excalibur/Excalibur";
const SKANA = "/Lotus/Weapons/Tenno/Melee/LongSword/LongSword";
const TAXON = "/Lotus/Types/Sentinels/SentinelPowersuits/TnSentinelCrossPowerSuit";
const ASH_PRIME = "/Lotus/Powersuits/Ninja/AshPrime";
const DERA = "/Lotus/Weapons/ClanTech/Energy/EnergyRifle";
const FLUCTUS = "/Lotus/Weapons/Tenno/Archwing/Primary/RocketArtillery/ArchRocketCrossbow";

describe("market and dojo acquisition sources", () => {
  beforeAll(() => {
    itemDb.buildDatabase();
  });

  it("resolves known Market blueprints with their credit price", () => {
    expect(itemDb.lookupItem(MAG)?.marketBuyable).toBe(true);
    expect(itemDb.lookupItem(MAG)?.marketCredits).toBe(25_000);
    expect(itemDb.lookupItem(EXCALIBUR)?.marketCredits).toBe(35_000);
    expect(itemDb.lookupItem(SKANA)?.marketCredits).toBe(15_000);
    expect(itemDb.lookupItem(TAXON)?.marketCredits).toBe(5_000);
  });

  it("keeps relic-only and dojo-only items out of the Market set", () => {
    expect(itemDb.lookupItem(ASH_PRIME)?.marketBuyable).toBeUndefined();
    expect(itemDb.lookupItem(DERA)?.marketBuyable).toBeUndefined();
  });

  it("resolves dojo research through the recipe resultType", () => {
    expect(itemDb.lookupItem(DERA)?.dojoResearch).toBe(true);
    expect(itemDb.lookupItem(FLUCTUS)?.dojoResearch).toBe(true);
    expect(itemDb.lookupItem(MAG)?.dojoResearch).toBeUndefined();
  });

  it("never prices a Prime blueprint as a credit Market purchase", () => {
    const priced = Object.entries(itemDb.getAllItems()).filter(
      ([, entry]) => entry.marketBuyable && entry.isPrime,
    );

    expect(priced.map(([uniqueName]) => uniqueName)).toEqual([]);
  });

  it("carries both facts onto the masterable item list", () => {
    const items = getAllMasterableItems();
    const market = items.filter((entry) => entry.marketBuyable);
    const dojo = items.filter((entry) => entry.dojoResearch);
    const both = items.filter((entry) => entry.marketBuyable && entry.dojoResearch);
    const pricedMarket = market.filter((entry) => typeof entry.marketCredits === "number");

    // Counts on record: they move only when DE changes the export.
    console.info(
      `masterable market=${market.length} (priced ${pricedMarket.length}) dojo=${dojo.length} both=${both.length} of ${items.length} masterable items`,
    );

    expect(market.length).toBeGreaterThan(100);
    expect(dojo.length).toBeGreaterThan(60);
    expect(pricedMarket.length).toBe(market.length);
  });
});
