const fs = require("node:fs");
const path = require("node:path");

function preserveNativeDiagnostics(sourceDir, name, files, artifactRoot) {
  const root = path.resolve(artifactRoot || "test-results/native");
  fs.mkdirSync(root, { recursive: true });
  const target = fs.mkdtempSync(path.join(root, `${name}-`));
  for (const relative of files) {
    const source = path.join(sourceDir, relative);
    if (!fs.existsSync(source)) continue;
    // Upload text diagnostics only; profiles, captures and dumps stay private.
    const text = fs
      .readFileSync(source, "utf8")
      .split(/\r?\n/)
      .map((line) =>
        /authorization|bearer|jwt|token|cookie|password/i.test(line)
          ? "[credential-bearing diagnostic line omitted]"
          : line,
      )
      .join("\n");
    const destination = path.join(target, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, text);
  }
  return target;
}

module.exports = { preserveNativeDiagnostics };
