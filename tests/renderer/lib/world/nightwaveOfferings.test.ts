import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchBackendRaw: vi.fn(),
  isBackendLiteConfigured: vi.fn(() => true),
}));

vi.mock("../../../../src/lib/wfm/backendLite.js", () => ({
  fetchBackendRaw: mocks.fetchBackendRaw,
  isBackendLiteConfigured: mocks.isBackendLiteConfigured,
}));
vi.mock("../../../../src/lib/log.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  buildItemNameIndex,
  loadNightwaveOfferings,
  resetNightwaveOfferingsCacheForTest,
  resolveOfferingUniqueName,
} from "../../../../src/lib/world/nightwaveOfferings.js";

import { parseNightwaveOfferingsDoc } from "../../../../config/shared/nightwaveOfferings.js";

const STORAGE_KEY = "wf_nightwave_offerings_v1";
const NOW = Date.parse("2026-09-09T06:35:00.000Z");

function stubStorage(seed: Record<string, string> = {}): Map<string, string> {
  const mem = new Map(Object.entries(seed));
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => mem.get(key) ?? null,
    setItem: (key: string, value: string) => void mem.set(key, value),
  });
  return mem;
}

function validDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ok: true,
    generatedAt: NOW,
    source: "wiki",
    tabs: [
      {
        name: "Auras",
        sections: [
          {
            name: "Auras",
            creds: 20,
            items: [
              { name: "Corrosive Projection", always: true, creds: 20, quantity: 1 },
              { name: "Dead Eye", always: true, creds: 20, quantity: 1 },
            ],
          },
        ],
      },
      {
        name: "Weapon Skins",
        sections: [
          {
            name: "Weapon Skins",
            creds: null,
            items: [{ name: "Cedo Daybreak Skin", always: true, creds: 50, quantity: 1 }],
          },
        ],
      },
    ],
    ...overrides,
  };
}

function jsonResponse(body: unknown, headers: Record<string, string> = {}): Response {
  return {
    status: 200,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  resetNightwaveOfferingsCacheForTest();
  mocks.fetchBackendRaw.mockReset();
  mocks.isBackendLiteConfigured.mockReturnValue(true);
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("parseNightwaveOfferingsDoc", () => {
  it("accepts the worker payload and keeps every tab", () => {
    const doc = parseNightwaveOfferingsDoc(validDoc());

    expect(doc?.generatedAt).toBe(NOW);
    expect(doc?.tabs.map((tab) => tab.name)).toEqual(["Auras", "Weapon Skins"]);
    expect(doc?.tabs[0].sections[0]).toEqual({
      name: "Auras",
      creds: 20,
      items: [
        { name: "Corrosive Projection", always: true, creds: 20, quantity: 1 },
        { name: "Dead Eye", always: true, creds: 20, quantity: 1 },
      ],
    });
    expect(doc?.tabs[1].sections[0].creds).toBeNull();
  });

  it("rejects a non-object, a missing timestamp and a payload without tabs", () => {
    expect(parseNightwaveOfferingsDoc(null)).toBeNull();
    expect(parseNightwaveOfferingsDoc([])).toBeNull();
    expect(parseNightwaveOfferingsDoc(validDoc({ generatedAt: 0 }))).toBeNull();
    expect(parseNightwaveOfferingsDoc(validDoc({ generatedAt: "today" }))).toBeNull();
    expect(parseNightwaveOfferingsDoc(validDoc({ tabs: "nope" }))).toBeNull();
    expect(parseNightwaveOfferingsDoc(validDoc({ tabs: [] }))).toBeNull();
  });

  it("drops unnamed rows, empty sections and a price outside 1..1000", () => {
    const doc = parseNightwaveOfferingsDoc(
      validDoc({
        tabs: [
          {
            name: "Auras",
            sections: [
              {
                name: "",
                creds: 20,
                items: [{ name: "Physique", always: true, creds: 20, quantity: 1 }],
              },
              { name: "Empty", creds: 20, items: [] },
              {
                name: "Auras",
                creds: 1001,
                items: [
                  { name: 42, always: true, creds: 20, quantity: 1 },
                  { name: "Steel Charge", always: "yes", creds: 0 },
                  { name: `${"n".repeat(80)}`, always: false, creds: 20.5 },
                ],
              },
            ],
          },
          { name: "Unnamed", sections: [] },
        ],
      }),
    );

    expect(doc?.tabs).toHaveLength(1);
    expect(doc?.tabs[0].sections).toHaveLength(1);
    expect(doc?.tabs[0].sections[0].creds).toBeNull();
    expect(doc?.tabs[0].sections[0].items).toEqual([
      { name: "Steel Charge", always: false, creds: null, quantity: 1 },
      { name: "n".repeat(60), always: false, creds: null, quantity: 1 },
    ]);
  });

  it("preserves explicit quantities and recovers legacy bundle captions or catalog names", () => {
    const names = [
      "5x Nitain Extract",
      "10,000x Kuva",
      "Nitain Extract",
      "Kuva",
      "Dead Eye",
      "3x Relic Pack",
    ];
    const doc = parseNightwaveOfferingsDoc(
      validDoc({
        tabs: [
          {
            name: "Bundles",
            sections: [
              {
                name: "Bundles",
                creds: 15,
                items: names.map((name, index) => ({
                  name,
                  quantity: index === 5 ? 6 : undefined,
                })),
              },
            ],
          },
        ],
      }),
    );
    expect(doc?.tabs[0].sections[0].items.map((item) => item.quantity)).toEqual([
      5, 10000, 5, 10000, 1, 6,
    ]);
  });

  it("caps tabs, sections and items", () => {
    const doc = parseNightwaveOfferingsDoc(
      validDoc({
        tabs: Array.from({ length: 13 }, (_, tab) => ({
          name: `Tab ${tab}`,
          sections: Array.from({ length: tab === 0 ? 41 : 1 }, (_, section) => ({
            name: `Section ${section}`,
            creds: null,
            items: Array.from({ length: tab === 0 && section === 0 ? 121 : 1 }, (_, item) => ({
              name: `Item ${item}`,
              always: false,
              creds: 20,
            })),
          })),
        })),
      }),
    );

    expect(doc?.tabs).toHaveLength(12);
    expect(doc?.tabs[0].sections).toHaveLength(40);
    expect(doc?.tabs[0].sections[0].items).toHaveLength(120);
  });
});

describe("resolveOfferingUniqueName", () => {
  const index = buildItemNameIndex({
    "/Lotus/Upgrades/Skins/Ninja/NinjaHelmetAltBStatless": { name: "Ash Locust Helmet" },
    "/Lotus/Upgrades/Skins/Ninja/Duplicate": { name: "Ash Locust Helmet" },
    "/Lotus/Types/Items/MiscItems/Forma": { name: " Forma " },
    "/Lotus/Types/Items/MiscItems/Nameless": {},
  });

  it("indexes catalog names once, case-insensitively", () => {
    expect(index.get("ash locust helmet")).toBe(
      "/Lotus/Upgrades/Skins/Ninja/NinjaHelmetAltBStatless",
    );
    expect(index.get("forma")).toBe("/Lotus/Types/Items/MiscItems/Forma");
    expect(index.size).toBe(2);
  });

  it("prefers the reviewed override over the catalog name", () => {
    expect(resolveOfferingUniqueName("5x Nitain Extract", index)).toEqual({
      uniqueName: "/Lotus/Types/Items/MiscItems/Alertium",
    });
    expect(resolveOfferingUniqueName("Nightwave Landing Craft Blueprint", index)).toEqual({
      uniqueName: "/Lotus/Types/Recipes/LandingCraftRecipes/NightwaveShip/NoraShipBlueprint",
      imageOf: "/Lotus/Types/Items/Ships/NoraShip",
    });
  });

  it("falls back to the item a wiki blueprint name builds", () => {
    expect(resolveOfferingUniqueName("Ash Locust Helmet Blueprint", index)).toEqual({
      uniqueName: "/Lotus/Upgrades/Skins/Ninja/NinjaHelmetAltBStatless",
    });
    expect(resolveOfferingUniqueName("Gral's Thumper Floof", index)).toEqual({ uniqueName: null });
  });
});

describe("loadNightwaveOfferings", () => {
  it("fetches once, caches in memory and stores the copy with its etag", async () => {
    const store = stubStorage();
    mocks.fetchBackendRaw.mockResolvedValue(jsonResponse(validDoc(), { etag: '"abc-1"' }));

    const first = await loadNightwaveOfferings();
    const second = await loadNightwaveOfferings();

    expect(first?.tabs).toHaveLength(2);
    expect(second).toBe(first);
    expect(mocks.fetchBackendRaw).toHaveBeenCalledTimes(1);
    expect(mocks.fetchBackendRaw).toHaveBeenCalledWith("/v1/nightwave-offerings", {
      signal: expect.any(AbortSignal),
      headers: {},
    });
    const stored = JSON.parse(store.get(STORAGE_KEY) ?? "{}") as Record<string, unknown>;
    expect(stored).toMatchObject({ savedAt: NOW, etag: '"abc-1"' });
  });

  it("serves a copy younger than an hour without a request", async () => {
    stubStorage({
      [STORAGE_KEY]: JSON.stringify({ savedAt: NOW - 60_000, etag: null, doc: validDoc() }),
    });

    expect((await loadNightwaveOfferings())?.tabs[0].name).toBe("Auras");
    expect(mocks.fetchBackendRaw).not.toHaveBeenCalled();
  });

  it("revalidates an older copy and keeps it on 304", async () => {
    stubStorage({
      [STORAGE_KEY]: JSON.stringify({
        savedAt: NOW - 2 * 60 * 60 * 1000,
        etag: '"abc-1"',
        doc: validDoc(),
      }),
    });
    mocks.fetchBackendRaw.mockResolvedValue({ status: 304 } as unknown as Response);

    expect((await loadNightwaveOfferings())?.tabs).toHaveLength(2);
    expect(mocks.fetchBackendRaw).toHaveBeenCalledWith("/v1/nightwave-offerings", {
      signal: expect.any(AbortSignal),
      headers: { "If-None-Match": '"abc-1"' },
    });
  });

  it("keeps the stored copy when the backend is unreachable or answers 404", async () => {
    stubStorage({
      [STORAGE_KEY]: JSON.stringify({
        savedAt: NOW - 2 * 60 * 60 * 1000,
        etag: null,
        doc: validDoc(),
      }),
    });
    mocks.fetchBackendRaw.mockResolvedValue(null);

    expect((await loadNightwaveOfferings())?.tabs).toHaveLength(2);

    resetNightwaveOfferingsCacheForTest();
    mocks.fetchBackendRaw.mockResolvedValue(
      jsonResponse({ ok: false, error: "nightwave_offerings_not_ready" }),
    );

    expect((await loadNightwaveOfferings())?.tabs).toHaveLength(2);
  });

  it("aborts a stalled body, then allows another load", async () => {
    stubStorage();
    mocks.fetchBackendRaw.mockImplementationOnce(
      async (_path: string, { signal }: { signal: AbortSignal }) =>
        new Response(
          new ReadableStream({
            start(controller) {
              signal.addEventListener("abort", () => controller.error(signal.reason), {
                once: true,
              });
            },
          }),
        ),
    );
    const pending = loadNightwaveOfferings();
    await vi.advanceTimersByTimeAsync(8000);
    expect(await pending).toBeNull();
    mocks.fetchBackendRaw.mockResolvedValue(jsonResponse(validDoc()));
    expect((await loadNightwaveOfferings())?.tabs).toHaveLength(2);
  });

  it("returns null when the copy aged out and the backend has nothing", async () => {
    stubStorage({
      [STORAGE_KEY]: JSON.stringify({
        savedAt: NOW - 31 * 24 * 60 * 60 * 1000,
        etag: null,
        doc: validDoc(),
      }),
    });
    mocks.fetchBackendRaw.mockResolvedValue(null);

    expect(await loadNightwaveOfferings()).toBeNull();
  });

  it("makes no request when the backend is not configured", async () => {
    stubStorage();
    mocks.isBackendLiteConfigured.mockReturnValue(false);

    expect(await loadNightwaveOfferings()).toBeNull();
    expect(mocks.fetchBackendRaw).not.toHaveBeenCalled();
  });
});
