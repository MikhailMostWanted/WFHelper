import { isBoundedBase64 } from "./base64";

export const FEEDBACK_LIMITS = {
  title: 120,
  description: 4000,
  contact: 120,
  screenshotBytes: 1024 * 1024,
  logChars: 256 * 1024,
  requestBytes: 2000000,
} as const;

export interface FeedbackReport {
  kind: "bug" | "feature";
  title: string;
  description: string;
  contact?: string;
  appVersion: string;
  platform: string;
  diagnostics?: {
    osVersion: string;
    arch: string;
    locale: string;
    view: string;
    uiScale: number;
    log?: string;
  };
  screenshot?: {
    mediaType: "image/png" | "image/jpeg" | "image/webp";
    data: string;
  };
}

export type FeedbackResult =
  | { ok: true }
  | { ok: false; error: "invalid" | "unavailable" | "rate_limited" | "failed" };

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function normalizeFeedback(value: unknown): FeedbackReport | null {
  const raw = record(value);
  if (!raw || (raw.kind !== "bug" && raw.kind !== "feature")) return null;
  const text = (value: unknown, max: number): string | null =>
    typeof value === "string" && value.trim().length > 0 && value.length <= max
      ? value.trim()
      : null;
  const title = text(raw.title, FEEDBACK_LIMITS.title);
  const description = text(raw.description, FEEDBACK_LIMITS.description);
  const appVersion = text(raw.appVersion, 64);
  const platform = text(raw.platform, 32);
  if (!title || !description || !appVersion || !platform) return null;
  const result: FeedbackReport = { kind: raw.kind, title, description, appVersion, platform };
  if (raw.contact !== undefined) {
    const contact = text(raw.contact, FEEDBACK_LIMITS.contact);
    if (!contact) return null;
    result.contact = contact;
  }
  if (raw.diagnostics !== undefined) {
    const details = record(raw.diagnostics);
    if (!details) return null;
    const osVersion = text(details.osVersion, 128);
    const arch = text(details.arch, 32);
    const locale = text(details.locale, 32);
    const view = text(details.view, 64);
    const uiScale = details.uiScale;
    if (
      !osVersion ||
      !arch ||
      !locale ||
      !view ||
      typeof uiScale !== "number" ||
      !Number.isFinite(uiScale) ||
      uiScale < 0.25 ||
      uiScale > 4
    )
      return null;
    result.diagnostics = { osVersion, arch, locale, view, uiScale };
    if (details.log !== undefined) {
      if (typeof details.log !== "string" || details.log.length > FEEDBACK_LIMITS.logChars)
        return null;
      if (details.log.length > 0) result.diagnostics.log = details.log;
    }
  }
  if (raw.screenshot !== undefined) {
    const image = record(raw.screenshot);
    if (!image || !isBoundedBase64(image.data, FEEDBACK_LIMITS.screenshotBytes)) return null;
    let bytes: string;
    try {
      bytes = atob(image.data);
    } catch {
      return null;
    }
    if (bytes.length > FEEDBACK_LIMITS.screenshotBytes) return null;
    const valid =
      image.mediaType === "image/png"
        ? bytes.startsWith("\x89PNG\r\n\x1a\n")
        : image.mediaType === "image/jpeg"
          ? bytes.startsWith("\xff\xd8\xff")
          : image.mediaType === "image/webp" &&
            bytes.startsWith("RIFF") &&
            bytes.slice(8, 12) === "WEBP";
    if (!valid) return null;
    result.screenshot = {
      mediaType: image.mediaType as NonNullable<FeedbackReport["screenshot"]>["mediaType"],
      data: image.data,
    };
  }
  return result;
}
