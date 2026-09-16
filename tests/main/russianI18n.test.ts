import { describe, expect, it } from "vitest";
import { en } from "../../src/i18n/en.js";
import ru from "../../src/i18n/ru.js";

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{(\w+)\}/g)].map(([, key]) => key).sort();
}

describe("Russian translation catalogue", () => {
  it("covers exactly the English catalogue keys", () => {
    expect(Object.keys(ru).sort()).toEqual(Object.keys(en).sort());
  });

  it("preserves interpolation placeholders", () => {
    const russian = ru as Record<string, string>;
    const mismatches = Object.entries(en).flatMap(([key, source]) => {
      const target = russian[key];
      if (typeof target !== "string") return [key];
      return JSON.stringify(placeholders(source)) === JSON.stringify(placeholders(target))
        ? []
        : [key];
    });

    expect(mismatches).toEqual([]);
  });

  it("keeps copied trade whispers in English", () => {
    const russian = ru as Record<string, string>;
    expect(russian["common.whisperBuy"]).toBe(en["common.whisperBuy"]);
    expect(russian["common.whisperSell"]).toBe(en["common.whisperSell"]);
  });
});
