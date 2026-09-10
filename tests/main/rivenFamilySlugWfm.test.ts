import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  getAllRivenWeaponNames,
  getRivenFamilySlug,
  getWeaponNameByUniqueName,
} from "../../services/rivenData";

// warframe.market's own riven weapon list, captured from GET /v2/riven/weapons.
// It is the only authority on the slug an auction is keyed by, and it carries
// gameRef so the join never goes through a display name.
const WFM: Array<{ slug: string; gameRef: string }> = JSON.parse(
  readFileSync(join(__dirname, "..", "fixtures", "riven", "wfm-riven-weapons.json"), "utf8"),
);

// WFM keys a riven auction under this weapon's slug rather than the base name
// the gameRef resolves to, so the derived slug cannot reproduce it.
const KNOWN_DIVERGENCE = new Set(["dark_split_sword_(dual_swords)"]);

describe("getRivenFamilySlug against the warframe.market riven weapon list", () => {
  it("derives the slug WFM uses for every weapon the join resolves", () => {
    const wrong: string[] = [];
    for (const entry of WFM) {
      if (KNOWN_DIVERGENCE.has(entry.slug)) continue;
      const name = getWeaponNameByUniqueName(entry.gameRef);
      if (!name) continue;
      const derived = getRivenFamilySlug(name);
      if (derived !== entry.slug) wrong.push(`${name}: derived ${derived}, WFM ${entry.slug}`);
    }
    expect(wrong).toEqual([]);
  });

  it("spells the ampersand the way WFM does", () => {
    expect(getRivenFamilySlug("Silva & Aegis")).toBe("silva_and_aegis");
    expect(getRivenFamilySlug("Silva & Aegis Prime")).toBe("silva_and_aegis");
    expect(getRivenFamilySlug("Ack & Brunt")).toBe("ack_and_brunt");
    expect(getRivenFamilySlug("Cobra & Crane Prime")).toBe("cobra_and_crane");
    const slugs = new Set(WFM.map((entry) => entry.slug));
    for (const slug of ["silva_and_aegis", "ack_and_brunt", "cobra_and_crane"]) {
      expect(slugs.has(slug)).toBe(true);
    }
    expect(slugs.has("silva_aegis")).toBe(false);
  });

  it("keeps an affix WFM keeps, because the base weapon was never made", () => {
    // Stripping these asks WFM for a weapon that is not in its list.
    for (const [name, slug] of [
      ["Tenet Envoy", "tenet_envoy"],
      ["Kuva Bramma", "kuva_bramma"],
    ] as const) {
      expect(getRivenFamilySlug(name)).toBe(slug);
      expect(WFM.some((entry) => entry.slug === slug)).toBe(true);
    }
    expect(WFM.some((entry) => entry.slug === "envoy")).toBe(false);
    expect(WFM.some((entry) => entry.slug === "bramma")).toBe(false);
  });

  it("folds a syndicate variant onto the base weapon WFM lists", () => {
    const slugs = new Set(WFM.map((entry) => entry.slug));
    expect(getRivenFamilySlug("Vaykor Marelok")).toBe("marelok");
    expect(getRivenFamilySlug("Rakta Cernos")).toBe("cernos");
    expect(getRivenFamilySlug("Synoid Gammacor")).toBe("gammacor");

    const prefixed = getAllRivenWeaponNames().filter((name) =>
      /^(Vaykor|Rakta|Secura|Sancti|Synoid|Telos) /.test(name),
    );
    expect(prefixed.length).toBeGreaterThan(0);
    for (const name of prefixed) {
      expect(slugs.has(getRivenFamilySlug(name))).toBe(true);
      expect(slugs.has(name.toLowerCase().replace(/ /g, "_"))).toBe(false);
    }
  });
});
