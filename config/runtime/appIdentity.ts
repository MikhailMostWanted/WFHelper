import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { APP_PRODUCT_NAME } from "../shared/appMeta";

const APP_USER_DATA_DIR_NAME = APP_PRODUCT_NAME;
const LEGACY_USER_DATA_DIR_NAMES = ["RusFrame", "WFHelper", "warframe-companion"];
const MIGRATION_MARKER = ".wantedframe-migrated";

function directoryHasEntries(dir: string): boolean {
  try {
    return fs.readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

function copyLegacyUserData(appDataRoot: string, targetDir: string): void {
  const marker = path.join(targetDir, MIGRATION_MARKER);
  if (fs.existsSync(marker)) return;

  let copiedFrom: string | null = null;
  for (const legacyName of LEGACY_USER_DATA_DIR_NAMES) {
    const legacyDir = path.join(appDataRoot, legacyName);
    if (legacyDir === targetDir || !directoryHasEntries(legacyDir)) continue;

    try {
      fs.mkdirSync(targetDir, { recursive: true });
      fs.cpSync(legacyDir, targetDir, {
        recursive: true,
        force: false,
        errorOnExist: false,
      });
      copiedFrom ??= legacyName;
    } catch {
      continue;
    }
  }

  try {
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(
      marker,
      copiedFrom ? `migrated from ${copiedFrom}\n` : "no legacy profile found\n",
      "utf8",
    );
  } catch {}
}

const appDataRoot = app.getPath("appData");
const userDataPath = path.join(appDataRoot, APP_USER_DATA_DIR_NAME);

app.setName(APP_PRODUCT_NAME);

// E2E isolates disk state because overriding APPDATA does not move Electron userData.
const userDataOverride = process.env.WFHELPER_USER_DATA;
if (userDataOverride) {
  app.setPath("userData", userDataOverride);
} else {
  copyLegacyUserData(appDataRoot, userDataPath);
  app.setPath("userData", userDataPath);
}
