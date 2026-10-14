import { writable } from "svelte/store";
import { readStorage, writeStorage } from "../lib/persistence.js";
import { SIDEBAR_VIEW_ORDER, type SidebarViewName } from "../lib/viewRegistry.js";

export const launcherOpen = writable(false);
const RECENT_KEY = "wf_wanted_recent_views_v1";

function loadRecent(): SidebarViewName[] {
  try {
    const raw: unknown = JSON.parse(readStorage(RECENT_KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return [
      ...new Set(
        raw.filter((view): view is SidebarViewName =>
          SIDEBAR_VIEW_ORDER.includes(view as SidebarViewName),
        ),
      ),
    ].slice(0, 5);
  } catch {
    return [];
  }
}

export const recentViews = writable<SidebarViewName[]>(loadRecent());

export function rememberView(view: SidebarViewName): void {
  recentViews.update((current) => {
    const next = [view, ...current.filter((id) => id !== view)].slice(0, 5);
    writeStorage(RECENT_KEY, JSON.stringify(next));
    return next;
  });
}
