import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const history = {
  version: 1,
  updatedAt: 3000,
  coverageStart: 1000,
  visits: [{ id: "visit", activation: 1000, expiry: 2000, node: "Relais Höhe", items: [] }],
  lastSeen: [],
};

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("VITE_WFM_BACKEND_URL", "https://backend.test");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Baro history response boundary", () => {
  it("decodes a streamed envelope across a split UTF-8 character", async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ ok: true, data: history }));
    const split = bytes.indexOf(0xc3) + 1;
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(bytes.slice(0, split));
          controller.enqueue(bytes.slice(split));
          controller.close();
        },
      }),
      { status: 200 },
    );
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetchMock);
    const { fetchBackendBaroHistory } = await import("../../../../src/lib/wfm/backendLite");
    expect(await fetchBackendBaroHistory()).toEqual(history);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://backend.test/v1/baro-history",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("rejects status zero even when a readable body contains valid history", async () => {
    const response = new Response(JSON.stringify({ ok: true, data: history }));
    Object.defineProperties(response, { status: { value: 0 }, ok: { value: false } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    const { fetchBackendBaroHistory } = await import("../../../../src/lib/wfm/backendLite");
    expect(await fetchBackendBaroHistory()).toBeNull();
    expect(response.bodyUsed).toBe(false);
  });

  it("cancels a response stream above the eight MiB limit", async () => {
    const cancel = vi.fn();
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(8 * 1024 * 1024 + 1));
        },
        cancel,
      }),
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    const { fetchBackendBaroHistory } = await import("../../../../src/lib/wfm/backendLite");
    expect(await fetchBackendBaroHistory()).toBeNull();
    expect(cancel).toHaveBeenCalledOnce();
    expect(response.body?.locked).toBe(false);
  });

  it("rejects unsuccessful, missing and malformed envelopes", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { fetchBackendBaroHistory } = await import("../../../../src/lib/wfm/backendLite");
    for (const body of [
      { ok: false, data: history },
      { ok: true },
      { ok: true, data: {} },
      history,
    ]) {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body)));
      expect(await fetchBackendBaroHistory()).toBeNull();
    }
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
    expect(await fetchBackendBaroHistory()).toBeNull();
  });
});
