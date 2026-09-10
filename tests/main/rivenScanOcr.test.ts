import { beforeEach, describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({ png: Buffer.alloc(0) }));
const recognizeStatAreaMock = vi.fn();
const lowConfidenceMock = vi.fn((_result: { minConfidence: number }) => false);

vi.mock("../../services/rivenOcrOnnx", () => ({
  rivenOcrOnnxAvailable: () => true,
  recognizeStatArea: (...args: unknown[]) => recognizeStatAreaMock(...args),
  hasLowConfidenceLine: (result: { minConfidence: number }) => lowConfidenceMock(result),
  LOW_CONFIDENCE_THRESHOLD: 0.8,
}));

vi.mock("../../services/rewardScanDebug", () => ({
  areOcrDebugDumpsEnabled: () => false,
}));

vi.mock("../../ipc/overlay/rivenScanImage", () => {
  const crop = () => ({
    getSize: () => ({ width: 64, height: 48 }),
    toPNG: () => holder.png,
  });
  return {
    cropRivenStatImage: () => ({ cardCrop: crop(), statCrop: crop() }),
    cropRivenStatAreaFallback: () => null,
    statCropUpscaleFactor: (height: number) => Math.min(3, Math.max(1, Math.ceil(320 / height))),
  };
});

import { isIncompleteRivenRead, recognizeRivenCardStats } from "../../ipc/overlay/rivenScanOcr";

describe("recognizeRivenCardStats", () => {
  // A test that pins its own confidence rule or queues reads with Once must not
  // decide what the next one sees. mockReset puts the vi.fn factory impl back.
  beforeEach(() => {
    recognizeStatAreaMock.mockReset();
    lowConfidenceMock.mockReset();
  });

  it("refuses a read that recovered fewer than two stats", async () => {
    const sharp = (await import("sharp")).default;
    holder.png = await sharp({
      create: { width: 64, height: 48, channels: 3, background: { r: 10, g: 10, b: 18 } },
    })
      .png()
      .toBuffer();

    // A degraded frame that only ever yields one stat line.
    recognizeStatAreaMock.mockResolvedValue({
      lines: [{ text: "-66.2% Weapon Recoil", confidence: 0.9 }],
      text: "-66.2% Weapon Recoil",
      minConfidence: 0.9,
      yoloBoxCount: 3,
    });

    const result = await recognizeRivenCardStats(
      {} as never,
      { x: 0, y: 0, width: 1, height: 1 },
      { generation: 1, isStale: () => false, label: "test" },
    );

    expect(result.stats).toEqual([]);
    expect(result.lowConfidence).toBe(true);
  });

  it("takes a retry that ties on stat count but reads with more confidence", async () => {
    const sharp = (await import("sharp")).default;
    holder.png = await sharp({
      create: { width: 64, height: 48, channels: 3, background: { r: 10, g: 10, b: 18 } },
    })
      .png()
      .toBuffer();

    lowConfidenceMock.mockImplementation((result) => result.minConfidence < 0.8);
    const read = (minConfidence: number) => ({
      lines: [
        { text: "+104.6% Critical Damage", confidence: minConfidence },
        { text: "+2.3 Range", confidence: minConfidence },
      ],
      text: "+104.6% Critical Damage\n+2.3 Range",
      minConfidence,
      yoloBoxCount: 4,
    });
    recognizeStatAreaMock
      .mockResolvedValueOnce(read(0.714))
      .mockResolvedValueOnce(read(0.87))
      .mockResolvedValue(read(0.87));

    const result = await recognizeRivenCardStats(
      {} as never,
      { x: 0, y: 0, width: 1, height: 1 },
      { generation: 1, isStale: () => false, label: "test" },
    );

    expect(result.lowConfidence).toBe(false);
    expect(result.stats).toHaveLength(2);
  });
});

describe("isIncompleteRivenRead", () => {
  const stat = (name: string, positive: boolean) => ({ name, positive, value: 10 });

  it("accepts the shapes a riven can actually roll", () => {
    expect(isIncompleteRivenRead([stat("Damage", true), stat("Multishot", true)])).toBe(false);
    expect(
      isIncompleteRivenRead([
        stat("Damage", true),
        stat("Multishot", true),
        stat("Critical Chance", false),
      ]),
    ).toBe(false);
  });

  it("rejects a read that kept a curse but lost a buff", () => {
    expect(isIncompleteRivenRead([stat("Damage", true), stat("Zoom", false)])).toBe(true);
    expect(isIncompleteRivenRead([stat("Damage", true)])).toBe(true);
  });

  it("leaves an empty read to the empty-scan path", () => {
    expect(isIncompleteRivenRead([])).toBe(false);
  });

  it("rejects two buffs when a third stat-shaped line went unread", () => {
    const twoBuffs = [
      { name: "Damage to Corpus", positive: true, value: 1.36, multiplier: true },
      { name: "Critical Chance for Slide Attack", positive: true, value: 108 },
    ];
    expect(isIncompleteRivenRead(twoBuffs, true)).toBe(true);
    expect(isIncompleteRivenRead(twoBuffs, false)).toBe(false);
  });

  it("keeps a whole three-stat card even when a line went unread", () => {
    expect(
      isIncompleteRivenRead(
        [stat("Damage", true), stat("Multishot", true), stat("Zoom", false)],
        true,
      ),
    ).toBe(false);
  });
});

describe("recognizeRivenCardStats completeness gate", () => {
  beforeEach(() => {
    recognizeStatAreaMock.mockReset();
    lowConfidenceMock.mockReset();
    lowConfidenceMock.mockImplementation(() => false);
  });

  it("returns an error instead of a card missing one of its buffs", async () => {
    const read = {
      lines: [
        { text: "+120.5% Damage", confidence: 0.99 },
        { text: "-72.3% Critical Chance", confidence: 0.99 },
      ],
      text: "+120.5% Damage\n-72.3% Critical Chance",
      minConfidence: 0.99,
      yoloBoxCount: 4,
    };
    recognizeStatAreaMock.mockResolvedValue(read);

    const result = await recognizeRivenCardStats(
      {} as never,
      { x: 0, y: 0, width: 1, height: 1 },
      { generation: 1, isStale: () => false, label: "test" },
    );

    expect(result.stats).toEqual([]);
    expect(result.lowConfidence).toBe(true);
  });

  it("keeps a curse-free two-buff card when the crop caught a signed fragment", async () => {
    recognizeStatAreaMock.mockResolvedValue({
      lines: [
        { text: "+104.6% Critical Damage", confidence: 0.99 },
        { text: "+2.3 Range", confidence: 0.99 },
        { text: "+1 5%", confidence: 0.99 },
      ],
      text: "+104.6% Critical Damage\n+2.3 Range\n+1 5%",
      minConfidence: 0.99,
      yoloBoxCount: 5,
    });

    const result = await recognizeRivenCardStats(
      {} as never,
      { x: 0, y: 0, width: 1, height: 1 },
      { generation: 1, isStale: () => false, label: "test" },
    );

    expect(result.stats).toHaveLength(2);
    expect(result.lowConfidence).toBe(false);
  });

  it("retries two buffs when the unread line carried a stat name too", async () => {
    recognizeStatAreaMock.mockResolvedValue({
      lines: [
        { text: "+104.6% Critical Damage", confidence: 0.99 },
        { text: "+2.3 Range", confidence: 0.99 },
        { text: "x1.36 Dmagt Grneea", confidence: 0.99 },
      ],
      text: "+104.6% Critical Damage\n+2.3 Range\nx1.36 Dmagt Grneea",
      minConfidence: 0.99,
      yoloBoxCount: 6,
    });

    const result = await recognizeRivenCardStats(
      {} as never,
      { x: 0, y: 0, width: 1, height: 1 },
      { generation: 1, isStale: () => false, label: "test" },
    );

    expect(result.stats).toEqual([]);
    expect(result.lowConfidence).toBe(true);
  });
});
