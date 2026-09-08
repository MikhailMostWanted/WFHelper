import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: () => "/tmp" } }));

import { parseProfileScans } from "../../services/codexProfile";

describe("parseProfileScans", () => {
  const entries = [
    { scans: 752, type: "/Lotus/Types/Enemies/Corpus/CrewmanAvatar" },
    { scans: 3, type: "/Lotus/Types/Enemies/Grineer/LancerAvatar" },
  ];

  it("reads the array from root.Stats", () => {
    const result = parseProfileScans({ Stats: { Scans: entries } });
    expect(result).toEqual([
      { type: "/Lotus/Types/Enemies/Corpus/CrewmanAvatar", count: 752 },
      { type: "/Lotus/Types/Enemies/Grineer/LancerAvatar", count: 3 },
    ]);
  });

  it("falls back to Results[0].Stats", () => {
    const result = parseProfileScans({ Results: [{ Stats: { Scans: entries } }] });
    expect(result?.length).toBe(2);
  });

  it("drops malformed entries and invalid numeric counts", () => {
    const result = parseProfileScans({
      Stats: { Scans: [{ scans: -2, type: "/L/X" }, { scans: 1 }, { type: "/L/Y" }, null] },
    });
    expect(result).toEqual([]);
  });

  it("returns null when no scans array exists", () => {
    expect(parseProfileScans({})).toBeNull();
    expect(parseProfileScans(null)).toBeNull();
  });
});

it("never coerces null, booleans or numeric strings into scan counts", () => {
  expect(
    parseProfileScans({
      Stats: {
        Scans: [null, true, "12", -1, 1.5, Infinity, 3].map((scans) => ({
          type: "/Lotus/X",
          scans,
        })),
      },
    }),
  ).toEqual([{ type: "/Lotus/X", count: 3 }]);
});
