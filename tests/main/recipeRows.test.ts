import { describe, expect, it } from "vitest";

import { mergeDuplicateIngredients } from "../../config/shared/recipeRows";

interface Row {
  uniqueName?: string;
  itemCount?: number;
  label: string;
}

const merge = (rows: Row[]) =>
  mergeDuplicateIngredients(
    rows,
    (row) => row.itemCount,
    (row, itemCount) => ({ ...row, itemCount }),
  );

describe("mergeDuplicateIngredients", () => {
  it("sums doubled rows into the first one and keeps its position", () => {
    const rows = merge([
      { uniqueName: "/a", label: "first" },
      { uniqueName: "/b", itemCount: 1, label: "b" },
      { uniqueName: "/a", itemCount: 1, label: "second" },
    ]);
    expect(rows).toEqual([
      { uniqueName: "/a", itemCount: 2, label: "first" },
      { uniqueName: "/b", itemCount: 1, label: "b" },
    ]);
  });

  it("reads a missing or zero count as one", () => {
    expect(merge([{ uniqueName: "/a", itemCount: 0, label: "x" }])[0]?.itemCount).toBe(1);
    expect(merge([{ uniqueName: "/a", label: "x" }])[0]?.itemCount).toBe(1);
  });

  it("leaves rows without a uniqueName alone", () => {
    const rows = merge([{ label: "n1" }, { label: "n2" }]);
    expect(rows.map((row) => row.label)).toEqual(["n1", "n2"]);
  });

  it("does not mutate the input rows", () => {
    const input = [
      { uniqueName: "/a", itemCount: 1, label: "a" },
      { uniqueName: "/a", itemCount: 3, label: "a" },
    ];
    merge(input);
    expect(input[0]?.itemCount).toBe(1);
  });
});
