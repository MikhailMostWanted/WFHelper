import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../services/gameLocale", () => ({
  getGameLocale: () => "ru",
}));

const localizedByUniqueName: Record<string, string> = {
  "/Lotus/Test/ParisPrimeLowerLimb": "Нижнее Плечо Парис Прайм",
  "/Lotus/Test/BratonPrimeBarrel": "Ствол Братон Прайм",
  "/Lotus/Test/FormaBlueprint": "Чертеж Формы",
};

vi.mock("../../services/itemDatabase", () => ({
  localizedNameFields: vi.fn((uniqueName: string, english: string) => ({
    displayName: localizedByUniqueName[uniqueName] || english,
  })),
}));

import * as itemDatabase from "../../services/itemDatabase";
import {
  canonicalizeRussianRewardTextForTest,
  localizeMatchedRewardDisplayNames,
  resolveRussianRewardText,
} from "../../services/rewardRussianOcr";
import type { SortedItem } from "../../services/rewardScannerMatch";

const items: SortedItem[] = [
  {
    name: "Paris Prime Lower Limb",
    uniqueName: "/Lotus/Test/ParisPrimeLowerLimb",
    urlName: "paris_prime_lower_limb",
  },
  {
    name: "Braton Prime Barrel",
    uniqueName: "/Lotus/Test/BratonPrimeBarrel",
    urlName: "braton_prime_barrel",
  },
  {
    name: "Forma Blueprint",
    uniqueName: "/Lotus/Test/FormaBlueprint",
    urlName: "forma_blueprint",
  },
];

describe("Russian relic reward OCR bridge", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps canonical names as join keys and puts Russian text only in displayName", () => {
    const [localized] = localizeMatchedRewardDisplayNames([items[1]]);

    expect(localized.name).toBe("Braton Prime Barrel");
    expect(localized.displayName).toBe("Ствол Братон Прайм");
    expect(localized.urlName).toBe("braton_prime_barrel");
  });

  it("maps an exact official Russian reward name back to the canonical market name", () => {
    expect(canonicalizeRussianRewardTextForTest("Ствол Братон Прайм", items)).toBe(
      "Braton Prime Barrel",
    );
  });

  it("normalizes ё/е differences", () => {
    expect(canonicalizeRussianRewardTextForTest("Чертёж Формы", items)).toBe("Forma Blueprint");
  });

  it("canonicalizes a wrapped two-line reward from a whole-card OCR read", () => {
    expect(canonicalizeRussianRewardTextForTest("Нижнее Плечо\nПарис Прайм", items)).toBe(
      "Paris Prime Lower Limb",
    );
  });

  it("tolerates a small OCR error when one candidate is clearly best", () => {
    expect(canonicalizeRussianRewardTextForTest("Нижнее Плечо Парис Праим", items)).toBe(
      "Paris Prime Lower Limb",
    );
  });

  it("repairs Latin lookalikes inside otherwise Cyrillic OCR words", () => {
    expect(canonicalizeRussianRewardTextForTest("Нижнее Плечо Пaрис Пpайм", items)).toBe(
      "Paris Prime Lower Limb",
    );
  });

  it("reports weak fuzzy resolutions so the slot reader can retry adaptively", () => {
    const resolution = resolveRussianRewardText("Нижн Плечо Парис Прай", items);
    expect(resolution.text).toBe("Paris Prime Lower Limb");
    expect(resolution.matchMode).toBe("fuzzy");
    expect(resolution.matchConfidence).toBeGreaterThanOrEqual(0.7);
    expect(resolution.matchConfidence).toBeLessThan(0.9);
  });

  it("caches the localized candidate index for repeated reads of the same item list", () => {
    const localizedNameFields = vi.mocked(itemDatabase.localizedNameFields);
    const freshItems = items.map((item) => ({ ...item }));
    localizedNameFields.mockClear();

    canonicalizeRussianRewardTextForTest("Ствол Братон Прайм", freshItems);
    canonicalizeRussianRewardTextForTest("Чертёж Формы", freshItems);

    expect(localizedNameFields).toHaveBeenCalledTimes(freshItems.length);
  });

  it("leaves unrelated text untouched instead of inventing a reward", () => {
    expect(canonicalizeRussianRewardTextForTest("совсем другой текст", items)).toBe(
      "совсем другой текст",
    );
  });
});
