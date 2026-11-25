const { existsSync, readdirSync, readFileSync } = require("node:fs");
const path = require("node:path");
const asar = require("@electron/asar");
const runtimeAssets = require("./runtime-assets.cjs");

const requiredAsarFiles = runtimeAssets.asarFiles;

function resourcesRoot(context) {
  return path.join(context.appOutDir, "resources");
}

exports.default = async function verifyPackagedRuntimeAssets(context) {
  const root = resourcesRoot(context);
  const sourceRoot = path.resolve(__dirname, "..");
  const reviewMarker = "desktop-review.json";
  const reviewSource = path.join(sourceRoot, "resources", reviewMarker);
  const review = existsSync(reviewSource);
  const requiredResources = [
    ...runtimeAssets.packagedResources,
    ...(review ? [reviewMarker] : runtimeAssets.onnxAssets),
  ];
  const missing = requiredResources.filter(
    (relativePath) => !existsSync(path.join(root, relativePath)),
  );

  if (missing.length > 0) {
    throw new Error(`Packaged build is missing runtime resource file(s): ${missing.join(", ")}`);
  }

  const appAsarPath = path.join(root, "app.asar");
  if (!existsSync(appAsarPath)) {
    throw new Error("Packaged build is missing app.asar");
  }

  const packagedFiles = new Set(
    asar.listPackage(appAsarPath).map((entry) => entry.replace(/^[/\\]+/, "").replace(/\\/g, "/")),
  );
  const missingAsarFiles = requiredAsarFiles.filter(
    (relativePath) => !packagedFiles.has(relativePath),
  );

  if (missingAsarFiles.length > 0) {
    throw new Error(`Packaged app.asar is missing runtime file(s): ${missingAsarFiles.join(", ")}`);
  }

  if (review) {
    if (!readFileSync(path.join(root, reviewMarker)).equals(readFileSync(reviewSource))) {
      throw new Error("Packaged review manifest differs from its source");
    }
    if (
      existsSync(path.join(root, "riven-ocr")) ||
      [...packagedFiles].some((file) => file.endsWith(".onnx"))
    ) {
      throw new Error("Desktop review must exclude the Riven model files");
    }
  }
  if (
    !readFileSync(path.join(root, "LICENSE.WFHelper.txt")).equals(
      readFileSync(path.join(sourceRoot, "LICENSE")),
    )
  ) {
    throw new Error("Packaged WFHelper MIT notice differs from LICENSE");
  }
  const onestNotice = "assets/OFL-Onest.txt";
  if (
    !asar
      .extractFile(appAsarPath, onestNotice)
      .equals(readFileSync(path.join(sourceRoot, onestNotice)))
  ) {
    throw new Error("Packaged Onest OFL notice differs from assets/OFL-Onest.txt");
  }
  const unboundedNotice = "assets/OFL-Unbounded.txt";
  if (
    existsSync(path.join(sourceRoot, unboundedNotice)) &&
    !asar
      .extractFile(appAsarPath, unboundedNotice)
      .equals(readFileSync(path.join(sourceRoot, unboundedNotice)))
  ) {
    throw new Error("Packaged Unbounded OFL notice differs from its source");
  }
  verifySharpBinaries(root, context);
};

// A libvips version the sharp binding does not pin dlopens a missing soname at runtime.
function verifySharpBinaries(root, context) {
  const platform = context.electronPlatformName;
  const imgRoot = path.join(root, "app.asar.unpacked", "node_modules", "@img");

  for (const arch of archNames(context.arch)) {
    const bindingRoot = path.join(imgRoot, `sharp-${platform}-${arch}`);
    if (!existsSync(bindingRoot)) {
      throw new Error(
        `Packaged build has no sharp binding for ${platform}-${arch} (@img/sharp-${platform}-${arch})`,
      );
    }
    if (platform === "linux") verifyLibvips(imgRoot, bindingRoot, platform, arch);
  }
}

function verifyLibvips(imgRoot, bindingRoot, platform, arch) {
  const name = `sharp-libvips-${platform}-${arch}`;
  const libvipsRoot = path.join(imgRoot, name);
  const libDir = path.join(libvipsRoot, "lib");
  const shared = existsSync(libDir)
    ? readdirSync(libDir).filter((file) => file.includes(".so"))
    : [];
  if (shared.length === 0) {
    throw new Error(`Packaged build has no libvips shared object for ${platform}-${arch}`);
  }

  const declared = readJson(path.join(bindingRoot, "package.json")) || {};
  // The sharp binding pins libvips under optionalDependencies, not dependencies.
  const wanted =
    (declared.dependencies || {})[`@img/${name}`] ||
    (declared.optionalDependencies || {})[`@img/${name}`];
  if (typeof wanted !== "string") {
    throw new Error(
      `Packaged @img/sharp-${platform}-${arch} declares no @img/${name} version to check against`,
    );
  }
  const shipped = readJson(path.join(libvipsRoot, "package.json"));
  if (!shipped || typeof shipped.version !== "string") {
    throw new Error(`Packaged @img/${name} has no readable version`);
  }
  const pinned = wanted.replace(/^[\^~=v]+/, "");
  if (pinned !== shipped.version) {
    throw new Error(
      `Packaged libvips for ${platform}-${arch} is ${shipped.version}, ` +
        `but @img/sharp-${platform}-${arch} depends on ${pinned}`,
    );
  }
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

// afterPack gets electron-builder's Arch enum by index, not a node arch string.
const ARCH_NAMES = ["ia32", "x64", "armv7l", "arm64"];
const UNIVERSAL_ARCH = 4;

function archNames(arch) {
  if (arch === UNIVERSAL_ARCH) return ["x64", "arm64"];
  return [ARCH_NAMES[arch] || process.arch];
}
