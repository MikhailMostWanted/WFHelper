import { get, writable, type Readable } from "svelte/store";

import {
  beginUndoGroup,
  endUndoGroup,
  layoutState,
  moveSection,
  sectionsOf,
} from "../../stores/layout.js";
import type { LayoutBreakpoint, LayoutView } from "./types.js";

const draggingId = writable<string | null>(null);

/** Section the pointer is dragging. Crossing a column destroys and recreates the
    handle, so the grabbing state cannot live inside the component. */
export const draggingSectionId: Readable<string | null> = { subscribe: draggingId.subscribe };

interface ActiveDrag {
  view: LayoutView;
  breakpoint: LayoutBreakpoint;
  id: string;
  pointerId: number;
  /** Ids this screen renders; a hit outside them belongs to another grid. */
  scope: readonly string[] | null;
  /** Grid the drag started in, or null for a section rendered outside one. */
  grid: Element | null;
  lastCell: string | null;
}

let active: ActiveDrag | null = null;

interface DropHit {
  id: string;
  /** Pointer sits below the section's midpoint, so the drop lands under it. */
  after: boolean;
}

function cellOf(hit: DropHit): string {
  return `${hit.id}|${hit.after ? "after" : "before"}`;
}

/** Drop rule for one pointer position. A null hit leaves the layout alone;
    landing back on the dragged section forgets the last drop cell so the user
    can re-enter it. */
export function resolveDropTarget(
  drag: { id: string; scope: readonly string[] | null; lastCell: string | null },
  hit: DropHit | null,
  sameGrid: boolean,
): { targetId: string | null; after: boolean; lastCell: string | null } {
  const keep = { targetId: null, after: false, lastCell: drag.lastCell };
  if (!hit) return keep;
  if (hit.id === drag.id) return { targetId: null, after: false, lastCell: null };
  const cell = cellOf(hit);
  if (cell === drag.lastCell || !sameGrid) return keep;
  if (drag.scope && !drag.scope.includes(hit.id)) return keep;
  return { targetId: hit.id, after: hit.after, lastCell: cell };
}

/** Absolute index for the drop, or null when it would not move anything. The
    dragged section is spliced out before the insert, so a target below it has
    already shifted up by one; correcting again would skip a slot. */
export function dropIndex(
  order: readonly string[],
  id: string,
  targetId: string,
  after: boolean,
): number | null {
  const from = order.indexOf(id);
  const to = order.indexOf(targetId);
  if (from < 0 || to < 0) return null;
  const shifted = from < to ? to - 1 : to;
  const at = after ? shifted + 1 : shifted;
  return at === from ? null : at;
}

function isBelowMidpoint(section: Element, clientY: number): boolean {
  const rect = section.getBoundingClientRect();
  if (rect.height <= 0) return false;
  return clientY > rect.top + rect.height / 2;
}

function onPointerMove(event: PointerEvent): void {
  if (!active || event.pointerId !== active.pointerId) return;
  const hit = document.elementFromPoint(event.clientX, event.clientY);
  const section = hit?.closest("[data-layout-section]") ?? null;
  const targetId = section?.getAttribute("data-layout-section") ?? null;
  // A section rendered outside a grid (the stats trade rail) has no grid to
  // compare, so its id scope is the only fence.
  const sameGrid = active.grid === null || section?.closest("[data-layout-grid]") === active.grid;
  const decision = resolveDropTarget(
    active,
    section && targetId ? { id: targetId, after: isBelowMidpoint(section, event.clientY) } : null,
    sameGrid,
  );
  active.lastCell = decision.lastCell;
  if (!decision.targetId) return;
  const order = sectionsOf(get(layoutState), active.view, active.breakpoint).map(
    (entry) => entry.id,
  );
  const at = dropIndex(order, active.id, decision.targetId, decision.after);
  if (at !== null) moveSection(active.view, active.breakpoint, active.id, at);
}

function onPointerUp(event: PointerEvent): void {
  if (active && event.pointerId !== active.pointerId) return;
  endDrag();
}

// Pointer capture dies with the handle the first move remounts, and without it
// dragging over the page paints a text selection across every section.
function suppressSelection(on: boolean): void {
  document.body.style.userSelect = on ? "none" : "";
}

function endDrag(): void {
  if (!active) return;
  active = null;
  draggingId.set(null);
  suppressSelection(false);
  endUndoGroup();
  window.removeEventListener("pointermove", onPointerMove, true);
  window.removeEventListener("pointerup", onPointerUp, true);
  window.removeEventListener("pointercancel", onPointerUp, true);
  window.removeEventListener("blur", endDrag);
}

/** Runs the whole gesture off window, so the remount a cross-column move causes
    cannot end the drag with the handle that started it. */
export function beginSectionDrag(options: {
  view: LayoutView;
  breakpoint: LayoutBreakpoint;
  id: string;
  pointerId: number;
  scope: readonly string[] | null;
  /** Handle that was grabbed; the drag is fenced to the grid it sits in. */
  from: Element | null;
}): void {
  endDrag();
  if (typeof window === "undefined") return;
  active = {
    view: options.view,
    breakpoint: options.breakpoint,
    id: options.id,
    pointerId: options.pointerId,
    scope: options.scope && options.scope.length > 0 ? options.scope : null,
    grid: options.from?.closest("[data-layout-grid]") ?? null,
    lastCell: null,
  };
  draggingId.set(options.id);
  suppressSelection(true);
  beginUndoGroup(options.view, options.breakpoint, options.id);
  window.addEventListener("pointermove", onPointerMove, true);
  window.addEventListener("pointerup", onPointerUp, true);
  window.addEventListener("pointercancel", onPointerUp, true);
  window.addEventListener("blur", endDrag);
}
