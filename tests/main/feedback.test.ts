import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FEEDBACK_LIMITS, normalizeFeedback } from "../../config/shared/feedback";
import { FEEDBACK_CONTEXT, FEEDBACK_SUBMIT } from "../../config/shared/ipcChannels";
import { register } from "../../ipc/feedbackIpc";

const mocks = vi.hoisted(() => ({
  handleAuthorized: vi.fn(),
  assertMainRendererSender: vi.fn(),
  getVersion: vi.fn(() => "2.0.0-test"),
  logPath: null as string | null,
}));
vi.mock("electron", () => ({ app: { getVersion: mocks.getVersion } }));
vi.mock("../../services/logger", () => ({ getLogFilePath: () => mocks.logPath }));
vi.mock("../../ipc/ipcSecurity", () => ({
  handleAuthorized: mocks.handleAuthorized,
  assertMainRendererSender: mocks.assertMainRendererSender,
}));

const report = {
  kind: "bug",
  title: " Reward value is missing ",
  description: " Reopen the reward preview after changing scale. ",
  appVersion: "1.0.0",
  platform: "win32",
};
const diagnostics = {
  osVersion: "test OS",
  arch: "test architecture",
  locale: "en",
  view: "settings",
  uiScale: 1,
};
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=";

describe("feedback payload validation", () => {
  it("keeps only reviewed report fields and optional diagnostic details", () => {
    expect(
      normalizeFeedback({
        ...report,
        contact: " tester ",
        accountToken: "secret",
        logs: "private logs",
        diagnostics: { ...diagnostics, inventory: "private inventory", username: "account" },
        screenshot: { mediaType: "image/png", data: png, path: "C:/Users/private/image.png" },
      }),
    ).toEqual({
      ...report,
      title: report.title.trim(),
      description: report.description.trim(),
      contact: "tester",
      diagnostics,
      screenshot: { mediaType: "image/png", data: png },
    });
  });

  it("keeps a bounded log tail inside diagnostics and drops an empty one", () => {
    const log = "line 1\nline 2\n";
    expect(
      normalizeFeedback({ ...report, diagnostics: { ...diagnostics, log } })?.diagnostics,
    ).toEqual({ ...diagnostics, log });
    expect(
      normalizeFeedback({ ...report, diagnostics: { ...diagnostics, log: "" } })?.diagnostics,
    ).toEqual(diagnostics);
    expect(
      normalizeFeedback({ ...report, diagnostics: { ...diagnostics, log: ["line"] } }),
    ).toBeNull();
    expect(
      normalizeFeedback({
        ...report,
        diagnostics: { ...diagnostics, log: "x".repeat(FEEDBACK_LIMITS.logChars + 1) },
      }),
    ).toBeNull();
  });

  it("does not add optional data when none was selected", () => {
    const normalized = normalizeFeedback({ ...report, kind: "feature" });
    expect(normalized?.kind).toBe("feature");
    expect(normalized).not.toHaveProperty("contact");
    expect(normalized).not.toHaveProperty("diagnostics");
    expect(normalized).not.toHaveProperty("screenshot");
  });

  it.each([
    null,
    [],
    {},
    { ...report, kind: "other" },
    { ...report, title: " " },
    { ...report, description: 12 },
    { ...report, contact: " " },
    { ...report, title: "x".repeat(FEEDBACK_LIMITS.title + 1) },
    { ...report, description: "x".repeat(FEEDBACK_LIMITS.description + 1) },
    { ...report, contact: "x".repeat(FEEDBACK_LIMITS.contact + 1) },
  ])("rejects incomplete or oversized reports (%#)", (raw) => {
    expect(normalizeFeedback(raw)).toBeNull();
  });

  it.each([NaN, Infinity, 0, 4.01, "1"])("rejects invalid diagnostic scale %s", (uiScale) => {
    expect(normalizeFeedback({ ...report, diagnostics: { ...diagnostics, uiScale } })).toBeNull();
  });

  it.each([
    { mediaType: "image/jpeg", data: png },
    { mediaType: "image/svg+xml", data: Buffer.from("<svg></svg>").toString("base64") },
    { mediaType: "image/png", data: "not base64!!" },
    {
      mediaType: "image/png",
      data: "A".repeat(Math.ceil(FEEDBACK_LIMITS.screenshotBytes / 3) * 4 + 4),
    },
  ])("rejects mismatched, unsupported, malformed or oversized screenshots (%#)", (screenshot) => {
    expect(normalizeFeedback({ ...report, screenshot })).toBeNull();
  });
});

describe("feedback submission IPC", () => {
  const request = vi.fn<typeof fetch>();
  let submit: (_event: unknown, raw: unknown) => Promise<unknown>;

  beforeEach(() => {
    mocks.handleAuthorized.mockClear();
    mocks.logPath = null;
    request.mockReset();
    vi.stubGlobal("fetch", request);
    register();
    submit = mocks.handleAuthorized.mock.calls.find(([channel]) => channel === FEEDBACK_SUBMIT)![2];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("guards both endpoints and exposes app metadata without optional user data", () => {
    expect(mocks.handleAuthorized.mock.calls.map(([channel, guard]) => [channel, guard])).toEqual([
      [FEEDBACK_CONTEXT, mocks.assertMainRendererSender],
      [FEEDBACK_SUBMIT, mocks.assertMainRendererSender],
    ]);
    const context = mocks.handleAuthorized.mock.calls.find(
      ([channel]) => channel === FEEDBACK_CONTEXT,
    )![2];
    expect(context()).toEqual({
      appVersion: "2.0.0-test",
      platform: process.platform,
      diagnostics: { osVersion: os.release(), arch: process.arch },
    });
  });

  it("rejects invalid input without contacting the relay", async () => {
    expect(await submit(null, { ...report, description: "" })).toEqual({
      ok: false,
      error: "invalid",
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("uses trusted app metadata and enforces the successful-send cooldown", async () => {
    vi.useFakeTimers();
    request.mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    expect(await submit(null, { ...report, diagnostics })).toEqual({ ok: true });
    const [url, init] = request.mock.calls[0]!;
    expect(String(url)).toMatch(/\/v1\/feedback$/);
    expect(init).toMatchObject({
      method: "POST",
      redirect: "error",
      signal: expect.any(AbortSignal),
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      ...report,
      title: report.title.trim(),
      description: report.description.trim(),
      appVersion: "2.0.0-test",
      platform: process.platform,
      diagnostics: { ...diagnostics, osVersion: os.release(), arch: process.arch },
    });
    expect(await submit(null, report)).toEqual({ ok: false, error: "rate_limited" });
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_001);
    request.mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    expect(await submit(null, report)).toEqual({ ok: true });
  });

  it("attaches the newest lines of main.log when diagnostics are included", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wfh-feedback-"));
    mocks.logPath = path.join(dir, "main.log");
    const lines = Array.from({ length: 6000 }, (_, i) => `line ${i} ${"x".repeat(60)}`);
    fs.writeFileSync(mocks.logPath, lines.join("\n") + "\n");
    request.mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    try {
      expect(
        await submit(null, { ...report, diagnostics: { ...diagnostics, log: "spoofed" } }),
      ).toEqual({ ok: true });
      const sent = JSON.parse(String(request.mock.calls[0]![1]?.body)).diagnostics.log;
      expect(sent.length).toBeLessThanOrEqual(FEEDBACK_LIMITS.logChars);
      expect(sent.startsWith("line ")).toBe(true);
      expect(sent.endsWith(`${lines[lines.length - 1]}\n`)).toBe(true);
      expect(sent).not.toContain("spoofed");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("sends diagnostics without a log when the log file is unreadable", async () => {
    request.mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    mocks.logPath = path.join(os.tmpdir(), "wfh-feedback-missing", "main.log");
    expect(await submit(null, { ...report, diagnostics })).toEqual({ ok: true });
    expect(JSON.parse(String(request.mock.calls[0]![1]?.body)).diagnostics).not.toHaveProperty(
      "log",
    );
  });

  it("rejects a concurrent send and permits an explicit retry after failure", async () => {
    let finish!: (response: Response) => void;
    request.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
    );
    const first = submit(null, report);
    expect(await submit(null, report)).toEqual({ ok: false, error: "rate_limited" });
    finish(new Response("unavailable", { status: 503 }));
    expect(await first).toEqual({ ok: false, error: "unavailable" });
    expect(request).toHaveBeenCalledTimes(1);
    request.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true })));
    expect(await submit(null, report)).toEqual({ ok: true });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it.each([
    [400, "invalid"],
    [413, "invalid"],
    [404, "unavailable"],
    [503, "unavailable"],
    [429, "rate_limited"],
    [500, "failed"],
  ] as const)("maps HTTP %s without retrying", async (status, error) => {
    request.mockResolvedValue(new Response("relay error", { status }));
    expect(await submit(null, report)).toEqual({ ok: false, error });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each(["not json", JSON.stringify({ ok: false }), JSON.stringify(null)])(
    "requires a relay acknowledgment (%#)",
    async (body) => {
      request.mockResolvedValue(new Response(body));
      expect(await submit(null, report)).toEqual({ ok: false, error: "failed" });
      expect(request).toHaveBeenCalledTimes(1);
    },
  );

  it("does not retry a network failure that could have delivered the feedback", async () => {
    request.mockRejectedValue(new Error("connection closed"));
    expect(await submit(null, report)).toEqual({ ok: false, error: "failed" });
    expect(request).toHaveBeenCalledTimes(1);
  });
});
