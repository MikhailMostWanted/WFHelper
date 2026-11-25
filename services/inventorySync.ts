import { withScope } from "./logger";
import type { InventorySource } from "../config/shared/inventorySource";
import { DESKTOP_REVIEW } from "../config/runtime/desktopReview";

const log = withScope("inventorySync");

export interface InventorySyncRunner {
  startPolling: (intervalMs?: number, onRunComplete?: (ok: boolean) => void) => void;
  stopPolling: () => void;
  runAfterGameLogin: () => void;
}

export interface InventorySyncDeps {
  runner: InventorySyncRunner;
  getSource: () => InventorySource;
  isAutoSyncEnabled: () => boolean;
  onRunComplete: (ok: boolean) => void;
}

/** Automatic acquisition belongs to the helper source alone - a manually
 *  imported or AlecaFrame file must never be replaced behind the user's back. */
export function autoSyncSkipReason(
  source: InventorySource,
  autoSyncEnabled: boolean,
): string | null {
  if (source !== "helper") return `inventory source is "${source}"`;
  if (!autoSyncEnabled) return "automatic inventory sync is off";
  return null;
}

let _deps: InventorySyncDeps | null = null;
let _loggedSkip: string | null = null;

export function init(deps: InventorySyncDeps): void {
  _deps = deps;
  _loggedSkip = null;
}

function skipReason(): string | null {
  if (DESKTOP_REVIEW) return "review build uses inventory files";
  if (!_deps) return "inventory sync is not initialized";
  return autoSyncSkipReason(_deps.getSource(), _deps.isAutoSyncEnabled());
}

// Settings saves re-apply on every change; only log a reason once per change.
function logSkip(context: string, reason: string): void {
  if (_loggedSkip === reason) return;
  _loggedSkip = reason;
  log.info(`Automatic inventory acquisition skipped (${context}) - ${reason}`);
}

/** Start or stop background acquisition to match the source and the setting.
 *  The manual "Run helper now" action stays available either way. */
export function apply(context: string): void {
  const deps = _deps;
  const reason = skipReason();
  if (reason || !deps) {
    if (reason) logSkip(context, reason);
    deps?.runner.stopPolling();
    return;
  }
  _loggedSkip = null;
  deps.runner.startPolling(undefined, deps.onRunComplete);
}

/** EE.log saw a Warframe login; rescan unless acquisition is user-owned. */
export function onGameLogin(): void {
  const deps = _deps;
  const reason = skipReason();
  if (reason || !deps) {
    if (reason) logSkip("game login", reason);
    return;
  }
  deps.runner.runAfterGameLogin();
}
