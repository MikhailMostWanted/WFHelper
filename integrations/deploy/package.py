"""Build an allowlisted server-only archive; never include local config or snapshots."""
from __future__ import annotations

import argparse
import gzip
import hashlib
import io
from pathlib import Path
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[1]
FILES = (
    "README.md",
    "pyproject.toml",
    "wantedframe-mcp.service",
    "wantedframe_mcp/__init__.py",
    "wantedframe_mcp/cli.py",
    "wantedframe_mcp/schema.json",
    "wantedframe_mcp/server.py",
    "wantedframe_mcp/store.py",
    "wantedframe_mcp/world.py",
    "deploy/README.md",
    "deploy/package.py",
    "deploy/prepare-host.sh",
    "deploy/nginx.conf.example",
    "deploy/Caddyfile.example",
)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    payload: dict[str, bytes] = {}
    for relative in FILES:
        path = ROOT / relative
        if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(ROOT):
            parser.error("Missing or unsafe allowlisted source: " + relative)
        payload[relative] = path.read_bytes()
    revision = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True,
        encoding="utf-8", capture_output=True, check=True,
    ).stdout.strip()
    payload["SOURCE_REVISION.txt"] = (revision + "\n").encode("utf-8")
    changed = subprocess.run(
        ["git", "status", "--porcelain", "--", "integrations"], cwd=ROOT.parent,
        text=True, encoding="utf-8", capture_output=True, check=True,
    ).stdout.strip()
    payload["SOURCE_STATE.txt"] = (
        "integrationsWorkingTree=" + ("modified" if changed else "clean") + "\n"
    ).encode("utf-8")
    manifest = "".join(
        hashlib.sha256(body).hexdigest() + "  " + name + "\n"
        for name, body in sorted(payload.items())
    )
    payload["MANIFEST.sha256"] = manifest.encode("utf-8")
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("xb") as raw, gzip.GzipFile(fileobj=raw, mode="wb", filename="", mtime=0) as zipped:
        with tarfile.open(fileobj=zipped, mode="w") as archive:
            for name, body in sorted(payload.items()):
                info = tarfile.TarInfo("wantedframe-integrations/" + name)
                info.size = len(body)
                info.mode = 0o755 if name.endswith(".sh") else 0o644
                archive.addfile(info, io.BytesIO(body))
    print("Server-only archive:", output)
    print("Source revision:", revision)
    print("Files:", len(payload), "(includes per-file SHA-256 manifest)")
    print("SHA-256:", hashlib.sha256(output.read_bytes()).hexdigest())


if __name__ == "__main__":
    main()
