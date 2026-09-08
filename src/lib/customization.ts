import { get } from "svelte/store";

import { OVERLAY_WINDOW_KEYS, type OverlaySettings } from "../../config/runtime/overlaySettings.js";
import { parsePopoutTarget, popoutTargetKey } from "../../config/shared/popoutTypes.js";
import { asRecord } from "../../config/shared/objectValidation.js";
import { clampNumber } from "../../config/shared/numeric.js";
import { normalizeOverlayLayout, OVERLAY_LAYOUT_KINDS } from "../../config/shared/overlayLayout.js";
import { normalizeRewardOverlayLayout } from "../../config/shared/rewardOverlayLayout.js";
import { customCss } from "../stores/customCss.js";
import { inventoryViewMode } from "../stores/inventoryViewMode.js";
import { applyOverlaySettingsResponse } from "../stores/overlaySettings.js";
import { themeSettings } from "../stores/theme.js";
import {
  applyWorkspaceState,
  captureWorkspace,
  mergeImportedWorkspaces,
  normalizeWorkspace,
  normalizeWorkspaces,
  workspaces,
  MAX_WORKSPACES,
} from "../stores/workspaces.js";
import { byteLength, CUSTOM_CSS_MAX_BYTES, sanitizeCustomCss } from "./customCss/sanitize.js";
import { sectionById } from "./layout/registry.js";
import { LAZY_VIEW_LOADERS } from "./viewRegistry.js";
import { invoke } from "./ipc.js";
import { normalizeThemeSettings, saveThemeSettings } from "./theme/themeStorage.js";

export const CUSTOMIZATION_MAX_BYTES = 2 * 1024 * 1024;
const MAX_IMPORTED_POPOUTS = 128;
type AppearanceSettings = Pick<
  OverlaySettings,
  "rewardLayout" | "overlayLayouts" | "overlayWindowScales" | "overlayWindowBounds" | "uiScale"
>;

function overlayAppearance(value: unknown): AppearanceSettings {
  const raw = asRecord(value) ?? {};
  const layouts = asRecord(raw.overlayLayouts) ?? {};
  const scales = asRecord(raw.overlayWindowScales) ?? {};
  const bounds = asRecord(raw.overlayWindowBounds) ?? {};
  const overlayWindowScales: AppearanceSettings["overlayWindowScales"] = {};
  const overlayWindowBounds: AppearanceSettings["overlayWindowBounds"] = {};
  for (const key of OVERLAY_WINDOW_KEYS) {
    overlayWindowScales[key] = clampNumber(
      scales[key],
      0.75,
      1.5,
      clampNumber(raw.overlayScale, 0.75, 1.5, 1),
    );
    const position = asRecord(bounds[key]);
    if (
      position &&
      typeof position.x === "number" &&
      Number.isFinite(position.x) &&
      typeof position.y === "number" &&
      Number.isFinite(position.y)
    ) {
      overlayWindowBounds[key] = {
        x: Math.round(clampNumber(position.x, -20000, 20000, 0)),
        y: Math.round(clampNumber(position.y, -20000, 20000, 0)),
        ...(typeof position.displayId === "string" && position.displayId.length <= 128
          ? { displayId: position.displayId }
          : {}),
      };
    }
  }
  return {
    rewardLayout: normalizeRewardOverlayLayout(layouts.reward ?? raw.rewardLayout),
    overlayLayouts: Object.fromEntries(
      OVERLAY_LAYOUT_KINDS.map((kind) => [
        kind,
        normalizeOverlayLayout(
          kind,
          kind === "reward" ? (raw.rewardLayout ?? layouts.reward) : layouts[kind],
        ),
      ]),
    ),
    overlayWindowScales,
    overlayWindowBounds,
    uiScale: clampNumber(raw.uiScale, 0.75, 1.5, 1),
  };
}

function validPopouts(value: unknown): boolean {
  if (!Array.isArray(value) || value.length > MAX_IMPORTED_POPOUTS) return false;
  const seen = new Set<string>();
  return value.every((entry) => {
    const raw = asRecord(entry);
    const target = parsePopoutTarget(raw?.target);
    if (!target) return false;
    const key = popoutTargetKey(target);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function validWorkspace(value: unknown): boolean {
  const raw = asRecord(value);
  const sidebar = asRecord(raw?.sidebar);
  const layout = asRecord(raw?.layout);
  return (
    !!raw &&
    typeof raw.id === "string" &&
    raw.id.length > 0 &&
    typeof raw.name === "string" &&
    !!sidebar &&
    Array.isArray(sidebar.order) &&
    Array.isArray(sidebar.hidden) &&
    !!layout &&
    layout.version === 1 &&
    !!asRecord(layout.views) &&
    validPopouts(raw.popouts)
  );
}

function validOverlayAppearance(value: unknown): boolean {
  const raw = asRecord(value);
  if (!raw) return false;
  const validLayout = (layout: unknown): boolean => {
    const entry = asRecord(layout);
    return !!entry && entry.version === 1 && !!asRecord(entry.fields);
  };
  if (raw.rewardLayout !== undefined && !validLayout(raw.rewardLayout)) return false;
  if (raw.overlayLayouts !== undefined) {
    const layouts = asRecord(raw.overlayLayouts);
    if (
      !layouts ||
      OVERLAY_LAYOUT_KINDS.some(
        (kind) => layouts[kind] !== undefined && !validLayout(layouts[kind]),
      )
    )
      return false;
  }
  return true;
}

export function parseCustomization(text: string) {
  if (byteLength(text) > CUSTOMIZATION_MAX_BYTES) throw new Error("too-large");
  const raw = asRecord(JSON.parse(text));
  const saved = asRecord(raw?.savedWorkspaces);
  const theme = asRecord(raw?.theme);
  const branding = asRecord(theme?.branding);
  if (
    !raw ||
    raw.kind !== "wfhelper-customization" ||
    raw.version !== 1 ||
    !theme ||
    (typeof branding?.appName === "string" && branding.appName.length > 80) ||
    (typeof branding?.logoDataUrl === "string" && byteLength(branding.logoDataUrl) > 512 * 1024) ||
    (Array.isArray(theme.customThemes) && theme.customThemes.length > 100) ||
    !validOverlayAppearance(raw.overlays) ||
    !validWorkspace(raw.workspace) ||
    !saved ||
    saved.version !== 1 ||
    !Array.isArray(saved.workspaces) ||
    saved.workspaces.length > MAX_WORKSPACES ||
    !saved.workspaces.every(validWorkspace) ||
    typeof raw.customCss !== "string" ||
    byteLength(raw.customCss) > CUSTOM_CSS_MAX_BYTES ||
    (raw.inventoryViewMode !== "cards" && raw.inventoryViewMode !== "list")
  )
    throw new Error("invalid-file");
  const workspace = normalizeWorkspace(raw.workspace);
  if (!workspace) throw new Error("invalid-file");
  return {
    kind: "wfhelper-customization" as const,
    version: 1 as const,
    theme: normalizeThemeSettings(raw.theme),
    workspace,
    savedWorkspaces: normalizeWorkspaces(saved),
    overlays: overlayAppearance(raw.overlays),
    customCss: sanitizeCustomCss(raw.customCss).css,
    inventoryViewMode: raw.inventoryViewMode as "cards" | "list",
  };
}

export async function exportCustomization(): Promise<string> {
  const payload = JSON.stringify(
    {
      kind: "wfhelper-customization",
      version: 1,
      theme: normalizeThemeSettings(get(themeSettings)),
      workspace: await captureWorkspace(),
      savedWorkspaces: normalizeWorkspaces(get(workspaces)),
      overlays: overlayAppearance(await invoke("getOverlaySettings")),
      customCss: sanitizeCustomCss(get(customCss).css).css,
      inventoryViewMode: get(inventoryViewMode),
    },
    null,
    2,
  );
  parseCustomization(payload);
  return payload;
}

async function validatePopoutSections(
  payload: ReturnType<typeof parseCustomization>,
): Promise<void> {
  const loaded = new Set<string>();
  for (const workspace of [payload.workspace, ...payload.savedWorkspaces.workspaces]) {
    for (const { target } of workspace.popouts) {
      if (target.kind !== "section") continue;
      const owner = target.sectionId.split(".")[0]!;
      if (!sectionById(target.sectionId) && !loaded.has(owner)) {
        const loader = Object.entries(LAZY_VIEW_LOADERS).find(([view]) => view === owner)?.[1];
        if (loader) await loader();
        loaded.add(owner);
      }
      if (!sectionById(target.sectionId)?.canPopout) throw new Error("invalid-file");
    }
  }
}

export async function applyCustomization(
  payload: ReturnType<typeof parseCustomization>,
  includeCustomCss = false,
): Promise<void> {
  // Validate again at the mutation boundary; a caller cannot bypass the file parser.
  const next = parseCustomization(JSON.stringify(payload));
  if (get(workspaces).workspaces.length + next.savedWorkspaces.workspaces.length > MAX_WORKSPACES)
    throw new Error("workspace-capacity");
  await validatePopoutSections(next);
  applyOverlaySettingsResponse(await invoke("setOverlaySettings", next.overlays));
  if (includeCustomCss) {
    customCss.setEnabled(false);
    customCss.save(next.customCss);
  }
  themeSettings.set(next.theme);
  saveThemeSettings(next.theme);
  inventoryViewMode.set(next.inventoryViewMode);
  mergeImportedWorkspaces(next.savedWorkspaces);
  await applyWorkspaceState(next.workspace);
}
