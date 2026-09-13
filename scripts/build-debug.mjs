import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const env = { ...process.env, WFHELPER_SOURCE_MAPS: "1" };
function run(script, args = []) {
  execFileSync(process.execPath, [script, ...args], { stdio: "inherit", env });
}
run("node_modules/typescript/bin/tsc", [
  "-p",
  "tsconfig.main.json",
  "--sourceMap",
  "--inlineSources",
]);
run("scripts/bundle-preloads.js");
run("node_modules/vite/bin/vite.js", ["build"]);

const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const dirty =
  execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim().length > 0;
const output = path.resolve(".tmp", "debug-symbols", `${commit.slice(0, 12)}-${Date.now()}`);
let maps = 0;
for (const root of [".electron-build", "renderer/dist"]) {
  for (const relative of fs.readdirSync(root, { recursive: true })) {
    if (typeof relative !== "string" || !relative.endsWith(".map")) continue;
    const source = path.join(root, relative);
    const target = path.join(output, root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
    if (fs.existsSync(source.slice(0, -4)))
      fs.copyFileSync(source.slice(0, -4), target.slice(0, -4));
    maps += 1;
  }
}
if (!maps) throw new Error("Debug build produced no source maps");
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
fs.writeFileSync(
  path.join(output, "manifest.json"),
  JSON.stringify({ commit, dirty, version: pkg.version, node: process.version, maps }, null, 2),
);
console.log(`Local debug symbols: ${output} (${maps} maps). No symbols were uploaded.`);
