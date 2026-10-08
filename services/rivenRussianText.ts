import lexicon from "../config/shared/rivenRussianLexicon.json";
import type { RivenStat } from "../ipc/overlay/rivenScanText";

function normalize(text: string): string {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/<[^>]*>/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\S+/g, (word) =>
      /[а-яё]/.test(word)
        ? word.replace(
            /[aceopxy]/g,
            (letter) =>
              (
                ({ a: "а", c: "с", e: "е", o: "о", p: "р", x: "х", y: "у" }) as Record<
                  string,
                  string
                >
              )[letter] || letter,
          )
        : word,
    )
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}
const names = new Map<string, Set<string>>();
for (const entry of lexicon) {
  const key = normalize(entry.russian);
  const values = names.get(key) ?? new Set<string>();
  values.add(entry.english);
  names.set(key, values);
}
/** Exact DE label matching. Unknown labels and unreadable numbers stay unknown. */
export function parseRussianRivenStats(raw: string): { stats: RivenStat[]; unresolved: string[] } {
  const stats: RivenStat[] = [];
  const unresolved: string[] = [];
  const blocks: string[] = [];
  const signed = /^[+\-−–xх×]\s*\d/i;
  for (const line of raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)) {
    if (signed.test(line)) blocks.push(line);
    else if (blocks.length) {
      const current = blocks[blocks.length - 1];
      const tail = current.replace(/^[+\-−–xх×]\s*\d+(?:[.,]\s*\d+)?\s*(?:%|[сsм](?=\s))?\s*/i, "");
      if (!names.has(normalize(tail)) && !/\d/.test(line)) blocks[blocks.length - 1] += " " + line;
    }
  }
  const seen = new Set<string>();
  for (const block of blocks) {
    const match = /^([+\-−–xх×])\s*(\d+(?:[.,]\s*\d+)?)\s*(?:%|[сsм](?=\s))?\s*(.+)$/i.exec(block);
    if (!match) {
      unresolved.push(block);
      continue;
    }
    const candidates = names.get(normalize(match[3]));
    const name = candidates?.size === 1 ? [...candidates][0] : null;
    const value = Number(match[2].replace(/\s/g, "").replace(",", "."));
    if (!name || !Number.isFinite(value) || value > 100_000 || seen.has(name)) {
      unresolved.push(block);
      continue;
    }
    seen.add(name);
    const multiplier = /^[xх×]$/i.test(match[1]);
    const displayPositive = multiplier ? value >= 1 : match[1] === "+";
    const positive = name === "Weapon Recoil" ? !displayPositive : displayPositive;
    stats.push({
      name,
      value,
      positive,
      displayPositive,
      ...(multiplier ? { multiplier: true } : {}),
    });
  }
  return { stats, unresolved };
}
