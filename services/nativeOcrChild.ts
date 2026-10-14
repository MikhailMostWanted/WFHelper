/** Native OCR lives only in this utility process, never in Electron main. */
import { normalizeErrorMessage } from "../config/shared/errors";

interface OcrRequest {
  type?: string;
  id?: number;
  input?: string | Uint8Array;
  languages?: string[];
}
type Recognize = (
  input: string | Uint8Array,
  accuracy?: undefined,
  languages?: string[],
) => Promise<{ text: string; confidence: number }>;

const { parentPort } = process;
if (!parentPort) throw new Error("Native OCR requires a utility process parent");

let recognize: Recognize | null = null;
try {
  recognize = (require("@napi-rs/system-ocr") as { recognize: Recognize }).recognize;
  parentPort.postMessage({ type: "ready" });
} catch (error) {
  parentPort.postMessage({
    type: "unavailable",
    error: normalizeErrorMessage(error, "Native OCR binding unavailable"),
  });
}

parentPort.on("message", (event) => {
  const request = event.data as OcrRequest;
  if (request?.type !== "recognize" || typeof request.id !== "number") return;
  if (!recognize || !(typeof request.input === "string" || request.input instanceof Uint8Array)) {
    parentPort.postMessage({ type: "result", id: request.id, error: "Native OCR unavailable" });
    return;
  }
  const input = typeof request.input === "string" ? request.input : Buffer.from(request.input);
  const runRecognize = recognize;
  void Promise.resolve()
    .then(() => runRecognize(input, undefined, request.languages))
    .then(
      (result) => {
        parentPort.postMessage({
          type: "result",
          id: request.id,
          text: result.text,
          confidence: result.confidence,
        });
      },
      (error: unknown) => {
        parentPort.postMessage({
          type: "result",
          id: request.id,
          error: normalizeErrorMessage(error, "Native OCR failed"),
        });
      },
    );
});
