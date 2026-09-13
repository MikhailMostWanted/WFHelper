import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const source = fs.readFileSync(path.join(process.cwd(), "main.ts"), "utf8");

describe("main window startup", () => {
  it("re-execs with the ozone flag in argv when joining XWayland", () => {
    expect(source).toMatch(/DISPLAY_BACKEND === "x11"[\s\S]*?if \(!OZONE_PLATFORM_ARG\)/);
    expect(source).toContain('process.argv.find((arg) => arg.startsWith("--ozone-platform="))');
    expect(source).toMatch(
      /spawn\(selfPath, \[\.\.\.process\.argv\.slice\(1\), OZONE_X11_ARG\][\s\S]*?detached: true/,
    );
    expect(source).toContain("process.env.APPIMAGE || process.execPath");
  });

  it("decides XWayland from argv and never from desktop capture", () => {
    // Capture cannot see X11 windows on a wayland session; it also asks the portal.
    expect(source).toContain("const JOINED_XWAYLAND = OZONE_PLATFORM_ARG === OZONE_X11_ARG");
    expect(source).toMatch(
      /if \(XWAYLAND_REEXEC_FAILED\) \{[\s\S]*?rememberXWaylandFailure\(\)[\s\S]*?app\.relaunch\(\)/,
    );
    expect(source).not.toContain("desktopCapturer");
  });

  it("blames only a re-exec that should have happened, not a hand-pinned platform", () => {
    expect(source).toContain(
      'const XWAYLAND_REEXEC_FAILED = DISPLAY_BACKEND === "x11" && OZONE_PLATFORM_ARG === undefined',
    );
  });
});
