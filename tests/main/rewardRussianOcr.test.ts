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
  localizedNameFields: (uniqueName: string, english: string) => ({
    displayName: localizedByUniqueName[uniqueName] || english,
  }),
}));

import { canonicalizeRussianRewardText } from "../../services/rewardRussianOcr";
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

  it("maps an exact official Russian reward name back to the canonical market name", () => {
    expect(canonicalizeRussianRewardText("Ствол Братон Прайм", items)).toBe("Braton Prime Barrel");
  });

  it("normalizes ё/е differences", () => {
    expect(canonicalizeRussianRewardText("Чертёж Формы", items)).toBe("Forma Blueprint");
  });

  it("canonicalizes a wrapped two-line reward from a whole-card OCR read", () => {
    expect(canonicalizeRussianRewardText("Нижнее Плечо\nПарис Прайм", items)).toBe(
      "Paris Prime Lower Limb",
    );
  });

  it("tolerates a small OCR error when one candidate is clearly best", () => {
    expect(canonicalizeRussianRewardText("Нижнее Плечо Парис Праим", items)).toBe(
      "Paris Prime Lower Limb",
    );
  });

  it("leaves unrelated text untouched instead of inventing a reward", () => {
    expect(canonicalizeRussianRewardText("совсем другой текст", items)).toBe("совсем другой текст");
  });
});
