import { describe, expect, it } from "vitest";

import { describeInventorySource } from "../../../src/lib/inventorySourceLabel.js";

describe("describeInventorySource", () => {
  it("names each source by message key, never by prose", () => {
    expect(describeInventorySource("helper", null).labelKey).toBe("settings.inventorySourceHelper");
    expect(describeInventorySource("manual", null).labelKey).toBe("settings.inventorySourceManual");
    expect(describeInventorySource("aleca", null).labelKey).toBe("settings.inventorySourceAleca");
    expect(describeInventorySource("none", "C:\\old-inventory.json")).toEqual({
      labelKey: "settings.inventorySourceNone",
      detail: "",
      path: "",
    });
  });

  it("shows the file name for a manual pick and keeps the full path as a tooltip", () => {
    const described = describeInventorySource("manual", "D:\\exports\\inventory_manual.json");

    expect(described.detail).toBe("inventory_manual.json");
    expect(described.path).toBe("D:\\exports\\inventory_manual.json");
  });

  it("splits posix paths too", () => {
    expect(describeInventorySource("manual", "/home/tenno/inventory.json").detail).toBe(
      "inventory.json",
    );
  });

  // The helper discovers its own file, so naming it says nothing the label does not.
  it("adds no file detail for the helper, which the user never points at a file", () => {
    const helper = describeInventorySource("helper", "/var/api-helper/inventory.json");

    expect(helper).toEqual({
      labelKey: "settings.inventorySourceHelper",
      detail: "",
      path: "",
    });
  });

  it("names the AlecaFrame file too - the user picked that one", () => {
    const aleca = describeInventorySource("aleca", "C:\\AlecaFrame\\lastData.dat");

    expect(aleca).toEqual({
      labelKey: "settings.inventorySourceAleca",
      detail: "lastData.dat",
      path: "C:\\AlecaFrame\\lastData.dat",
    });
  });

  it("falls back to the helper label for a legacy or unknown source", () => {
    expect(describeInventorySource("json", null).labelKey).toBe("settings.inventorySourceHelper");
    expect(describeInventorySource(undefined, null).labelKey).toBe(
      "settings.inventorySourceHelper",
    );
  });
});
