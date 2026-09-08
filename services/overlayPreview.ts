import path from "node:path";
import { pathToFileURL } from "node:url";
import type { OverlayLayoutKind } from "../config/shared/overlayLayout";

const FILES: Record<OverlayLayoutKind, string> = {
  reward: "overlay.html",
  planner: "overlay.html",
  rivenLeft: "riven-overlay.html",
  rivenRight: "riven-overlay.html",
  arbiSummary: "arbi-overlay.html",
  tradeNotification: "trade-notification.html",
};

export function overlayPreviewFilePaths(root: string): string[] {
  return [...new Set(Object.values(FILES))].map((file) => path.join(root, "renderer", file));
}

export function overlayPreviewUrl(root: string, kind: OverlayLayoutKind): string {
  const url = new URL(pathToFileURL(path.join(root, "renderer", FILES[kind])).href);
  url.searchParams.set("mode", "editor");
  url.searchParams.set("kind", kind);
  if (kind === "rivenRight") url.searchParams.set("side", "right");
  return url.href;
}
