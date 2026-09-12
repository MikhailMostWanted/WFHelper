import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { WIKI_ITEM_ART } from "../../../config/shared/wikiItemArt.js";
import { archonShardUniqueName } from "../../../src/lib/inventory/archonShards.js";
import type { ArchonShardColor } from "../../../src/lib/inventory/archonShards.js";

const COLORS: readonly ArchonShardColor[] = [
  "crimson",
  "amber",
  "azure",
  "emerald",
  "topaz",
  "violet",
];

const QUEUE: string[] = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "scripts/icon-mirror/wiki-item-art.json"), "utf-8"),
);

const SEPARATORS = /[\\/]/;
const IMAGE_EXTENSION = /\.(png|jpe?g|gif|webp)$/i;

describe("wiki item art overrides", () => {
  // The uniqueName is built in one place for the inventory parse and repeated by
  // hand in the map, so a DE rename would otherwise silently drop the override.
  it("covers every tauforged archon shard and nothing else", () => {
    const expected = COLORS.map((color) => archonShardUniqueName(color, true)).sort();

    expect(Object.keys(WIKI_ITEM_ART).sort()).toEqual(expected);
  });

  it("names files the mirror is actually told to fetch", () => {
    const queued = new Set(QUEUE.map((file) => file.replace(/\.[a-z0-9]+$/i, "")));
    const unmirrored = Object.values(WIKI_ITEM_ART).filter((stem) => !queued.has(stem));

    expect(unmirrored).toEqual([]);
  });

  it("names files that cannot escape the mirror directory", () => {
    const unsafe = Object.entries(WIKI_ITEM_ART).filter(
      ([, stem]) =>
        !stem ||
        stem.length > 120 ||
        SEPARATORS.test(stem) ||
        stem.includes("..") ||
        IMAGE_EXTENSION.test(stem) ||
        [...stem].some((char) => char.charCodeAt(0) <= 31),
    );

    expect(unsafe).toEqual([]);
  });
});
