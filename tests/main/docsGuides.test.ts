import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { VIEW_NAMES } from "../../src/types/views.js";

// Mirrors the rules of the wfhelper.com docs generator, which lives in a private
// repo, so a guide that would break the site build fails here first.
const GUIDES_DIR = path.resolve(__dirname, "../../docs/features");
const GROUPS = ["Start here", "Features", "Overlays", "Help"];
const REQUIRED = [
  "title",
  "summary",
  "group",
  "version",
  "screenshot",
  "screenshotAlt",
  "screenshotCaption",
];

interface Guide {
  slug: string;
  meta: Record<string, string>;
  body: string;
  ids: Set<string>;
}

function parseFrontMatter(raw: string): { meta: Record<string, string>; body: string } | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]+)$/.exec(raw);
  if (!match) return null;
  const meta: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const entry = /^([A-Za-z]+):\s*(.*)$/.exec(line);
    if (!entry) return null;
    meta[entry[1]] = entry[2].replace(/^"(.*)"$/, "$1").trim();
  }
  return { meta, body: match[2] };
}

function headingIds(body: string): Set<string> {
  const ids = new Set<string>();
  for (const line of body.split("\n")) {
    const heading = /^#{2,6}\s+(.+?)\s*$/.exec(line);
    if (!heading) continue;
    const base =
      heading[1]
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "section";
    let id = base;
    for (let n = 2; ids.has(id); n++) id = `${base}-${n}`;
    ids.add(id);
  }
  return ids;
}

function withoutCode(body: string): string {
  return body.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
}

const guides: Guide[] = fs
  .readdirSync(GUIDES_DIR)
  .filter((name) => name.endsWith(".md") && name !== "README.md")
  .sort()
  .map((name) => {
    const parsed = parseFrontMatter(fs.readFileSync(path.join(GUIDES_DIR, name), "utf8"));
    if (!parsed) throw new Error(`${name}: missing front matter or content`);
    return {
      slug: path.basename(name, ".md"),
      meta: parsed.meta,
      body: parsed.body,
      ids: headingIds(parsed.body),
    };
  });

describe("docs/features guides", () => {
  it("has at least one guide", () => {
    expect(guides.length).toBeGreaterThan(0);
  });

  it.each(guides.map((guide) => [guide.slug, guide] as const))("%s is valid", (_slug, guide) => {
    expect(guide.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(guide.slug).not.toBe("index");
    for (const field of REQUIRED) expect(guide.meta[field], field).toBeTruthy();
    expect(GROUPS).toContain(guide.meta.group);
    expect(Number.isFinite(Number(guide.meta.order)), "order").toBe(true);
    expect(guide.meta.screenshot).toMatch(/^[a-zA-Z0-9_-]+\.(png|webp|jpg)$/);
    if (guide.meta.view !== undefined) expect(VIEW_NAMES).toContain(guide.meta.view);

    const text = withoutCode(guide.body);
    expect(text, "the title comes from front matter; start at h2").not.toMatch(/^#\s/m);
    expect(guide.ids.size, "add at least one section").toBeGreaterThan(0);
    expect(text, "raw HTML is not supported").not.toMatch(/<[a-zA-Z!/]/);
    expect(text, "use the front-matter screenshot, not inline images").not.toContain("![");

    for (const [, href] of text.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      expect(href, `unsupported link ${href}`).toMatch(/^(#|\/(?!\/)|https?:\/\/)/);
      if (href.startsWith("#")) {
        expect(guide.ids.has(href.slice(1)), `broken anchor ${href}`).toBe(true);
      } else if (href.startsWith("/docs/")) {
        const [slug, hash] = href.slice("/docs/".length).split("#");
        const target = guides.find((other) => other.slug === slug);
        expect(target, `broken docs link ${href}`).toBeDefined();
        if (hash) expect(target?.ids.has(hash), `broken docs anchor ${href}`).toBe(true);
      }
    }
  });
});
