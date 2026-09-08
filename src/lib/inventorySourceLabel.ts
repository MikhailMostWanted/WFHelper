import {
  normalizeInventorySource,
  type InventorySource,
} from "../../config/shared/inventorySource.js";
import type { MessageKey } from "./i18n.js";

interface InventorySourceDescription {
  labelKey: MessageKey;
  /** File name of the user's pick, or "" for the helper, which discovers its own. */
  detail: string;
  /** Full path when there is one, else "" so the caller falls back to the label. */
  path: string;
}

/** Sources that are a file the user chose, so naming it tells them something. */
const USER_PICKED_SOURCES = new Set<InventorySource>(["manual", "aleca"]);

const SOURCE_LABEL_KEYS: Record<InventorySource, MessageKey> = {
  helper: "settings.inventorySourceHelper",
  manual: "settings.inventorySourceManual",
  aleca: "settings.inventorySourceAleca",
  none: "settings.inventorySourceNone",
};

export const INVENTORY_SOURCE_OPTIONS: ReadonlyArray<{
  value: InventorySource;
  labelKey: MessageKey;
}> = [
  { value: "helper", labelKey: "settings.inventorySourceShortHelper" },
  { value: "manual", labelKey: "settings.inventorySourceShortManual" },
  { value: "aleca", labelKey: "settings.inventorySourceAleca" },
  { value: "none", labelKey: "settings.inventorySourceNone" },
];

function fileName(filePath: string): string {
  const parts = filePath.split(/[\\/]/);
  return parts[parts.length - 1] || filePath;
}

/** Where inventory data comes from, as keys the caller translates. */
export function describeInventorySource(
  source: unknown,
  path: string | null,
): InventorySourceDescription {
  const normalized = normalizeInventorySource(source);
  const labelKey = SOURCE_LABEL_KEYS[normalized];
  if (!USER_PICKED_SOURCES.has(normalized) || !path) return { labelKey, detail: "", path: "" };
  return { labelKey, detail: fileName(path), path };
}
