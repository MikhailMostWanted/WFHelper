export {};
/** A utility process owns Windows OCR; only images and language parameters enter it. */
const { parentPort } = process;
if (!parentPort) throw new Error("Windows OCR requires a utility-process parent");
let closing = false;
const active = new Set<Promise<void>>();
type Engine = {
  recognize: (
    input: Buffer | string,
    accuracy?: unknown,
    languages?: string[],
  ) => Promise<{ text: string; confidence: number }>;
};
let engine: Engine;
try {
  engine = require("@napi-rs/system-ocr") as Engine;
} catch (error) {
  parentPort.postMessage({ type: "fatal", error: String(error) });
  setImmediate(() => process.exit(1));
}

parentPort.on("message", (event: { data: unknown }) => {
  if (!event.data || typeof event.data !== "object") return;
  const request = event.data as {
    type?: string;
    id?: number;
    input?: Uint8Array | string;
    languages?: string[];
  };
  if (request.type === "shutdown") {
    closing = true;
    void Promise.allSettled([...active]).then(() => setImmediate(() => process.exit(0)));
    return;
  }
  if (closing || request.type !== "recognize" || !Number.isSafeInteger(request.id)) return;
  if (typeof request.input !== "string" && !(request.input instanceof Uint8Array)) return;
  const input = typeof request.input === "string" ? request.input : Buffer.from(request.input);
  const job = (async () => {
    try {
      const result = await engine.recognize(input, undefined, request.languages);
      parentPort.postMessage({ id: request.id, text: result.text, confidence: result.confidence });
    } catch (error) {
      parentPort.postMessage({ id: request.id, error: String(error) });
    }
  })();
  active.add(job);
  void job.finally(() => active.delete(job));
});
