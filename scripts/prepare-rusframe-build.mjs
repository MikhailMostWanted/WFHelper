import fs from "node:fs";

function replaceInFile(file, replacements) {
  let text = fs.readFileSync(file, "utf8");
  for (const [from, to] of replacements) {
    if (!text.includes(from)) {
      throw new Error(`Expected text not found in ${file}: ${from}`);
    }
    text = text.replaceAll(from, to);
  }
  fs.writeFileSync(file, text, "utf8");
}

const pkgPath = "package.json";
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
pkg.build.appId = "com.rusframe.app";
pkg.build.productName = "RusFrame";
pkg.build.nsis.shortcutName = "RusFrame";
pkg.build.nsis.uninstallDisplayName = "RusFrame";
pkg.build.nsis.artifactName = "RusFrame-${version}-Setup.${ext}";
delete pkg.build.publish;
fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");

replaceInFile("config/shared/appMeta.ts", [
  ['export const APP_PRODUCT_NAME = "WFHelper";', 'export const APP_PRODUCT_NAME = "RusFrame";'],
  ['export const WIN_APP_USER_MODEL_ID = "com.wfhelper.app";', 'export const WIN_APP_USER_MODEL_ID = "com.rusframe.app";'],
]);

replaceInFile("config/runtime/appIdentity.ts", [
  ['const LEGACY_USER_DATA_DIR_NAMES = ["warframe-companion"];', 'const LEGACY_USER_DATA_DIR_NAMES = ["WFHelper", "warframe-companion"];'],
]);

replaceInFile("services/warframeLifecycle.ts", [
  ['const LOGIN_ITEM_NAME = "WFHelperWarframeWatcher";', 'const LOGIN_ITEM_NAME = "RusFrameWarframeWatcher";'],
]);

replaceInFile("build/installer.nsh", [
  ['Software\\WFHelper', 'Software\\RusFrame'],
  ['WFHelperWarframeWatcher', 'RusFrameWarframeWatcher'],
  ['$APPDATA\\WFHelper', '$APPDATA\\RusFrame'],
]);

console.log("Prepared isolated RusFrame Windows build identity.");
