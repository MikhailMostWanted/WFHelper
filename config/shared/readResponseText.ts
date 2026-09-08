export async function readResponseText(
  response: Response,
  maxBytes: number,
  options: { truncate?: boolean; allowPartial?: boolean } = {},
): Promise<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new RangeError("invalid body limit");
  if (!response.body || typeof response.body.getReader !== "function") return "";
  const decoder = new TextDecoder();
  let text = "";
  let total = 0;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    // A locked body also falls back to partial diagnostics when requested.
    reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const room = maxBytes - total;
      if (value.byteLength > room || (options.truncate && value.byteLength === room)) {
        if (options.truncate) text += decoder.decode(value.subarray(0, room), { stream: true });
        await reader.cancel();
        if (!options.truncate) throw new RangeError("response body exceeds limit");
        break;
      }
      total += value.byteLength;
      text += decoder.decode(value, { stream: true });
    }
  } catch (error) {
    // Partial diagnostics preserve the HTTP status that decides the retry.
    if (!options.allowPartial) throw error;
  } finally {
    reader?.releaseLock?.();
  }
  return text + decoder.decode();
}
