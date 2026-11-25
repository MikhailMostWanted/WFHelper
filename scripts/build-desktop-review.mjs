import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const root = fileURLToPath(new URL("..", import.meta.url));
const [version, output, target = "nsis"] = process.argv.slice(2);
if (
  !/^\d+\.\d+\.\d+-preview\.\d+$/.test(version ?? "") ||
  !output ||
  !["nsis", "dir", "renderer"].includes(target)
) {
  throw new Error(
    "Usage: pnpm run dist:win:review <version>-preview.<n> <new-output-directory> [nsis|dir|renderer]",
  );
}
const out = path.resolve(output);
const stage = path.join(out, "source");
const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
git("diff", "--quiet", "HEAD");
const revision = git("rev-parse", "HEAD").trim();
const paths = git("ls-files", "-z").split("\0").filter(Boolean);
const brandDir = process.env.WANTEDFRAME_BRAND_DIR;
if (brandDir && process.env.GITHUB_ACTIONS === "true") {
  throw new Error("The private WANTED kit is only supported by a local review build.");
}

function copy(source, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(source, dest);
}

function stageCopy(relative, source = path.join(root, relative)) {
  copy(source, path.join(stage, relative));
}

function pngIco(png) {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(header.length, 18);
  return Buffer.concat([header, png]);
}

const icons = {
  Dashboard: "M5 5H19V19H5ZM5 10H19M11 10V19",
  IconWarframe_256: "M5 8L12 4L19 8V16L12 20L5 16ZM5 8L12 12L19 8M12 12V20",
  Foundry: "M7 5H17V9L14 12L17 15V19H7V15L10 12L7 9Z",
  Market: "M5 9H19M16 6L19 9L16 12M19 15H5M8 12L5 15L8 18",
  Navigation: "M5 19L10 6L19 5L18 14ZM10 6L18 14",
  Settings: "M5 7H19M5 12H19M5 17H19M9 5V9M15 10V14M11 15V19",
};
function iconSvg(relative) {
  const name = path.basename(relative, path.extname(relative));
  const glyph = icons[name] ?? "M6 8L12 5L18 8V16L12 19L6 16ZM6 8L12 12L18 8";
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24"><path d="${glyph}" fill="none" stroke="#9ca7b7" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  );
}

const setupBackdrop = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="720" height="405"><rect width="720" height="405" fill="#15191f"/><path d="M40 40H680V365H40ZM360 40V365M40 202.5H680" stroke="#343c47" fill="none"/></svg>',
);

function quietSound() {
  const sampleRate = 8000;
  const samples = 800;
  const wav = Buffer.alloc(44 + samples, 128);
  wav.write("RIFF");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate, 28);
  wav.writeUInt16LE(1, 32);
  wav.writeUInt16LE(8, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(samples, 40);
  return wav;
}

function installBrand() {
  if (!brandDir) return;
  const files = [
    ["assets/mark-white.svg", "assets/wanted-mark-white.svg"],
    ["fonts/unbounded-medium.woff2", "src/assets/fonts/wanted-display.woff2"],
    ["fonts/Unbounded-OFL.txt", "assets/OFL-Unbounded.txt"],
  ];
  for (const [name, dest] of files) stageCopy(dest, path.join(brandDir, name));
  const kit = JSON.parse(fs.readFileSync(path.join(brandDir, "native/tokens.json"), "utf8"));
  const roles = [
    "background",
    "surface",
    "text",
    "muted",
    "border",
    "control_border",
    "focus",
    "warning",
  ];
  const properties = roles.map((role) => {
    const value = kit.colors.dark[role];
    if (!/^#[\da-f]{6}$/i.test(value ?? "")) throw new Error(`Invalid brand role: ${role}`);
    return `  --wf-brand-${role.replaceAll("_", "-")}: ${value};`;
  });
  fs.writeFileSync(
    path.join(stage, "src/styles/preview-brand.css"),
    [
      '@font-face { font-family: "Wanted Display"; src: url("../assets/fonts/wanted-display.woff2") format("woff2"); font-weight: 500; font-display: swap; }',
      ":root {",
      ...properties,
      '  --wf-brand-mark: url("../../assets/wanted-mark-white.svg");',
      '  --wf-brand-display: "Wanted Display", Onest, sans-serif;',
      `  --wf-brand-fast: ${Number(kit.motion_ms.fast)}ms;`,
      "}",
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(stage, "src/app.css"),
    '@import "./styles/preview-brand.css";\n' +
      fs.readFileSync(path.join(root, "src/app.css"), "utf8"),
  );
}

fs.mkdirSync(out);
fs.mkdirSync(stage);
const originalArt = paths.filter(
  (relative) => relative.startsWith("assets/") && !relative.endsWith(".txt"),
);
for (const relative of paths) {
  if (originalArt.includes(relative) || relative.startsWith("resources/riven-ocr/")) continue;
  stageCopy(relative);
}
for (const relative of originalArt) {
  const ext = path.extname(relative);
  if (relative.startsWith("assets/logo.") || ext === ".dds") continue;
  const dest = path.join(stage, relative);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const art = relative.startsWith("assets/setup/") ? setupBackdrop : iconSvg(relative);
  if (ext === ".svg") fs.writeFileSync(dest, art);
  else if (ext === ".wav") fs.writeFileSync(dest, quietSound());
  else if ([".png", ".webp", ".jpg"].includes(ext)) await sharp(art).toFile(dest);
}
const appIcon = await sharp(
  brandDir ? path.join(brandDir, "assets/app-icon-dark-256.png") : iconSvg("Dashboard.png"),
)
  .resize(256, 256)
  .png()
  .toBuffer();
fs.writeFileSync(path.join(stage, "assets/logo.png"), appIcon);
fs.writeFileSync(path.join(stage, "assets/logo.ico"), pngIco(appIcon));
installBrand();

const crossWindows = process.platform !== "win32" && target !== "renderer";
if (crossWindows) {
  fs.appendFileSync(
    path.join(stage, "pnpm-workspace.yaml"),
    "\nsupportedArchitectures:\n  os: [current, win32]\n  cpu: [current, x64]\n",
  );
}
const manifest = {
  revision,
  version,
  privateBrand: Boolean(brandDir),
  artwork: "neutral replacements",
  rivenModels: false,
  marketSignIn: false,
};
fs.mkdirSync(path.join(stage, "resources"), { recursive: true });
fs.writeFileSync(
  path.join(stage, "resources/desktop-review.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
const packagePath = path.join(stage, "package.json");
const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
const installerInclude = "build/desktop-review.nsh";
fs.writeFileSync(
  path.join(stage, installerInclude),
  "!define WF_DESKTOP_REVIEW\n" + fs.readFileSync(path.join(stage, pkg.build.nsis.include), "utf8"),
);
pkg.version = version;
pkg.build.extraResources = pkg.build.extraResources.filter((item) => item.to !== "riven-ocr");
pkg.build.extraResources.push({ from: "resources/desktop-review.json", to: "desktop-review.json" });
pkg.build.nsis.differentialPackage = false;
pkg.build.nsis.include = installerInclude;
pkg.build.publish = null;
if (crossWindows) {
  pkg.build.npmRebuild = false;
  pkg.build.win.signAndEditExecutable = false;
}
fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + "\n");

const env = {
  ...process.env,
  HUSKY: "0",
  WFHELPER_DESKTOP_REVIEW: "1",
  VITE_WF_DESKTOP_REVIEW: "1",
  VITE_WANTED_BRAND: brandDir ? "1" : "0",
  CSC_IDENTITY_AUTO_DISCOVERY: "false",
};
const pnpm = process.env.npm_execpath;
function run(...args) {
  const options = { cwd: stage, env, stdio: "inherit" };
  if (pnpm) execFileSync(process.execPath, [pnpm, ...args], options);
  else execFileSync("pnpm", args, options);
}
run("install", "--frozen-lockfile");
run("run", "build");
if (target !== "renderer") {
  const args = ["exec", "electron-builder", "--win", "--x64", "--publish", "never"];
  args.push(target === "dir" ? "--dir" : "nsis");
  run(...args);
}
const setup = path.join(stage, "release", `WantedFrame-${version}-Setup.exe`);
if (target === "nsis") {
  const artifact = path.basename(setup);
  const sha256 = createHash("sha256").update(fs.readFileSync(setup)).digest("hex");
  fs.writeFileSync(
    path.join(out, "artifact.json"),
    JSON.stringify({ ...manifest, artifact, sha256 }, null, 2) + "\n",
  );
}
