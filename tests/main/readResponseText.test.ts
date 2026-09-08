import { describe, expect, it, vi } from "vitest";
import { readResponseText } from "../../config/shared/readResponseText";

function response(chunks: Uint8Array[], fail = false) {
  const cancel = vi.fn();
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) controller.enqueue(chunks[index++]);
      else if (fail) controller.error(new Error("interrupted"));
      else controller.close();
    },
    cancel,
  });
  return { response: new Response(body), cancel };
}

describe("bounded response text", () => {
  it("counts bytes across chunks and decodes split UTF-8 at the exact limit", async () => {
    const bytes = new TextEncoder().encode("A€");
    const input = response([bytes.slice(0, 2), bytes.slice(2)]);
    expect(await readResponseText(input.response, 4)).toBe("A€");
    expect(input.response.body?.locked).toBe(false);
  });

  it("rejects an oversized body and cancels unread input", async () => {
    const input = response([new Uint8Array([65, 66]), new Uint8Array([67])]);
    await expect(readResponseText(input.response, 1)).rejects.toThrow("exceeds limit");
    expect(input.cancel).toHaveBeenCalledOnce();
    expect(input.response.body?.locked).toBe(false);
  });

  it("truncates diagnostic bodies without hiding HTTP status", async () => {
    const input = response([new Uint8Array([65, 66]), new Uint8Array([67])]);
    expect(await readResponseText(input.response, 1, { truncate: true })).toBe("A");
    expect(input.cancel).toHaveBeenCalledOnce();
  });

  it("propagates read failures unless partial diagnostic output is requested", async () => {
    await expect(
      readResponseText(response([new Uint8Array([65])], true).response, 10),
    ).rejects.toThrow("interrupted");
    expect(
      await readResponseText(response([new Uint8Array([65])], true).response, 10, {
        allowPartial: true,
      }),
    ).toBe("A");
  });
});
