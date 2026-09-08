import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

import { expect, it } from "vitest";

import { getOverlayDescriptor } from "../../config/shared/overlayLayout";

it("preserves all editable trade leaves through payload and locale refreshes", async () => {
  const nodes = new Map<string, Node>();
  class Node {
    children: Node[] = [];
    dataset: Record<string, string> = {};
    style = {};
    hidden = false;
    classList = { add() {}, remove() {} };
    private text = "";
    constructor(readonly id: string) {}
    set textContent(value: string) {
      this.text = value;
      for (const child of this.children) nodes.delete(child.id);
      this.children = [];
    }
    get textContent(): string {
      return this.text;
    }
    querySelector(selector: string) {
      return nodes.get(selector.slice(1)) ?? null;
    }
  }
  const html = readFileSync("renderer/trade-notification.html", "utf8");
  for (const [, id] of html.matchAll(/\bid="([^"]+)"/g)) nodes.set(id, new Node(id));
  const get = (id: string) => {
    const node = nodes.get(id);
    if (!node) throw new Error(`Missing trade leaf ${id}`);
    return node;
  };
  get("plat-amount").children = [get("plat-value"), get("plat-unit")];
  let show: (payload: unknown) => void = () => {};
  let repaint: () => void = () => {};
  let tagFields: () => void = () => {};
  runInNewContext(readFileSync("renderer/trade-notification.js", "utf8"), {
    document: { getElementById: get, body: new Node("body") },
    window: {
      overlayPreview: {},
      overlayLayoutApi: {},
      installOverlayLayout: (options: { tagFields: () => void }) => {
        tagFields = options.tagFields;
      },
      overlayTheme: { bootstrapOverlayTheme() {}, applyThemeVars() {} },
      overlayI18n: {
        t: (key: string) => key,
        onApply: (callback: () => void) => (repaint = callback),
        load: async () => true,
      },
      tradeNotificationApi: {
        onShow: (callback: (payload: unknown) => void) => (show = callback),
        onRepResult() {},
        onMessages() {},
        onThemeVars() {},
      },
    },
  });
  await Promise.resolve();
  for (const [type, quantity, amount] of [
    ["sale", 2, "+45"],
    ["purchase", 1, "−45"],
    ["trade", 3, "−45"],
  ] as const) {
    show({
      status: "closed",
      match: { type, quantity, platinum: 45, itemName: "Ash Prime Neuroptics" },
      timing: { visibleMs: 5000, fadeMs: 400 },
    });
    repaint();
    tagFields();
    expect(get("item-name").textContent).toBe("Ash Prime Neuroptics");
    expect(get("item-quantity").textContent).toBe(quantity > 1 ? `${quantity}×` : "");
    expect(get("item-quantity").hidden).toBe(quantity === 1);
    expect(get("plat-value").textContent).toBe(amount);
    expect(get("plat-amount").children).toEqual([get("plat-value"), get("plat-unit")]);
    expect(get("plat-amount").hidden).toBe(type === "trade");
    expect(new Set([...nodes.values()].flatMap((node) => node.dataset.rewardField ?? []))).toEqual(
      new Set(getOverlayDescriptor("tradeNotification").fields),
    );
  }
});
