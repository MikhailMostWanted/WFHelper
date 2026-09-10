import { describe, expect, it } from "vitest";

import { dropIndex, resolveDropTarget } from "../../../../src/lib/layout/drag.js";
import { moveSectionInList } from "../../../../src/lib/layout/plan.js";
import type { SectionState } from "../../../../src/lib/layout/types.js";

interface Drag {
  id: string;
  scope: readonly string[] | null;
  lastCell: string | null;
}

function drag(patch: Partial<Drag> = {}): Drag {
  return { id: "world.darvo", scope: null, lastCell: null, ...patch };
}

function hit(id: string, after = false): { id: string; after: boolean } {
  return { id, after };
}

describe("resolveDropTarget", () => {
  it("takes a section the pointer has not dropped on yet", () => {
    expect(resolveDropTarget(drag(), hit("world.cycles"), true)).toEqual({
      targetId: "world.cycles",
      after: false,
      lastCell: "world.cycles|before",
    });
  });

  it("drops under a section the pointer is in the lower half of", () => {
    expect(resolveDropTarget(drag(), hit("world.cycles", true), true)).toEqual({
      targetId: "world.cycles",
      after: true,
      lastCell: "world.cycles|after",
    });
  });

  it("ignores a pointer that is over nothing", () => {
    expect(resolveDropTarget(drag({ lastCell: "world.cycles|before" }), null, true)).toEqual({
      targetId: null,
      after: false,
      lastCell: "world.cycles|before",
    });
  });

  it("forgets the last cell when the pointer is back over the dragged section", () => {
    // The move puts the dragged section under the pointer, so the cell it came
    // from has to become droppable again or a drag can only ever move once.
    expect(
      resolveDropTarget(drag({ lastCell: "world.cycles|before" }), hit("world.darvo"), true),
    ).toEqual({ targetId: null, after: false, lastCell: null });
  });

  it("commits once while the pointer stays on the same cell", () => {
    expect(
      resolveDropTarget(drag({ lastCell: "world.cycles|before" }), hit("world.cycles"), true),
    ).toEqual({ targetId: null, after: false, lastCell: "world.cycles|before" });
  });

  it("treats the other half of the same section as a fresh cell", () => {
    expect(
      resolveDropTarget(drag({ lastCell: "world.cycles|before" }), hit("world.cycles", true), true),
    ).toEqual({ targetId: "world.cycles", after: true, lastCell: "world.cycles|after" });
  });

  it("ignores a hit that belongs to another grid", () => {
    expect(resolveDropTarget(drag(), hit("world.dailies"), false)).toEqual({
      targetId: null,
      after: false,
      lastCell: null,
    });
  });

  it("ignores a section this screen does not render", () => {
    const scoped = drag({ scope: ["world.darvo", "world.cycles"] });
    expect(resolveDropTarget(scoped, hit("world.arbiSchedule"), true)).toEqual({
      targetId: null,
      after: false,
      lastCell: null,
    });
    expect(resolveDropTarget(scoped, hit("world.cycles"), true)).toEqual({
      targetId: "world.cycles",
      after: false,
      lastCell: "world.cycles|before",
    });
  });
});

describe("dropIndex", () => {
  const order = ["a", "b", "c", "d"];

  it("lands before a target the pointer is in the upper half of", () => {
    expect(dropIndex(order, "d", "b", false)).toBe(1);
    expect(dropIndex(order, "a", "c", false)).toBe(1);
  });

  it("lands after a target the pointer is in the lower half of", () => {
    expect(dropIndex(order, "d", "b", true)).toBe(2);
    expect(dropIndex(order, "a", "c", true)).toBe(2);
  });

  it("reports a drop that changes nothing", () => {
    // Upper half of the next section down, and lower half of the one above:
    // both mean "stay where you are".
    expect(dropIndex(order, "a", "b", false)).toBeNull();
    expect(dropIndex(order, "b", "a", true)).toBeNull();
  });

  it("ignores an id the list does not hold", () => {
    expect(dropIndex(order, "zz", "b", false)).toBeNull();
    expect(dropIndex(order, "a", "zz", false)).toBeNull();
  });
});

describe("drag drop applied to the section list", () => {
  const list: SectionState[] = ["a", "b", "c", "d"].map((id) => ({
    id,
    span: 1,
    hidden: false,
    collapsed: false,
  }));

  const dropped = (id: string, targetId: string, after: boolean): string[] => {
    const at = dropIndex(
      list.map((section) => section.id),
      id,
      targetId,
      after,
    );
    if (at === null) return list.map((section) => section.id);
    return moveSectionInList(list, id, at).map((section) => section.id);
  };

  it("moves a section exactly one place when it is dragged past one neighbour", () => {
    expect(dropped("a", "b", true)).toEqual(["b", "a", "c", "d"]);
    expect(dropped("d", "c", false)).toEqual(["a", "b", "d", "c"]);
  });

  it("puts a section under a target further down instead of into its slot", () => {
    expect(dropped("a", "c", true)).toEqual(["b", "c", "a", "d"]);
    expect(dropped("a", "c", false)).toEqual(["b", "a", "c", "d"]);
  });

  it("puts a section under a target further up", () => {
    expect(dropped("d", "a", true)).toEqual(["a", "d", "b", "c"]);
    expect(dropped("d", "a", false)).toEqual(["d", "a", "b", "c"]);
  });

  it("reaches the last slot from above", () => {
    expect(dropped("a", "d", true)).toEqual(["b", "c", "d", "a"]);
  });
});
