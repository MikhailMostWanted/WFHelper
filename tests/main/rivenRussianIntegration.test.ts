import { beforeEach, describe, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ read: vi.fn() }));
const onnx = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../../services/nativeRussianOcr", () => ({ shouldUseRussianRewardOcr: () => true, runRussianTextOcr: native.read }));
vi.mock("../../services/rivenOcrOnnx", () => ({ rivenOcrOnnxAvailable: () => false, recognizeStatArea: onnx.read, hasLowConfidenceLine: () => false, LOW_CONFIDENCE_THRESHOLD: 0.8 }));
vi.mock("../../services/rewardScanDebug", () => ({ areOcrDebugDumpsEnabled: () => false }));
vi.mock("../../ipc/overlay/rivenScanImage", () => ({
  cropRivenStatImage: () => ({ cardCrop: { toPNG: () => Buffer.from("card") }, statCrop: { toPNG: () => Buffer.from("stats") } }),
  cropRivenStatAreaFallback: () => null, statCropUpscaleFactor: () => 1,
}));
import { recognizeRivenCardStats } from "../../ipc/overlay/rivenScanOcr";
const options = { generation: 1, isStale: () => false };
const rect = { x: 0, y: 0, width: 1, height: 1 };
beforeEach(() => { native.read.mockReset(); onnx.read.mockReset(); });
describe("Russian Riven recognition", () => {
  it("works without the English model", async () => {
    native.read.mockResolvedValue("+120% урона\n+80% мультивыстрел\n-30% приближение");
    const result = await recognizeRivenCardStats({} as never, rect, options);
    expect(result.stats).toHaveLength(3); expect(result.lowConfidence).toBe(false); expect(onnx.read).not.toHaveBeenCalled();
  });
  it("refuses an unreadable signed stat instead of publishing incomplete data", async () => {
    native.read.mockResolvedValue("+120% урона\n+80% мультивыстрел\n-30% непонятное слово");
    const result = await recognizeRivenCardStats({} as never, rect, options);
    expect(result.stats).toEqual([]); expect(result.lowConfidence).toBe(true); expect(native.read).toHaveBeenCalledTimes(2);
  });
  it("discards results from stale generations", async () => {
    let stale = false;
    native.read.mockImplementation(async () => { stale = true; return "+120% урона\n+80% мультивыстрел"; });
    const result = await recognizeRivenCardStats({} as never, rect, { ...options, isStale: () => stale }); expect(result.stats).toEqual([]);
  });
});
