import { describe, expect, it, vi } from "vitest";

import { scanRewardSlotsFallback } from "../../services/rewardScannerSlotScan";

const readers = vi.hoisted(() => ({ windows: "", onnx: "" }));
vi.mock("../../services/logger", () => ({
  withScope: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock("../../services/rewardScanDebug", () => ({ dumpRewardScanDebug: vi.fn() }));
vi.mock("../../services/rewardScannerSupport", () => ({ hasConfidentSlotLayout: () => true }));
vi.mock("../../services/rewardOcrOnnx", () => ({
  rewardOcrOnnxAvailable: () => true,
  recognizeRewardStripOnnx: async () => ({ text: readers.onnx }),
}));
vi.mock("../../services/rewardScannerImage", () => ({
  detectRewardSlotLayoutCandidates: () => [
    {
      count: 1,
      confidence: 1,
      slots: [{ titleRect: { x: 0, y: 0, width: 312, height: 67 } }],
    },
  ],
  binarizeRewardRegion: async (png: Buffer) => png,
  cropRect: () => ({ toPNG: () => Buffer.from("strip") }),
}));

const items = [
  { name: "Xaku Prime Blueprint" },
  { name: "Xaku Prime Neuroptics Blueprint" },
  { name: "Xaku Prime Systems Blueprint" },
  { name: "Xaku Prime Chassis Blueprint" },
];

async function scan(windows: string, onnx: string) {
  Object.assign(readers, { windows, onnx });
  const result = await scanRewardSlotsFallback({ image: {} as never }, 1, 60_000, Date.now(), {
    sortedItems: items,
    ocrTimeoutMs: 1000,
    runOCRStructuredBuffer: async () => ({ text: readers.windows }),
    reader: "both",
  });
  return result?.items.map((item) => item.name);
}

describe("reward slot reader arbitration", () => {
  it.each([
    ["Xaku Prime Blueprint", "Xaku Prime Neuroptics Blueprint'"],
    ["Xaku Prime Neuroptics Blueprint", "Xaku Prime Blueprint"],
  ])("keeps the more complete exact read regardless of reader order", async (windows, onnx) => {
    expect(await scan(windows, onnx)).toEqual(["Xaku Prime Neuroptics Blueprint"]);
  });

  it("does not let a longer fuzzy candidate outrank a shorter exact match", async () => {
    expect(await scan("Xaku Prime Blueprint", "Xaku Prime Neuropties Blueprlnt")).toEqual([
      "Xaku Prime Blueprint",
    ]);
  });

  it("keeps the base blueprint when both readers agree", async () => {
    expect(await scan("Xaku Prime Blueprint", "Xaku Prime Blueprint")).toEqual([
      "Xaku Prime Blueprint",
    ]);
  });
});
