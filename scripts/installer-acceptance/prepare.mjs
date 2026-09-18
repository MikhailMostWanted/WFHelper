import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const usage =
  "prepare.mjs --previous OLD.exe --previous-version VERSION --current NEW.exe " +
  "--current-version VERSION --output NEW_DIRECTORY";
const args = process.argv.slice(2);
const options = new Map();
for (let index = 0; index < args.length; index += 2) {
  const key = args[index];
  const value = args[index + 1];
  if (
    !["--previous", "--previous-version", "--current", "--current-version", "--output"].includes(
      key,
    ) ||
    !value ||
    value.startsWith("--") ||
    options.has(key)
  )
    throw new Error(usage);
  options.set(key, value);
}
if (options.size !== 5) throw new Error(usage);
if (options.get("--previous-version") === options.get("--current-version")) {
  throw new Error("Upgrade acceptance requires two different release versions");
}
if (process.platform !== "win32") throw new Error("Prepare this Windows Sandbox bundle on Windows");
const destination = path.resolve(options.get("--output"));
if (fs.existsSync(destination)) throw new Error("Output directory must not already exist");
for (const phase of ["previous", "current"]) {
  const file = path.resolve(options.get(`--${phase}`));
  if (!file.toLowerCase().endsWith(".exe") || !fs.statSync(file).isFile()) {
    throw new Error(`${phase} must name an NSIS installer .exe`);
  }
  if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(options.get(`--${phase}-version`))) {
    throw new Error(`${phase}-version must be a version such as 1.3.4 or 2.0.0-beta.1`);
  }
}
const input = path.join(destination, "inputs");
const output = path.join(destination, "results");
fs.mkdirSync(input, { recursive: true });
fs.mkdirSync(output);
const manifest = {};
for (const phase of ["previous", "current"]) {
  const file = `${phase}.exe`;
  fs.copyFileSync(path.resolve(options.get(`--${phase}`)), path.join(input, file));
  manifest[phase] = {
    file,
    version: options.get(`--${phase}-version`),
    sha256: createHash("sha256")
      .update(fs.readFileSync(path.join(input, file)))
      .digest("hex"),
  };
}
fs.writeFileSync(path.join(input, "manifest.json"), JSON.stringify(manifest, null, 2));
for (const file of ["run.ps1", "verify.mjs"]) {
  fs.copyFileSync(path.join(import.meta.dirname, file), path.join(input, file));
}
fs.copyFileSync(process.execPath, path.join(input, "node.exe"));
const xml = (value) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
fs.writeFileSync(
  path.join(destination, "WantedFrame-upgrade.wsb"),
  `<Configuration>
  <Networking>Disable</Networking>
  <ClipboardRedirection>Disable</ClipboardRedirection>
  <AudioInput>Disable</AudioInput>
  <VideoInput>Disable</VideoInput>
  <PrinterRedirection>Disable</PrinterRedirection>
  <MappedFolders>
    <MappedFolder><HostFolder>${xml(input)}</HostFolder><SandboxFolder>C:\\WantedFrameInputs</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
    <MappedFolder><HostFolder>${xml(output)}</HostFolder><SandboxFolder>C:\\WantedFrameResults</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>
  </MappedFolders>
  <LogonCommand><Command>powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\\WantedFrameInputs\\run.ps1 -InWindowsSandbox</Command></LogonCommand>
</Configuration>
`,
);
console.log(`Prepared: ${path.join(destination, "WantedFrame-upgrade.wsb")}`);
console.log("No installers were run. Open the .wsb file to execute inside Windows Sandbox.");
