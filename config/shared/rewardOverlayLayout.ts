export const REWARD_OVERLAY_CANVAS = { width: 980, height: 236 } as const;

export const REWARD_OVERLAY_FIELDS = [
  "slotLabel",
  "itemName",
  "rarity",
  "platinumIcon",
  "platinumValue",
  "ducatIcon",
  "ducatValue",
  "pricePlaceholder",
  "owned",
  "mastery",
  "foundry",
  "setOwned",
  "setPrice",
  "part0Icon",
  "part0Count",
  "part1Icon",
  "part1Count",
  "part2Icon",
  "part2Count",
  "part3Icon",
  "part3Count",
  "part4Icon",
  "part4Count",
  "part5Icon",
  "part5Count",
  "bestLabel",
  "bestName",
  "bestPlatinumIcon",
  "bestPlatinumValue",
  "bestPlaceholder",
  "scanSpinner",
  "scanText",
  "errorText",
  "dragHint",
  "closeButton",
] as const;

export type RewardOverlayField = (typeof REWARD_OVERLAY_FIELDS)[number];

export interface RewardOverlayFieldStyle {
  x: number;
  y: number;
  scale: number;
  color: string | null;
  hidden: boolean;
}

export const DEFAULT_REWARD_FIELD_STYLE: Readonly<RewardOverlayFieldStyle> = {
  x: 0,
  y: 0,
  scale: 1,
  color: null,
  hidden: false,
};

export interface RewardOverlayLayout {
  version: 1;
  fields: Partial<Record<RewardOverlayField, RewardOverlayFieldStyle>>;
}

export interface RewardOverlayEditState {
  sessionId: string | null;
  revision: number;
  layout: RewardOverlayLayout;
  selectedField: RewardOverlayField;
  previewCount: 1 | 2 | 3 | 4;
  previewVariant: "rewards" | "missing" | "scanning" | "error";
  scale: number;
}

export type RewardOverlayEditCommand =
  | { type: "field"; field: RewardOverlayField; patch: Partial<RewardOverlayFieldStyle> }
  | { type: "select"; field: RewardOverlayField }
  | { type: "reset"; field?: RewardOverlayField }
  | { type: "preview"; count: 1 | 2 | 3 | 4; variant: RewardOverlayEditState["previewVariant"] }
  | { type: "scale"; scale: number };

export function isRewardOverlayField(value: unknown): value is RewardOverlayField {
  return typeof value === "string" && (REWARD_OVERLAY_FIELDS as readonly string[]).includes(value);
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function normalizeRewardFieldStyle(value: unknown): RewardOverlayFieldStyle {
  const raw = record(value) ?? {};
  const bounded = (key: string, min: number, max: number, fallback: number): number => {
    const n = raw[key];
    return typeof n === "number" && Number.isFinite(n)
      ? Math.round(Math.min(max, Math.max(min, n)) * 100) / 100
      : fallback;
  };
  return {
    x: bounded("x", -REWARD_OVERLAY_CANVAS.width, REWARD_OVERLAY_CANVAS.width, 0),
    y: bounded("y", -REWARD_OVERLAY_CANVAS.height, REWARD_OVERLAY_CANVAS.height, 0),
    scale: bounded("scale", 0.5, 3, 1),
    color: typeof raw.color === "string" && /^#[\da-f]{6}$/i.test(raw.color) ? raw.color : null,
    hidden: raw.hidden === true,
  };
}

export function normalizeRewardOverlayLayout(value: unknown): RewardOverlayLayout {
  const raw = record(value);
  const fields = record(raw?.fields);
  const result: RewardOverlayLayout = { version: 1, fields: {} };
  if (raw?.version !== 1 || !fields) return result;
  for (const field of REWARD_OVERLAY_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(fields, field))
      result.fields[field] = normalizeRewardFieldStyle(fields[field]);
  }
  return result;
}
