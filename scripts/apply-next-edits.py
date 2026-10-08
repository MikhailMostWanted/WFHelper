"""Apply the reviewed, hash-bound source edits once, never to a changed base."""
import hashlib
import json
import os
from pathlib import Path

root = Path.cwd().resolve()
manifest = root / ".github/next-edits.json"
if manifest.exists():
    if os.environ.get("GITHUB_REF") != "refs/heads/feat/wantedframe-next":
        raise SystemExit("Refusing edits outside the preview branch")
    writes = []
    for entry in json.loads(manifest.read_text(encoding="utf-8")):
        rel = Path(entry["path"])
        target = root / rel
        if rel.is_absolute() or ".." in rel.parts or target.is_symlink() or not target.resolve().is_relative_to(root):
            raise SystemExit("Invalid edit target")
        raw = target.read_bytes()
        if hashlib.sha256(raw).hexdigest() != entry["sha256"]:
            raise SystemExit(f"Changed base: {rel}")
        lines = raw.decode("utf-8").splitlines(keepends=True)
        edits = entry["edits"]
        previous_end = 0
        for start, end, replacement in edits:
            if not 0 <= previous_end <= start <= end <= len(lines) or not isinstance(replacement, str):
                raise SystemExit(f"Invalid edit range: {rel}")
            previous_end = end
        for start, end, replacement in reversed(edits):
            lines[start:end] = [replacement]
        writes.append((target, "".join(lines).encode("utf-8")))
    for target, content in writes:
        target.write_bytes(content)
    manifest.unlink()
    print(f"Applied {len(writes)} hash-verified source edits")
