import { describe, expect, it, vi } from "vitest";

import { createPriorityRequestQueue } from "../../../../src/lib/wfm/requestPolicy.js";

describe("createPriorityRequestQueue", () => {
  it("keeps the default runner serial and promotes without duplicating or demoting work", async () => {
    const queue = createPriorityRequestQueue({
      priorities: ["high", "low"] as const,
      maxDepth: 3,
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started: string[] = [];
    const active = queue.enqueue(() => gate, "low");
    const background = queue.enqueue(async () => {
      started.push("background");
    }, "low");
    const owner = Symbol("clicked");
    const clicked = queue.enqueue(
      async () => {
        started.push("clicked");
      },
      "low",
      owner,
    );
    const earlierClick = queue.enqueue(async () => {
      started.push("earlier");
    }, "high");
    queue.promote(owner, "high");
    queue.promote(owner, "high");
    queue.promote(owner, "low");
    expect(queue.lengths()).toEqual({ high: 2, low: 1 });
    expect(started).toEqual([]);
    release();
    await Promise.all([active, background, clicked, earlierClick]);
    expect(started).toEqual(["earlier", "clicked", "background"]);
    expect(queue.isRunning()).toBe(false);
  });

  it("settles a failed beforeTask and continues with queued work", async () => {
    const failure = new Error("beforeTask failed");
    const beforeTask = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(undefined);
    const queue = createPriorityRequestQueue({ priorities: ["normal"], maxDepth: 1, beforeTask });
    const skipped = vi.fn(async () => "skipped");
    const first = queue.enqueue(skipped, "normal");
    const second = queue.enqueue(async () => "next", "normal");
    await expect(first).rejects.toBe(failure);
    await expect(second).resolves.toBe("next");
    expect(skipped).not.toHaveBeenCalled();
    expect(queue.isRunning()).toBe(false);
  });
});
