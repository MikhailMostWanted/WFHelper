import { describe, expect, it } from "vitest";

// @ts-expect-error -- plain build script module, no type declarations
import { buildMessages as buildUntyped } from "../../scripts/announce-release.mjs";

interface Message {
  content: string;
  allowedMentions: { roles: string[] } | { parse: never[] };
}
const buildMessages: (input: {
  title: string;
  tag: string;
  url: string;
  body: string;
  roleId: string;
}) => Message[] = buildUntyped;

const URL = "https://github.com/MikhailMostWanted/WFHelper/releases/tag/v2.0.0";
const base = { title: "v2.0.0", tag: "v2.0.0", url: URL, roleId: "" };
const HEADER = `## [WantedFrame v2.0.0](${URL}) is out 🎉\n`;
const FOOTER = `\n-# [Release notes](${URL}) · Download from GitHub Releases`;

function sections(count: number, bullets: number): string {
  return Array.from(
    { length: count },
    (_, s) =>
      `### Section ${s}\n` +
      Array.from({ length: bullets }, (_, i) => `- change ${s}.${i} with a few words`).join("\n"),
  ).join("\n\n");
}

describe("buildMessages", () => {
  it("posts a short changelog as one message with header and footer", () => {
    const messages = buildMessages({ ...base, body: "### Added\n- one thing\n" });
    expect(messages).toEqual([
      {
        content: `${HEADER}### Added\n- one thing${FOOTER}`,
        allowedMentions: { parse: [] },
      },
    ]);
  });

  it("falls back to the title tag and a stock line when the body is empty", () => {
    const [message] = buildMessages({ ...base, title: "", body: "" });
    expect(message.content).toContain("[WantedFrame v2.0.0]");
    expect(message.content).toContain("A new version of WantedFrame is available");
  });

  it("splits a long body at blank lines and keeps every post under the cap", () => {
    const body = sections(12, 15);
    const messages = buildMessages({ ...base, body });
    expect(messages.length).toBeGreaterThan(1);
    for (const message of messages) expect(message.content.length).toBeLessThanOrEqual(2000);
    expect(messages[0].content.startsWith(HEADER)).toBe(true);
    expect(messages.at(-1)?.content.endsWith(FOOTER)).toBe(true);
    for (const message of messages.slice(1)) {
      expect(message.content.startsWith("### Section ")).toBe(true);
    }
    const parts = messages.map((message) =>
      message.content.replace(HEADER, "").replace(FOOTER, ""),
    );
    expect(parts.join("\n\n")).toBe(body);
  });

  it("pings the role only in the first post", () => {
    const messages = buildMessages({ ...base, roleId: "123", body: sections(12, 15) });
    expect(messages[0].content).toContain("<@&123>");
    expect(messages[0].allowedMentions).toEqual({ roles: ["123"] });
    for (const message of messages.slice(1)) {
      expect(message.content).not.toContain("<@&");
      expect(message.allowedMentions).toEqual({ parse: [] });
    }
  });

  it("normalises CRLF and caps a runaway body at ten posts with a link", () => {
    const body = Array.from({ length: 1200 }, (_, i) => `- synthetic changelog line ${i}`).join(
      "\r\n",
    );
    const messages = buildMessages({ ...base, body });
    expect(messages).toHaveLength(10);
    expect(messages.some((message) => message.content.includes("\r"))).toBe(false);
    const last = messages.at(-1)?.content ?? "";
    expect(last).toContain(`**[Full changelog →](${URL})**`);
    expect(last.endsWith(FOOTER)).toBe(true);
    expect(last.length).toBeLessThanOrEqual(2000);
  });

  it("hard-cuts a single line longer than the cap instead of failing", () => {
    const messages = buildMessages({ ...base, body: "x".repeat(4500) });
    expect(messages.length).toBe(3);
    for (const message of messages) expect(message.content.length).toBeLessThanOrEqual(2000);
  });
});
