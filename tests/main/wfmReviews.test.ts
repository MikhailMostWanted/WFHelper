import { EventEmitter } from "node:events";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const wire = vi.hoisted(() => ({
  scripted: [] as Array<{ status: number; headers?: Record<string, string> }>,
  calls: [] as Array<{ method: string; path: string; headers: Record<string, string> }>,
}));

vi.mock("node:https", () => {
  const request = (
    options: { method: string; path: string; headers: Record<string, string> },
    cb: (res: unknown) => void,
  ) => {
    const req = new EventEmitter() as EventEmitter & Record<string, unknown>;
    req.setHeader = () => {};
    req.write = () => {};
    req.destroy = (err: Error) => req.emit("error", err);
    req.end = () => {
      const { method, path, headers } = options;
      wire.calls.push({ method, path, headers: { ...headers } });
      const next = wire.scripted.shift();
      if (!next) {
        queueMicrotask(() => req.emit("error", new Error("no scripted response left")));
        return;
      }
      const res = new EventEmitter() as EventEmitter & Record<string, unknown>;
      res.statusCode = next.status;
      res.headers = next.headers ?? {};
      res.destroy = () => {};
      queueMicrotask(() => {
        cb(res);
        res.emit("end");
      });
    };
    return req;
  };
  return { default: { request }, request };
});

vi.mock("../../services/wfmClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/wfmClient")>();
  return { ...actual, request: vi.fn(), requestRedirectTarget: vi.fn(), requestV2: vi.fn() };
});

vi.mock("../../services/logger", () => ({
  withScope: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { request, requestRedirectTarget, requestV2 } from "../../services/wfmClient";
import { WfmApiError } from "../../services/wfmTypes";
import { sendPlusRep } from "../../services/wfmReviews";

const requestMock = vi.mocked(request);
const redirectMock = vi.mocked(requestRedirectTarget);
const userMock = vi.mocked(requestV2);

const API = "https://api.warframe.market/v1";

function notFound(): WfmApiError {
  return new WfmApiError("WFMClient API error: app.user.notFound", "WFM_API_ERROR", 404);
}

describe("sendPlusRep", () => {
  beforeEach(() => {
    requestMock.mockReset();
    redirectMock.mockReset();
    userMock.mockReset();
    redirectMock.mockResolvedValue(null);
    // Loud default: a test that resolves no profile must not reach the POST.
    userMock.mockRejectedValue(notFound());
  });

  // WFM redirects anything that is not the account's own slug, and a POST is
  // never re-sent to a redirect target, so the slug has to be resolved first.
  it("posts to the slug WFM redirects the game name to", async () => {
    redirectMock.mockResolvedValueOnce(`${API}/profile/squad-mate/reviews/`);
    requestMock.mockResolvedValueOnce({});

    await expect(sendPlusRep("Squad_Mate")).resolves.toBe("sent");
    expect(redirectMock).toHaveBeenCalledWith("/profile/Squad_Mate/reviews/");
    expect(requestMock).toHaveBeenCalledWith("POST", "/profile/squad-mate/review", {
      json: { review_type: 1, text: "" },
    });
  });

  // Names carrying spaces or edge punctuation slugify to something no casing
  // rule produces, which is why the name itself cannot be used.
  it.each([
    ["Trade Partner", "trade-partner"],
    [".Courier.", "courier"],
    ["-Alt-Handle", "alt-handle"],
  ])("resolves %s to %s", async (name, slug) => {
    redirectMock.mockResolvedValueOnce(`${API}/profile/${slug}/reviews/`);
    requestMock.mockResolvedValueOnce({});

    await sendPlusRep(name);
    expect(requestMock).toHaveBeenCalledWith("POST", `/profile/${slug}/review`, {
      json: { review_type: 1, text: "" },
    });
  });

  // A name WFM already serves gets no redirect, so the account route is what
  // separates it from a name WFM has never heard of.
  it("posts to the name itself when WFM confirms it serves that profile", async () => {
    userMock.mockResolvedValueOnce({ data: { slug: "partner_02", ingameName: "partner_02" } });
    requestMock.mockResolvedValueOnce({});

    await expect(sendPlusRep("partner_02")).resolves.toBe("sent");
    expect(userMock).toHaveBeenCalledWith("GET", "/user/partner_02");
    expect(requestMock).toHaveBeenCalledWith("POST", "/profile/partner_02/review", {
      json: { review_type: 1, text: "" },
    });
  });

  it("spends no confirmation call when the redirect already named the slug", async () => {
    redirectMock.mockResolvedValueOnce(`${API}/profile/squad-mate/reviews/`);
    requestMock.mockResolvedValueOnce({});

    await sendPlusRep("Squad_Mate");
    expect(userMock).not.toHaveBeenCalled();
  });

  // The write is outward-facing, so an unconfirmed name is never posted to: a
  // blip that fell back to the raw name would rep a different real user.
  it("refuses to post when the profile lookup fails", async () => {
    userMock.mockRejectedValueOnce(new Error("network down"));

    await expect(sendPlusRep("Squad_Mate")).resolves.toBe("profile-unresolved");
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("refuses to post when the redirect probe is refused outright", async () => {
    redirectMock.mockRejectedValueOnce(new WfmApiError("queue full", "WFM_QUEUE_FULL"));

    await expect(sendPlusRep("Squad_Mate")).resolves.toBe("profile-unresolved");
    expect(requestMock).not.toHaveBeenCalled();
    expect(userMock).not.toHaveBeenCalled();
  });

  it("refuses to post when the confirmed profile carries no slug", async () => {
    userMock.mockResolvedValueOnce({ data: {} });

    await expect(sendPlusRep("partner_02")).resolves.toBe("profile-unresolved");
    expect(requestMock).not.toHaveBeenCalled();
  });

  // The redirect already said the name is not the slug, so there is nothing safe
  // left to write to.
  it("refuses a redirect target that is not a profile slug", async () => {
    redirectMock.mockResolvedValueOnce(`${API}/profile/..%2Fadmin/reviews/`);

    await expect(sendPlusRep("Buyer")).resolves.toBe("profile-unresolved");
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("refuses when the folded slug belongs to a different account", () => {
    userMock.mockResolvedValueOnce({ data: { slug: "buyer", ingameName: "SomeoneElse" } });

    return expect(sendPlusRep("Buyer")).resolves.toBe("user-not-found");
  });

  it("maps a missing profile to user-not-found without posting", async () => {
    await expect(sendPlusRep("NoSuchUser")).resolves.toBe("user-not-found");
    expect(userMock).toHaveBeenCalledWith("GET", "/user/nosuchuser");
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("maps WFM's duplicate-review error", async () => {
    userMock.mockResolvedValueOnce({ data: { slug: "buyer", ingameName: "Buyer" } });
    requestMock.mockRejectedValueOnce(
      new WfmApiError("WFMClient API error: app.review.already_exist", "WFM_API_ERROR", 400),
    );

    await expect(sendPlusRep("Buyer")).resolves.toBe("already-exists");
  });

  // The profile can go away between the lookup and the POST.
  it("maps a 404 on the review itself to user-not-found", async () => {
    userMock.mockResolvedValueOnce({ data: { slug: "buyer", ingameName: "Buyer" } });
    requestMock.mockRejectedValueOnce(new WfmApiError("HTTP 404", "WFM_API_ERROR", 404));

    await expect(sendPlusRep("Buyer")).resolves.toBe("user-not-found");
  });

  it("maps anything else to failed", async () => {
    userMock.mockResolvedValueOnce({ data: { slug: "buyer", ingameName: "Buyer" } });
    requestMock.mockRejectedValueOnce(new Error("network down"));

    await expect(sendPlusRep("Buyer")).resolves.toBe("failed");
  });

  // A slug can go stale between the lookup and the POST, and a POST is never
  // replayed by the transport, so the review layer re-sends it once itself.
  it("re-sends the POST to the slug a 301 on the POST itself points at", async () => {
    redirectMock.mockResolvedValueOnce(`${API}/profile/krakenzer/reviews/`);
    const redirect = new WfmApiError(
      `WFMClient API error: HTTP 301 -> ${API}/profile/krakenzer-2/review`,
      "WFM_API_ERROR",
      301,
    );
    redirect.location = `${API}/profile/krakenzer-2/review`;
    requestMock.mockRejectedValueOnce(redirect).mockResolvedValueOnce({});

    await expect(sendPlusRep("KraKenZer")).resolves.toBe("sent");
    expect(requestMock).toHaveBeenNthCalledWith(1, "POST", "/profile/krakenzer/review", {
      json: { review_type: 1, text: "" },
    });
    expect(requestMock).toHaveBeenNthCalledWith(2, "POST", "/profile/krakenzer-2/review", {
      json: { review_type: 1, text: "" },
    });
  });

  it("does not follow a redirect that leaves the review endpoint", async () => {
    userMock.mockResolvedValueOnce({ data: { slug: "buyer", ingameName: "Buyer" } });
    const redirect = new WfmApiError("HTTP 302", "WFM_API_ERROR", 302);
    redirect.location = "https://warframe.market/login";
    requestMock.mockRejectedValueOnce(redirect);

    await expect(sendPlusRep("Buyer")).resolves.toBe("failed");
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it("refuses an empty partner name without calling WFM", async () => {
    await expect(sendPlusRep("   ")).resolves.toBe("failed");
    expect(requestMock).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
    expect(userMock).not.toHaveBeenCalled();
  });
});

describe("requestRedirectTarget", () => {
  const PROBE = "/profile/Squad_Mate/reviews/";
  const TARGET = `${API}/profile/squad-mate/reviews/`;

  // The suite above mocks the probe away, so the real one is loaded unmocked and
  // driven through the scripted node:https transport.
  let client!: typeof import("../../services/wfmClient");

  beforeAll(async () => {
    client = await vi.importActual<typeof import("../../services/wfmClient")>(
      "../../services/wfmClient",
    );
  });

  beforeEach(() => {
    wire.scripted.length = 0;
    wire.calls.length = 0;
    client.__test__.setClearanceForTest(null, null);
    client.__test__.setChromiumNetForTest(null);
  });

  // WFM sends either form, so both have to resolve to the same target.
  it("resolves an absolute and a same-origin relative Location alike", async () => {
    wire.scripted.push(
      { status: 301, headers: { location: TARGET } },
      { status: 301, headers: { location: "/v1/profile/squad-mate/reviews/" } },
    );

    await expect(client.requestRedirectTarget(PROBE)).resolves.toBe(TARGET);
    await expect(client.requestRedirectTarget(PROBE)).resolves.toBe(TARGET);
  });

  it.each([
    ["cross-origin", "https://evil.example/v1/profile/squad-mate/reviews/"],
    ["protocol-relative", "//evil.example/v1/profile/squad-mate/reviews/"],
    ["off the v1 root", "/v2/profile/squad-mate/reviews/"],
  ])("rejects a %s target", async (_label, location) => {
    wire.scripted.push({ status: 301, headers: { location } });

    await expect(client.requestRedirectTarget(PROBE)).resolves.toBeNull();
  });

  it("returns null when WFM serves the path itself", async () => {
    wire.scripted.push({ status: 200 });

    await expect(client.requestRedirectTarget(PROBE)).resolves.toBeNull();
  });

  // The probe is unauthenticated on purpose: it must not spend the session on a
  // path WFM answers with a redirect anyone can read.
  it("probes with HEAD and carries no credentials", async () => {
    wire.scripted.push({ status: 301, headers: { location: TARGET } });

    await client.requestRedirectTarget(PROBE);

    expect(wire.calls).toHaveLength(1);
    expect(wire.calls[0].method).toBe("HEAD");
    expect(wire.calls[0].path).toBe(`/v1${PROBE}`);
    const sent = Object.keys(wire.calls[0].headers).map((name) => name.toLowerCase());
    expect(sent).not.toContain("authorization");
    expect(sent).not.toContain("cookie");
    expect(sent).not.toContain("auth_type");
  });
});
