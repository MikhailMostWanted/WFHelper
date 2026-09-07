import { describe, expect, it, vi } from "vitest";

const SCINDO_BLADE = "/Lotus/Types/Recipes/Weapons/WeaponParts/PrimeScindoBlade";
const FIXTURE_PREFIX = "/Fixture/";

// Every name resolves, so a reward left without a uniqueName means the service
// never asked the item database for it.
vi.mock("../../services/itemDatabase", () => ({
  localizedNameFields: () => ({}),
  lookupItem: () => null,
  lookupItemByNameOrSlug: (name: string | null, slug: string | null) => {
    if (name === "Scindo Prime Blade") return { uniqueName: SCINDO_BLADE, item: {} };
    const key = name || slug;
    return key ? { uniqueName: `${FIXTURE_PREFIX}${key}`, item: {} } : null;
  },
  toIconMirrorUrl: (url: string) => url,
}));

// Runs against the real @wfcd/items package: the quirk lives in its data.
describe("relic reward uniqueName", () => {
  it("resolves every reward through the item database, never keeping the relic's own", async () => {
    const { getRelicDatabase } = await import("../../services/relicService");
    const db = getRelicDatabase();
    const groups = Object.values(db.groups);
    expect(groups.length).toBeGreaterThan(100);

    const rewards = groups.flatMap((group) =>
      Object.values(group.qualities).flatMap((quality) => quality?.rewards ?? []),
    );
    expect(rewards.length).toBeGreaterThan(10_000);
    const leaked = rewards.filter((reward) =>
      (reward.uniqueName ?? "").startsWith("/Lotus/Types/Game/Projections/"),
    );
    expect(leaked).toEqual([]);
    const unresolved = rewards.filter((reward) => !reward.uniqueName);
    expect(unresolved).toEqual([]);

    const axiS3 = db.groups["Axi S3"];
    const blade = Object.values(axiS3.qualities)
      .flatMap((quality) => quality?.rewards ?? [])
      .find((reward) => reward.name === "Scindo Prime Blade");
    expect(blade?.uniqueName).toBe(SCINDO_BLADE);
  });
});
