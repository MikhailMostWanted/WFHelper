import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import type { BrowserWindow } from "electron";
import { __test__, hardenBrowserWindowNavigation } from "../../services/windowSecurity";

describe("window security URL guards", () => {
  it("permits the reward preview only as an allowlisted subframe", () => {
    const callbacks = new Map<
      string,
      (event: { url: string; isMainFrame: boolean; preventDefault: () => void }) => void
    >();
    const mainPath = path.join(process.cwd(), "renderer", "dist", "index.html");
    const overlayPath = path.join(process.cwd(), "renderer", "overlay.html");
    const window = {
      isDestroyed: () => false,
      webContents: {
        setWindowOpenHandler: () => {},
        on: (
          name: string,
          callback: (event: {
            url: string;
            isMainFrame: boolean;
            preventDefault: () => void;
          }) => void,
        ) => callbacks.set(name, callback),
      },
    } as unknown as BrowserWindow;
    hardenBrowserWindowNavigation(window, {
      allowedFilePaths: [mainPath],
      allowedSubframeFilePaths: [overlayPath],
    });
    for (const [url, isMainFrame, allowed] of [
      [`${pathToFileURL(overlayPath).href}?mode=editor`, false, true],
      [pathToFileURL(mainPath).href, true, true],
      [pathToFileURL(overlayPath).href, true, false],
      [pathToFileURL(path.join(process.cwd(), "private.html")).href, false, false],
      ["https://example.com/overlay.html", false, false],
    ] as const) {
      let blocked = false;
      callbacks.get("will-frame-navigate")!({
        url,
        isMainFrame,
        preventDefault: () => {
          blocked = true;
        },
      });
      expect(blocked, url).toBe(!allowed);
    }
  });
  it("allows only exact file URL targets from allowlist", () => {
    const indexPath = path.join(process.cwd(), "renderer", "dist", "index.html");
    const overlayPath = path.join(process.cwd(), "renderer", "overlay.html");
    const allowed = __test__.normalizeAllowedFiles([indexPath]);

    expect(__test__.isAllowedFileNavigation(pathToFileURL(indexPath).href, allowed)).toBe(true);

    expect(__test__.isAllowedFileNavigation(pathToFileURL(overlayPath).href, allowed)).toBe(false);

    expect(__test__.isAllowedFileNavigation("https://example.com", allowed)).toBe(false);
  });
});
