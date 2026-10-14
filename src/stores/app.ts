import { writable } from "svelte/store";
import { readStorage } from "../lib/persistence.js";
import type { MessageKey } from "../lib/i18n.js";
import type { ViewName } from "../types/views.js";

// The v2 key reruns setup after the 0.2.0 overhaul. Bump only when a future
// overhaul must rerun it again.
export const SETUP_COMPLETED_KEY = "setup-completed-v2";

function getInitialView(): ViewName {
  return readStorage(SETUP_COMPLETED_KEY) === "1" ? "inventory" : "setup";
}

export const currentView = writable<ViewName>(getInitialView());

// Consumed once when Settings opens; normal sidebar navigation still starts at General.
export const settingsTabRequest = writable<"chatgpt" | null>(null);

type StatusMessage = {
  key: MessageKey;
  params?: Record<string, string | number>;
};

export const statusText = writable<StatusMessage | null>({ key: "app.noInventoryLoaded" });
