// Capture game content through GDI on Windows or Electron elsewhere.

import type { NativeImage } from "electron";
import { withScope } from "./logger";
import { captureGdi, getGameWindowClientRect, type GdiCaptureTarget } from "./dxgiCapture";
import { captureLinuxStreamFrame } from "./linuxStreamCapture";
import { getWarframeWindowBoundsLinux } from "./warframeStatus";
import { detectGameContentRect } from "./rewardScannerImage";
import { normalizeErrorMessage } from "../config/shared/errors";

const log = withScope("screenCapture");

// The window rect is re-read per capture; a riven session scans in bursts, so a
// short cache keeps the tree walk off the hot path without missing a move.
const GAME_WINDOW_CACHE_TTL_MS = 750;
// A frame covering more than one display has no single scale to map through.
const SCALE_MISMATCH_TOLERANCE = 0.02;
const EDGE_SLACK_PX = 2;
// Anything smaller than this is a bad read, not a game window.
const MIN_CONTENT_WIDTH_PX = 320;
const MIN_CONTENT_HEIGHT_PX = 240;

export interface CaptureResult {
  image: NativeImage;
  sourceType: "window" | "screen";
  sourceName: string;
  sourceId: string;
  sourceDisplayId: string;
}

interface CaptureOptions {
  preferredDisplayId?: string | null;
}

// BitBlt reads the virtual screen, so the target monitor has to arrive as
// physical bounds. Electron's Display.id is not an HMONITOR and never was.
async function resolveGdiTarget(
  gameRect: ReturnType<typeof getGameWindowClientRect>,
  preferredDisplayId?: string | null,
): Promise<GdiCaptureTarget | null> {
  const wanted = preferredDisplayId?.trim() || null;
  if (!gameRect && !wanted) return null;
  try {
    const { screen } = await import("electron");
    const display = gameRect
      ? screen.getDisplayMatching(screen.screenToDipRect(null, gameRect))
      : screen.getAllDisplays().find((d) => String(d.id) === wanted);
    if (!display) return null;
    const bounds = screen.dipToScreenRect(null, display.bounds);
    if (!bounds?.width || !bounds.height) return null;
    return {
      displayId: String(display.id),
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    };
  } catch (err) {
    log.warn("[ScreenCapture] game display lookup skipped:", normalizeErrorMessage(err));
    return null;
  }
}

async function captureWin32Gdi(preferredDisplayId?: string | null): Promise<CaptureResult | null> {
  let gameRect: ReturnType<typeof getGameWindowClientRect> = null;
  try {
    gameRect = getGameWindowClientRect();
  } catch (err) {
    log.warn("[ScreenCapture] game window lookup skipped:", normalizeErrorMessage(err));
  }

  const target = await resolveGdiTarget(gameRect, preferredDisplayId);
  const gdiResult = captureGdi(target);
  if (!gdiResult) return null;
  // dynamic import keeps electron lazy and lets tests mock it
  const { nativeImage } = await import("electron");
  let img = nativeImage.createFromBitmap(gdiResult.buffer, {
    width: gdiResult.width,
    height: gdiResult.height,
  });
  if (!img || img.isEmpty()) return null;
  // Crop windowed captures so layout ratios exclude desktop and window chrome.
  let sourceType: CaptureResult["sourceType"] = "screen";
  if (gameRect) {
    const ox = gameRect.x - gdiResult.originX;
    const oy = gameRect.y - gdiResult.originY;
    const x = Math.max(0, ox);
    const y = Math.max(0, oy);
    const width = Math.min(gdiResult.width, ox + gameRect.width) - x;
    const height = Math.min(gdiResult.height, oy + gameRect.height) - y;
    const isSubRegion =
      width < gdiResult.width - EDGE_SLACK_PX || height < gdiResult.height - EDGE_SLACK_PX;
    if (isSubRegion && width >= MIN_CONTENT_WIDTH_PX && height >= MIN_CONTENT_HEIGHT_PX) {
      img = img.crop({ x, y, width, height });
      sourceType = "window";
      log.info(`[ScreenCapture] cropped to Warframe client rect ${width}x${height} at (${x},${y})`);
    }
  }
  return {
    image: img,
    sourceType,
    sourceName: "GDI BitBlt",
    sourceId: `gdi:${gdiResult.displayId || "0"}`,
    sourceDisplayId: gdiResult.displayId || "",
  };
}

// Off-Windows stand-in for the client-rect crop: trim letterbox/pillarbox bars
// so crop ratios anchor to game content. Windowed mode stays best-effort.
function trimToGameContent(img: NativeImage): NativeImage {
  try {
    const size = img.getSize();
    const content = detectGameContentRect(img);
    const isSubRegion =
      content.width < size.width - EDGE_SLACK_PX || content.height < size.height - EDGE_SLACK_PX;
    if (
      isSubRegion &&
      content.width >= MIN_CONTENT_WIDTH_PX &&
      content.height >= MIN_CONTENT_HEIGHT_PX
    ) {
      log.info(
        `[ScreenCapture] trimmed letterbox to ${content.width}x${content.height} at (${content.x},${content.y})`,
      );
      return img.crop(content);
    }
  } catch (err) {
    log.warn("[ScreenCapture] content trim skipped:", normalizeErrorMessage(err));
  }
  return img;
}

type GameWindowRect = Awaited<ReturnType<typeof getWarframeWindowBoundsLinux>>;

let cachedGameWindow: GameWindowRect = null;
let cachedGameWindowAt = 0;
let lastLinuxCropLog = "";

async function readGameWindowCached(): Promise<GameWindowRect> {
  const now = Date.now();
  if (now - cachedGameWindowAt < GAME_WINDOW_CACHE_TTL_MS) return cachedGameWindow;
  cachedGameWindow = await getWarframeWindowBoundsLinux();
  cachedGameWindowAt = now;
  return cachedGameWindow;
}

function resetGameWindowCacheForTest(): void {
  cachedGameWindow = null;
  cachedGameWindowAt = 0;
  lastLinuxCropLog = "";
}

function noteLinuxCrop(message: string): void {
  if (lastLinuxCropLog === message) return;
  lastLinuxCropLog = message;
  log.info(`[ScreenCapture] ${message}`);
}

// Linux twin of the Win32 client-rect crop. The letterbox heuristic reads dark
// game art as bars, so ask X where the window actually is before guessing.
async function cropToLinuxGameWindow(img: NativeImage): Promise<NativeImage | null> {
  const bounds = await readGameWindowCached();
  if (!bounds) return null;

  const size = img.getSize();
  // The portal usually hands back the game's own window - the frame IS the crop.
  if (
    Math.abs(size.width - bounds.width) <= EDGE_SLACK_PX &&
    Math.abs(size.height - bounds.height) <= EDGE_SLACK_PX
  ) {
    noteLinuxCrop(`frame is the Warframe window ${size.width}x${size.height} - no crop`);
    return img;
  }

  const { screen } = await import("electron");
  const area = screen.getDisplayMatching(bounds)?.bounds;
  if (!area?.width || !area.height) return null;
  const scaleX = size.width / area.width;
  const scaleY = size.height / area.height;
  if (Math.abs(scaleX - scaleY) > SCALE_MISMATCH_TOLERANCE) return null;

  const x = Math.max(0, Math.round((bounds.x - area.x) * scaleX));
  const y = Math.max(0, Math.round((bounds.y - area.y) * scaleY));
  const width = Math.min(size.width - x, Math.round(bounds.width * scaleX));
  const height = Math.min(size.height - y, Math.round(bounds.height * scaleY));
  if (width < MIN_CONTENT_WIDTH_PX || height < MIN_CONTENT_HEIGHT_PX) return null;

  if (width >= size.width - EDGE_SLACK_PX && height >= size.height - EDGE_SLACK_PX) {
    noteLinuxCrop(`Warframe fills the frame ${size.width}x${size.height} - no crop`);
    return img;
  }
  noteLinuxCrop(`cropped to Warframe window ${width}x${height} at (${x},${y})`);
  return img.crop({ x, y, width, height });
}

interface GameContentCrop {
  image: NativeImage;
  /** X named the window, so the frame is already the client area and needs no bar search. */
  isGameWindow: boolean;
}

// X first, bar-detection only when X cannot answer (no libX11, no xwininfo).
async function cropToGameContent(img: NativeImage): Promise<GameContentCrop> {
  if (process.platform === "linux") {
    try {
      const cropped = await cropToLinuxGameWindow(img);
      if (cropped) return { image: cropped, isGameWindow: true };
      // Said out loud: a silent fallback reads exactly like a clean pass in a log.
      noteLinuxCrop("no Warframe window rect from X - falling back to bar detection");
    } catch (err) {
      log.warn("[ScreenCapture] window-rect crop skipped:", normalizeErrorMessage(err));
    }
  }
  return { image: trimToGameContent(img), isGameWindow: false };
}

async function captureDesktopCapturer(
  preferredDisplayId?: string | null,
): Promise<CaptureResult | null> {
  try {
    const { desktopCapturer, screen } = await import("electron");
    const displays = screen.getAllDisplays();
    const wanted = preferredDisplayId?.trim() || null;
    const target =
      (wanted && displays.find((d) => String(d.id) === wanted)) || screen.getPrimaryDisplay();
    const scale = target.scaleFactor || 1;
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: {
        width: Math.round(target.size.width * scale),
        height: Math.round(target.size.height * scale),
      },
    });
    const source = sources.find((s) => s.display_id === String(target.id)) || sources[0];
    if (!source || source.thumbnail.isEmpty()) return null;
    const content = await cropToGameContent(source.thumbnail);
    return {
      image: content.image,
      sourceType: content.isGameWindow ? "window" : "screen",
      sourceName: source.name || "desktopCapturer",
      sourceId: source.id,
      sourceDisplayId: source.display_id || String(target.id),
    };
  } catch (err) {
    log.warn("[ScreenCapture] desktopCapturer capture failed:", normalizeErrorMessage(err));
    return null;
  }
}

// Do not fall back after portal capture fails because that would reopen its picker.
async function captureLinuxStream(): Promise<CaptureResult | null> {
  try {
    const frame = await captureLinuxStreamFrame();
    if (!frame) return null;
    const content = await cropToGameContent(frame);
    return {
      image: content.image,
      sourceType: content.isGameWindow ? "window" : "screen",
      sourceName: "getDisplayMedia stream",
      sourceId: "linux-stream",
      sourceDisplayId: "",
    };
  } catch (err) {
    log.warn("[ScreenCapture] linux stream capture failed:", normalizeErrorMessage(err));
    return null;
  }
}

// Do not fall back after GDI failure because desktopCapturer can return stale MPO content.
export async function captureScreenFast(
  preferredDisplayId?: string | null,
  _captureTimeoutMs = 0,
): Promise<CaptureResult | null> {
  if (process.platform === "linux") {
    return captureLinuxStream();
  }
  if (process.platform !== "win32") {
    return captureDesktopCapturer(preferredDisplayId);
  }
  try {
    return await captureWin32Gdi(preferredDisplayId);
  } catch (err) {
    log.warn("[ScreenCapture] GDI capture failed:", normalizeErrorMessage(err));
    return null;
  }
}

export const __test__ = { resetGameWindowCacheForTest };

export async function captureSourceMeta(options: CaptureOptions = {}): Promise<{
  sourceType: string | null;
  sourceName: string | null;
  sourceId: string | null;
  sourceDisplayId: string | null;
} | null> {
  const screenshot = await captureScreenFast(options.preferredDisplayId || null);
  if (!screenshot) return null;

  return {
    sourceType: screenshot.sourceType || null,
    sourceName: screenshot.sourceName || null,
    sourceId: screenshot.sourceId || null,
    sourceDisplayId: screenshot.sourceDisplayId || null,
  };
}
