import { describe, expect, it } from "vitest";

import { _parseTradeDialog } from "../../services/eeLogMonitor";

// Warframe logs each trade item on its own line; stacked items as "Name x N".
function saleBuffer(offerLines: string[]): string[] {
  return [
    "Are you sure you want to accept this trade?",
    "You are offering:",
    ...offerLines,
    "and will receive from BuyerName the following:",
    "Platinum x 45, leftItem=/Menu/Confirm_Item_Ok",
  ];
}

describe("_parseTradeDialog quantity handling", () => {
  it("parses a stacked item 'Name x N' as count N", () => {
    const parsed = _parseTradeDialog(saleBuffer(["Arcane Pistoleer x 3"]));
    expect(parsed?.type).toBe("sale");
    expect(parsed?.partner).toBe("BuyerName");
    expect(parsed?.platChange).toBe(45);
    const item = parsed?.items.find((i) => i.displayName === "Arcane Pistoleer");
    expect(item?.count).toBe(3);
    expect(item?.direction).toBe("given");
  });

  it("counts non-stacking duplicate lines", () => {
    const parsed = _parseTradeDialog(
      saleBuffer(["Arcane Pistoleer", "Arcane Pistoleer", "Arcane Pistoleer"]),
    );
    expect(parsed?.items.find((i) => i.displayName === "Arcane Pistoleer")?.count).toBe(3);
  });

  it("handles mixed stacked + duplicate lines for the same item", () => {
    const parsed = _parseTradeDialog(saleBuffer(["Vitus Essence x 2", "Vitus Essence"]));
    expect(parsed?.items.find((i) => i.displayName === "Vitus Essence")?.count).toBe(3);
  });

  it("treats received platinum as plat, not an item", () => {
    const parsed = _parseTradeDialog(saleBuffer(["Arcane Pistoleer x 3"]));
    expect(parsed?.items.some((i) => /platinum/i.test(i.displayName))).toBe(false);
  });
});

// Corruption a trade log can carry: platform glyphs in both the live U+E000
// form and the DBWIN latin1 mojibake form.
describe("_parseTradeDialog corruption hardening", () => {
  it("strips a trailing platform glyph (U+E000) from the partner name", () => {
    const parsed = _parseTradeDialog([
      "Are you sure you want to accept this trade?",
      "You are offering:",
      "Arcane Pistoleer",
      "and will receive from Kestrel\uE000 the following:",
      "Platinum x 45, leftItem=/Menu/Confirm_Item_Ok",
    ]);
    expect(parsed?.partner).toBe("Kestrel");
  });

  it("strips the DBWIN latin1-mojibake form of a platform glyph from the partner", () => {
    const parsed = _parseTradeDialog([
      "Are you sure you want to accept this trade?",
      "You are offering:",
      "Arcane Pistoleer",
      "and will receive from Kestrel\u00EE\u0080\u0080 the following:",
      "Platinum x 45, leftItem=/Menu/Confirm_Item_Ok",
    ]);
    expect(parsed?.partner).toBe("Kestrel");
  });

  it("drops glyph-only lines instead of recording them as items", () => {
    const parsed = _parseTradeDialog(
      saleBuffer(["Zid-an Asheir", "\uE000\uE001\uE002\uE003", "\uE000\uE000"]),
    );
    expect(parsed?.items.map((i) => i.displayName)).toEqual(["Zid-an Asheir"]);
  });

  it("strips platform glyphs embedded in an item name", () => {
    const parsed = _parseTradeDialog(saleBuffer(["Zid-an Asheir\uE000\uE001"]));
    expect(parsed?.items.map((i) => i.displayName)).toEqual(["Zid-an Asheir"]);
  });

  it("does not capture Dialog key=value tails into the item name", () => {
    const parsed = _parseTradeDialog(
      saleBuffer(["Zid-an Asheir, title= leftItem=/Menu/Confirm_Item_Ok"]),
    );
    expect(parsed?.items.map((i) => i.displayName)).toEqual(["Zid-an Asheir"]);
  });

  it("rejects raw EE.log framework lines leaked into the buffer", () => {
    const parsed = _parseTradeDialog(
      saleBuffer([
        "Zid-an Asheir",
        "11828.904 Script [Info]: Dialog.lua: Dialog::",
        "11829.001 Sys [Info]: whatever",
      ]),
    );
    expect(parsed?.items.map((i) => i.displayName)).toEqual(["Zid-an Asheir"]);
  });

  it("stops item parsing at a bare title= arg line", () => {
    const parsed = _parseTradeDialog(
      saleBuffer(["Zid-an Asheir", "title=", "leftItem=/Menu/Confirm_Item_Ok"]),
    );
    expect(parsed?.items.map((i) => i.displayName)).toEqual(["Zid-an Asheir"]);
  });
});

// The dialog description separates items with a bare CR, which the log reader
// does not treat as a line break, so the engine can flush the next entry behind one.
const GLYPH = String.fromCharCode(0xe000);
const DIALOG_HEAD =
  "2416.657 Script [Info]: Dialog.lua: Dialog::CreateOkCancel(description=" +
  "Are you sure you want to accept this trade? You are offering:";
const DIALOG_TAIL = ", title= leftItem=/Menu/Confirm_Item_Ok, rightItem=/Menu/Confirm_Item_Cancel)";
const NEXT_ENTRY = "2416.702 Sys [Info]: Fade out complete";

function bufferFromRawLog(raw: string): string[] {
  return raw.split(/\r?\n/).filter((line) => line !== "");
}

describe("_parseTradeDialog CR-separated descriptions", () => {
  it("reads the reported Vicious Bond sale as 12p", () => {
    const parsed = _parseTradeDialog(
      bufferFromRawLog(
        [
          DIALOG_HEAD,
          "\rVicious Bond (RARE RANK 0)",
          "",
          "and will receive from RendiW" + GLYPH + " the following:",
          "\rPlatinum x 12" + DIALOG_TAIL + "\r" + NEXT_ENTRY,
        ].join("\n"),
      ),
    );
    expect(parsed?.type).toBe("sale");
    expect(parsed?.platChange).toBe(12);
    expect(parsed?.partner).toBe("RendiW");
    expect(parsed?.items).toEqual([
      { displayName: "Vicious Bond (RARE RANK 0)", count: 1, direction: "given" },
    ]);
  });

  it("reads the same dialog when CR is its only separator", () => {
    const parsed = _parseTradeDialog([
      [
        DIALOG_HEAD,
        "Vicious Bond (RARE RANK 0)",
        "and will receive from RendiW" + GLYPH + " the following:",
        "Platinum x 12" + DIALOG_TAIL,
        NEXT_ENTRY,
      ].join("\r"),
    ]);
    expect(parsed?.type).toBe("sale");
    expect(parsed?.platChange).toBe(12);
    expect(parsed?.partner).toBe("RendiW");
    expect(parsed?.items.map((i) => i.displayName)).toEqual(["Vicious Bond (RARE RANK 0)"]);
  });

  it("keeps CR-separated items apart instead of merging their names", () => {
    const parsed = _parseTradeDialog([
      "Are you sure you want to accept this trade?",
      "You are offering:",
      "\rAxi A12 Relic\rAxi A12 Relic\rVitus Essence x 2",
      "and will receive from BuyerName the following:",
      "\rPlatinum x 45" + DIALOG_TAIL,
    ]);
    expect(parsed?.platChange).toBe(45);
    expect(parsed?.items).toEqual([
      { displayName: "Axi A12 Relic", count: 2, direction: "given" },
      { displayName: "Vitus Essence", count: 2, direction: "given" },
    ]);
  });

  it("reads the platinum when the next entry is glued on with no separator", () => {
    const parsed = _parseTradeDialog(
      saleBuffer(["Arcane Pistoleer"])
        .slice(0, -1)
        .concat("Platinum x 45" + DIALOG_TAIL + NEXT_ENTRY),
    );
    expect(parsed?.platChange).toBe(45);
    expect(parsed?.type).toBe("sale");
  });

  it("still rejects a framework line that arrives on its own CR piece", () => {
    const parsed = _parseTradeDialog(
      saleBuffer(["Zid-an Asheir\r11828.904 Script [Info]: Dialog.lua: Dialog::"]),
    );
    expect(parsed?.items.map((i) => i.displayName)).toEqual(["Zid-an Asheir"]);
    expect(parsed?.platChange).toBe(45);
  });
});
