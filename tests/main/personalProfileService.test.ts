import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  directory: "",
  requests: [] as Array<(body: unknown, status?: number) => void>,
}));
vi.mock("electron", () => ({ app: { getPath: () => mocks.directory } }));
vi.mock("../../services/logger", () => ({ withScope: () => ({ info: vi.fn(), warn: vi.fn() }) }));
vi.mock("node:https", () => ({
  default: {
    get: (
      _url: string,
      _options: unknown,
      callback: (response: EventEmitter & { statusCode: number; resume: () => void }) => void,
    ) => {
      const req = Object.assign(new EventEmitter(), { setTimeout: vi.fn(), destroy: vi.fn() });
      mocks.requests.push((body, status = 200) => {
        const response = Object.assign(new EventEmitter(), { statusCode: status, resume: vi.fn() });
        callback(response);
        response.emit("data", Buffer.from(JSON.stringify(body)));
        response.emit("end");
      });
      return req;
    },
  },
}));

const accountA = "a".repeat(24);
const accountB = "b".repeat(24);
const payload = (time: number) => ({
  Results: [{ DisplayName: "Fixture Tenno", PlayerLevel: 12 }],
  Stats: { TimePlayedSec: time, Scans: [{ type: "/Lotus/FixtureEnemy", scans: 2 }] },
});
const load = () => import("../../services/codexProfile");

beforeEach(() => {
  vi.resetModules();
  mocks.directory = fs.mkdtempSync(path.join(os.tmpdir(), "wfh-profile-service-"));
  mocks.requests = [];
  vi.spyOn(Date, "now").mockReturnValue(1800000000000);
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(mocks.directory, { recursive: true, force: true });
});

describe("personal profile service", () => {
  it("waits for a known account and a manual refresh", async () => {
    const service = await load();
    expect((await service.getPersonalProfile()).status).toBe("no-account");
    service.noteAuthz(`?accountId=${accountA}&nonce=1`);
    expect((await service.getPersonalProfile()).status).toBe("no-data");
    expect(mocks.requests).toHaveLength(0);
  });

  it("shares a profile request with Codex and persists only normalized personal data", async () => {
    const service = await load();
    service.noteAuthz(`?accountId=${accountA}&nonce=1`);
    const personal = service.getPersonalProfile(true);
    const codex = service.getCodexScans(true);
    expect(mocks.requests).toHaveLength(1);
    mocks.requests[0]({ ...payload(3600), SecretField: "do-not-cache" });
    expect((await personal).profile?.career.TimePlayedSec).toBe(3600);
    expect(await codex).toMatchObject({ scans: [{ type: "/Lotus/FixtureEnemy", count: 2 }] });
    const disk = fs.readFileSync(path.join(mocks.directory, "personal-profile.json"), "utf8");
    expect(disk).not.toContain("do-not-cache");
    vi.resetModules();
    expect((await (await load()).getPersonalProfile()).profile?.career.TimePlayedSec).toBe(3600);
    expect(mocks.requests).toHaveLength(1);
  });

  it("retains an old snapshot and exposes refresh failure without extending its timestamp", async () => {
    const service = await load();
    service.noteAuthz(`?accountId=${accountA}&nonce=1`);
    const first = service.getPersonalProfile(true);
    mocks.requests[0](payload(3600));
    const original = await first;
    vi.mocked(Date.now).mockReturnValue(1800000061000);
    const refresh = service.getPersonalProfile(true);
    mocks.requests[1]({}, 503);
    const result = await refresh;
    expect(result).toMatchObject({
      status: "fetch-failed",
      fetchedAt: original.fetchedAt,
      profile: original.profile,
    });
    expect((await service.getPersonalProfile(true)).status).toBe("fetch-failed");
    expect(mocks.requests).toHaveLength(2);
  });

  it("clears an obsolete failure after a successful shared Codex refresh", async () => {
    const service = await load();
    service.noteAuthz(`?accountId=${accountA}&nonce=1`);
    const first = service.getPersonalProfile(true);
    mocks.requests[0](payload(3600));
    await first;
    vi.mocked(Date.now).mockReturnValue(1800000061000);
    const failed = service.getPersonalProfile(true);
    mocks.requests[1]({}, 503);
    expect((await failed).status).toBe("fetch-failed");
    vi.mocked(Date.now).mockReturnValue(1800000122000);
    const codex = service.getCodexScans(true);
    mocks.requests[2](payload(7200));
    await codex;
    expect(await service.getPersonalProfile()).toMatchObject({
      status: "ready",
      fetchedAt: 1800000122000,
      profile: { career: { TimePlayedSec: 7200 } },
    });
  });

  it("does not publish or persist an old account's in-flight response", async () => {
    const service = await load();
    service.noteAuthz(`?accountId=${accountA}&nonce=1`);
    const first = service.getPersonalProfile(true);
    service.noteAuthz(`?accountId=${accountB}&nonce=1`);
    const second = service.getPersonalProfile(true);
    mocks.requests[1](payload(7200));
    expect((await second).profile?.career.TimePlayedSec).toBe(7200);
    mocks.requests[0](payload(3600));
    expect(await first).toMatchObject({ status: "account-changed", profile: null });
    expect((await service.getPersonalProfile()).profile?.career.TimePlayedSec).toBe(7200);
    expect(
      JSON.parse(fs.readFileSync(path.join(mocks.directory, "personal-profile.json"), "utf8"))
        .accountId,
    ).toBe(accountB);
  });

  it("rejects a disk snapshot for a different account", async () => {
    const service = await load();
    service.noteAuthz(`?accountId=${accountA}&nonce=1`);
    const first = service.getPersonalProfile(true);
    mocks.requests[0](payload(3600));
    await first;
    service.noteAuthz(`?accountId=${accountB}&nonce=1`);
    expect(await service.getPersonalProfile()).toMatchObject({
      status: "no-data",
      profile: null,
      fetchedAt: null,
    });
  });
});
