import { existsSync } from "node:fs";
import { join } from "node:path";

export const DESKTOP_REVIEW =
  process.env.WFHELPER_DESKTOP_REVIEW === "1" ||
  Boolean(process.resourcesPath && existsSync(join(process.resourcesPath, "desktop-review.json")));
