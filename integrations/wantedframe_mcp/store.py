"""Bounded, atomic snapshots and selective reads. No game credentials or arbitrary files."""
from __future__ import annotations

import base64
import fcntl
from contextlib import contextmanager
from collections import Counter
import hashlib
import json
import math
import os
import re
import threading
import time
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator

SPEC = json.loads(Path(__file__).with_name("schema.json").read_text(encoding="utf-8"))
MAX_BYTES = SPEC["maxBytes"]
MAX_OUTPUT = 48 * 1024
HEX = re.compile(r"^[a-f0-9]{64}$")
VALIDATORS = {key: Draft202012Validator({"$defs": SPEC["$defs"], **value["schema"]}) for key, value in SPEC["sections"].items()}
LEGACY_EXTENSION = "extra.Consumables"
LEGACY_NOTE = "Этот снимок старой версии не экспортирует Consumables; количество неизвестно. Обнови WantedFrame и отправь новый снимок."

class DataError(ValueError):
    """Safe to show to the user; never include private input values."""


def canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True, allow_nan=False).encode()


def strict_json(body: bytes) -> Any:
    if len(body) > MAX_BYTES:
        raise DataError("Bundle exceeds 24 MiB; nothing was stored")
    def pairs(values):
        out = {}
        for key, value in values:
            if key in out:
                raise DataError("Duplicate JSON key")
            out[key] = value
        return out
    try:
        return json.loads(body, object_pairs_hook=pairs, parse_constant=lambda _: (_ for _ in ()).throw(DataError("Non-finite number")))
    except (ValueError, UnicodeError, RecursionError) as exc:
        raise DataError("Invalid JSON bundle") from exc


def stamp(value: Any, *, nullable: bool = True) -> bool:
    return (nullable and value is None) or (type(value) in (int, float) and math.isfinite(value) and 0 <= value <= time.time() * 1000 + 300_000)


def validate(doc: Any) -> dict:
    keys = {"format", "revision", "createdAt", "bindingId", "appVersion", "source", "inventoryUpdatedAt", "sections", "unmappedCollections"}
    if not isinstance(doc, dict) or set(doc) != keys or doc["format"] != "wantedframe.account.v1":
        raise DataError("Not a supported WantedFrame account bundle; raw inventory is not accepted")
    if not isinstance(doc["revision"], str) or not HEX.fullmatch(doc["revision"]):
        raise DataError("Invalid snapshot revision")
    if not isinstance(doc["bindingId"], str) or not (HEX.fullmatch(doc["bindingId"]) or doc["bindingId"] == "manual"):
        raise DataError("Invalid account binding")
    if not stamp(doc["createdAt"], nullable=False) or not stamp(doc["inventoryUpdatedAt"]):
        raise DataError("Invalid snapshot time")
    if not all(isinstance(doc[k], str) and len(doc[k]) <= 100 for k in ("source", "appVersion")):
        raise DataError("Invalid source metadata")
    unknown = doc["unmappedCollections"]
    if not isinstance(unknown, list) or len(unknown) > 100 or any(not isinstance(k, str) or not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,79}", k) for k in unknown):
        raise DataError("Invalid collection inventory")
    sections = doc["sections"]
    if not isinstance(sections, list) or len(sections) > len(SPEC["sections"]):
        raise DataError("Invalid section inventory")
    seen = set()
    required = {"id", "title", "source", "capturedAt", "status", "originalRows", "omittedRows", "omittedFields", "note", "rows"}
    for section in sections:
        if not isinstance(section, dict) or set(section) != required:
            raise DataError("Invalid section metadata")
        key = section["id"]
        if not isinstance(key, str) or key not in VALIDATORS or key in seen:
            raise DataError("Unknown or duplicate section")
        seen.add(key)
        if not all(isinstance(section[k], str) and len(section[k]) <= 2000 for k in ("title", "source", "note")) or not stamp(section["capturedAt"]):
            raise DataError("Invalid section source or time")
        if section["status"] not in ("available", "partial", "missing") or not all(type(section[k]) is int and 0 <= section[k] <= 10_000_000 for k in ("originalRows", "omittedRows", "omittedFields")):
            raise DataError("Invalid coverage")
        rows = section["rows"]
        if not isinstance(rows, list) or len(rows) > 50_000 or section["originalRows"] != len(rows) + section["omittedRows"]:
            raise DataError("Inconsistent row counts")
        if (section["status"] == "missing" and rows) or (section["status"] == "available" and (section["omittedRows"] or section["omittedFields"])):
            raise DataError("Inconsistent completeness")
        for row in rows:
            if row is None or not VALIDATORS[key].is_valid(row):
                raise DataError("Unexpected or invalid fields in section " + key)
    current_sections = set(SPEC["sections"])
    legacy_manifest = len(seen) == 51 and seen == current_sections - {LEGACY_EXTENSION}
    if seen != current_sections and not legacy_manifest:
        raise DataError("Incomplete section manifest; missing sections must be explicitly marked missing")
    return doc


def readable_sections(doc: dict) -> list[dict]:
    # Virtual catalog coverage only. Never amend the persisted legacy bundle or its revision.
    sections = doc["sections"]
    if any(section["id"] == LEGACY_EXTENSION for section in sections):
        return sections
    return [*sections, {"id": LEGACY_EXTENSION, "source": "legacy-exporter", "capturedAt": None,
                        "status": "missing", "originalRows": 0, "omittedRows": 0,
                        "omittedFields": 0, "note": LEGACY_NOTE, "rows": []}]


def normalize(query: str) -> list[str]:
    if not isinstance(query, str) or len(query) > 240:
        raise DataError("Query must be at most 240 characters")
    return query.casefold().replace("ё", "е").split()


def bounded_page(rows: list[dict], start: int, limit: int) -> tuple[list[dict], int]:
    out = []; used = 0; end = start
    for row in rows[start:start + limit]:
        size = len(canonical(row))
        if used + size > MAX_OUTPUT and out:
            break
        if size > MAX_OUTPUT:
            row = {"row": row["row"], "section": row["section"], "oversized": True,
                   "availableFields": list(row["data"]) if isinstance(row["data"], dict) else [],
                   "nextAction": "get_record with path/fields; this row was NOT fully returned"}
            size = len(canonical(row))
        out.append(row); used += size; end += 1
    return out, end


@contextmanager
def write_lock(directory: Path):
    fd = os.open(directory / "snapshots.lock", os.O_WRONLY | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
    with os.fdopen(fd, "w") as stream:
        fcntl.flock(stream.fileno(), fcntl.LOCK_EX)
        try: yield
        finally: fcntl.flock(stream.fileno(), fcntl.LOCK_UN)


class Store:
    def __init__(self, directory: Path):
        self.directory = directory
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        if directory.is_symlink(): raise DataError("State directory must not be a symbolic link")
        directory.chmod(0o700)
        self.file = directory / "snapshots.json"
        self.lock = threading.RLock()
        self.cache = None
        self.mtime = None

    def _load(self) -> dict:
        if not self.file.exists():
            return {"current": None, "previous": None, "receivedAt": None}
        if self.file.is_symlink() or self.file.stat().st_size > 2 * MAX_BYTES + 4096:
            raise DataError("Snapshot storage invalid")
        stat = self.file.stat().st_mtime_ns
        if self.cache is None or self.mtime != stat:
            try:
                state = json.loads(self.file.read_bytes())
                validate(state["current"])
                if state.get("previous") is not None:
                    validate(state["previous"])
            except (ValueError, KeyError, TypeError, RecursionError) as exc:
                raise DataError("Snapshot storage cannot be read; restore the last good copy") from exc
            self.cache = state; self.mtime = stat
        return self.cache

    def accept(self, body: bytes) -> dict:
        doc = validate(strict_json(body))
        if len(canonical(doc)) > MAX_BYTES:
            raise DataError("Bundle too large")
        with self.lock, write_lock(self.directory):
            state = self._load(); old = state["current"]
            if old:
                if old["bindingId"] != doc["bindingId"]:
                    raise DataError("conflict: another account; reset pairing explicitly")
                if old["revision"] == doc["revision"]:
                    if canonical(old) != canonical(doc):
                        raise DataError("conflict: revision already contains different data")
                    return {"accepted": True, "revision": doc["revision"], "duplicate": True}
                if doc["createdAt"] < old["createdAt"]:
                    raise DataError("conflict: older export cannot replace the newest export")
                if old["inventoryUpdatedAt"] is not None and (doc["inventoryUpdatedAt"] is None or doc["inventoryUpdatedAt"] < old["inventoryUpdatedAt"]):
                    raise DataError("conflict: older inventory cannot replace the newest inventory")
            replacement = {"current": doc, "previous": old, "receivedAt": int(time.time() * 1000)}
            temp = self.directory / "snapshots.tmp"
            try:
                fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | getattr(os, "O_NOFOLLOW", 0), 0o600)
                with os.fdopen(fd, "wb") as stream:
                    stream.write(canonical(replacement)); stream.flush(); os.fsync(stream.fileno())
                os.replace(temp, self.file)
            finally:
                temp.unlink(missing_ok=True)
            self.cache = replacement; self.mtime = self.file.stat().st_mtime_ns
            return {"accepted": True, "revision": doc["revision"], "duplicate": False}

    def snapshot(self, revision: str | None = None) -> dict:
        with self.lock:
            state = self._load()
            for value in [state["current"], state["previous"]]:
                if value and (revision is None or value["revision"] == revision):
                    return value
        raise DataError("No snapshot, or that revision has expired. Ask WantedFrame to send data / restart from get_account_overview.")

    @staticmethod
    def provenance(doc: dict) -> dict:
        stamp = doc["inventoryUpdatedAt"]
        return {"snapshotRevision": doc["revision"], "source": doc["source"], "inventoryUpdatedAt": stamp,
                "ageSeconds": None if stamp is None else max(0, int(time.time() - stamp / 1000)),
                "liveGame": False, "identityVerified": doc["bindingId"] != "manual", "sourceIsUntrusted": True}

    def sections(self, revision: str | None = None) -> dict:
        doc = self.snapshot(revision)
        result = []
        legacy_extension_missing = not any(s["id"] == LEGACY_EXTENSION for s in doc["sections"])
        for section in readable_sections(doc):
            key = section["id"]; definition = SPEC["sections"][key]
            schema = definition["schema"]
            if "$ref" in schema: schema = SPEC["$defs"][schema["$ref"].split("/")[-1]]
            result.append({**{k: section[k] for k in ("id", "capturedAt", "source", "status", "originalRows", "omittedRows", "omittedFields")},
                           "title": definition["title"], "note": LEGACY_NOTE if legacy_extension_missing and key == LEGACY_EXTENSION else definition["note"], "rows": len(section["rows"]),
                           "fields": list(schema.get("properties", {})), "readWith": "read_account_section"})
        return {**self.provenance(doc), "sections": result, "unmappedCollections": doc["unmappedCollections"]}

    def overview(self) -> dict:
        try: doc = self.snapshot()
        except DataError:
            if not self.file.exists():
                return {"connected": True, "snapshotAvailable": False, "nextAction": "In WantedFrame: Передать данные / подключить ChatGPT → Подключить MCP → Отправить на MCP сейчас"}
            raise
        catalog = self.sections(doc["revision"])
        by_id = {s["id"]: s for s in doc["sections"]}
        return {**self.provenance(doc), "snapshotAvailable": True, "receivedAt": self._load()["receivedAt"],
                "account": by_id["account"]["rows"], "masteryEstimate": by_id["mastery.summary"]["rows"],
                "sections": [{k: row[k] for k in ("id", "title", "status", "rows")} for row in catalog["sections"]],
                "nextActions": ["list_data_sections for fields, gaps and dates", "search_inventory for names/counts", "read_account_section for whole categories", "get_record for exact builds and nested configurations"],
                "rules": ["null/missing is not zero", "XPInfo/mastery history is not current ownership", "game.items reference age is unknown", "rawValue in Riven fingerprints is NOT a percentage", "Presets are not proof of the live equipped loadout"]}

    def read(self, section: str | None, query: str = "", limit: int = 30, cursor: str | None = None,
             revision: str | None = None, inventory_only: bool = False, include_history: bool = False) -> dict:
        if type(limit) is not int or not 1 <= limit <= 100:
            raise DataError("Limit must be 1..100")
        if section is not None and section not in SPEC["sections"]:
            raise DataError("Unknown section; call list_data_sections")
        words = normalize(query)
        fingerprint = hashlib.sha256(canonical([section, words, inventory_only, include_history])).hexdigest()[:24]
        start = 0
        if cursor:
            try:
                if len(cursor) > 512: raise ValueError()
                rev, fingerprint_before, start = json.loads(base64.urlsafe_b64decode(cursor))
                if not isinstance(rev, str) or not HEX.fullmatch(rev) or fingerprint_before != fingerprint or type(start) is not int or not 0 <= start <= 2_500_000 or (revision and revision != rev): raise ValueError()
                revision = rev
            except (ValueError, TypeError) as exc:
                raise DataError("Invalid cursor or changed filters") from exc
        doc = self.snapshot(revision); matches = []; coverage = []
        for source in readable_sections(doc):
            key = source["id"]
            if section and key != section: continue
            if inventory_only and not key.startswith(("inventory.", "extra.")): continue
            if inventory_only and not include_history and key in ("inventory.XPInfo", "inventory.PendingRecipes"): continue
            coverage.append({k: source[k] for k in ("id", "status", "capturedAt", "omittedRows", "omittedFields")})
            for index, row in enumerate(source["rows"]):
                haystack = json.dumps(row, ensure_ascii=False).casefold().replace("ё", "е")
                if all(word in haystack for word in words):
                    matches.append({"section": key, "row": index, "data": row})
        if start > len(matches): raise DataError("Cursor is outside this result set")
        page, end = bounded_page(matches, start, limit)
        next_cursor = base64.urlsafe_b64encode(canonical([doc["revision"], fingerprint, end])).decode() if end < len(matches) else None
        return {**self.provenance(doc), "totalMatches": len(matches), "coverage": coverage, "items": page,
                "nextCursor": next_cursor, "completePage": next_cursor is None,
                "note": "Search is text matching, not semantic search. No match does not prove absence when coverage is missing/partial."}

    def record(self, section: str, row: int, revision: str, path: str = "", offset: int = 0, limit: int = 30) -> dict:
        if type(row) is not int or row < 0 or type(offset) is not int or offset < 0 or type(limit) is not int or not 1 <= limit <= 100 or len(path) > 512:
            raise DataError("Invalid record selection")
        doc = self.snapshot(revision)
        source = next((s for s in doc["sections"] if s["id"] == section), None)
        if source is None or row >= len(source["rows"]): raise DataError("Record not found in this revision")
        value = source["rows"][row]
        if path and not path.startswith("/"): raise DataError("Path is a JSON pointer, e.g. /configs/0/mods")
        for component in path.split("/")[1:] if path else []:
            component = component.replace("~1", "/").replace("~0", "~")
            if isinstance(value, dict) and component in value: value = value[component]
            elif isinstance(value, list) and component.isdecimal() and int(component) < len(value): value = value[int(component)]
            else: raise DataError("Field is not available; do not substitute zero")
        next_offset = None
        if isinstance(value, list):
            total = len(value); value = value[offset:offset + limit]
            next_offset = offset + len(value) if offset + len(value) < total else None
        if len(canonical(value)) > MAX_OUTPUT:
            return {**self.provenance(doc), "section": section, "row": row, "oversized": True,
                    "availableFields": list(value) if isinstance(value, dict) else None,
                    "nextAction": "Select a deeper path or a smaller list limit; no data silently cut"}
        return {**self.provenance(doc), "section": section, "row": row, "path": path, "capturedAt": source["capturedAt"], "coverage": source["status"], "data": value, "nextOffset": next_offset}

    def compare(self, section: str) -> dict:
        with self.lock:
            state = self._load(); current = state["current"]; previous = state["previous"]
            if not current or not previous: raise DataError("Two snapshots are needed")
            if current["bindingId"] == "manual": raise DataError("Account identity is not verified; comparisons could mix accounts")
            a = next((s for s in previous["sections"] if s["id"] == section), None)
            b = next((s for s in current["sections"] if s["id"] == section), None)
            if section not in SPEC["sections"]: raise DataError("Unknown section")
            if not a or not b:
                raise DataError("Section was not exported by one snapshot; send two snapshots that support this section before comparing")
            ah = Counter(hashlib.sha256(canonical(r)).hexdigest() for r in a["rows"])
            bh = Counter(hashlib.sha256(canonical(r)).hexdigest() for r in b["rows"])
            return {"previousRevision": previous["revision"], "currentRevision": current["revision"], "previousCapturedAt": a["capturedAt"], "currentCapturedAt": b["capturedAt"],
                    "section": section, "beforeCoverage": a["status"], "afterCoverage": b["status"], "changed": ah != bh,
                    "newOrChangedRows": sum((bh-ah).values()), "removedOrChangedRows": sum((ah-bh).values()),
                    "note": "Row changes, not purchases/sales. Use read_account_section with each revision for exact values."}
