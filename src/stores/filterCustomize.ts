import { readonly, writable } from "svelte/store";

import type { FilterScope } from "../types/filters.js";

// Inventory renders two bars over one stored layout, so a scope keeps at most one
// open popover, tracked by the token of the bar that opened it.
const owners = writable<Partial<Record<FilterScope, symbol>>>({});

export const filterCustomizeOwners = readonly(owners);

/** Returns whether the popover is open for this bar after the toggle. */
export function toggleFilterCustomize(scope: FilterScope, owner: symbol): boolean {
  let opened = false;
  owners.update((current) => {
    opened = current[scope] !== owner;
    const next = { ...current };
    if (opened) next[scope] = owner;
    else delete next[scope];
    return next;
  });
  return opened;
}

export function closeFilterCustomize(scope: FilterScope, owner: symbol): void {
  owners.update((current) => {
    if (current[scope] !== owner) return current;
    const next = { ...current };
    delete next[scope];
    return next;
  });
}
