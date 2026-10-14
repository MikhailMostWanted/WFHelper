import copy
import json
from pathlib import Path
import os
import zipfile
import pytest
from wantedframe_mcp.store import Store, DataError, SPEC, canonical, validate, strict_json

FIXTURE = Path(os.environ.get("WANTEDFRAME_TEST_FIXTURE", "test-results/bridge/account.json"))
@pytest.fixture
def doc(): return json.loads(FIXTURE.read_bytes())
@pytest.fixture
def store(tmp_path): return Store(tmp_path)


def test_real_desktop_bundle_matches_receiver_schema_and_zip(doc):
    validate(doc)
    assert len(doc["sections"]) == len(SPEC["sections"])
    with zipfile.ZipFile(FIXTURE.with_name("account.zip")) as z:
        assert set(z.namelist()) == {"account.json", "README_CHATGPT.md"}
        assert z.testzip() is None
        assert json.loads(z.read("account.json")) == doc
        assert "get_account_overview" in z.read("README_CHATGPT.md").decode()


def test_overview_and_section_discovery_preserve_unknown_and_zero(doc, store):
    store.accept(canonical(doc))
    result = store.overview()
    assert result["account"][0]["platinum"] == 0
    assert result["account"][0]["masteryXp"] is None
    assert result["liveGame"] is False
    catalog = store.sections()
    assert any(s["id"] == "inventory.Suits" and "configs" in s["fields"] for s in catalog["sections"])
    assert "FutureGameplayCollection" in catalog["unmappedCollections"]


def test_russian_search_paginated_without_lost_or_duplicate_records(doc, store):
    store.accept(canonical(doc)); rows = []; cursor = None
    while True:
        page = store.read(None, "ресурс", 17, cursor, inventory_only=True)
        rows.extend((r["section"],r["row"]) for r in page["items"])
        cursor = page["nextCursor"]
        if cursor is None: break
    assert len(rows) == len(set(rows)) == 70


def test_historical_mastery_is_not_current_inventory(doc, store):
    store.accept(canonical(doc))
    assert store.read(None, "SoldWeapon", inventory_only=True)["totalMatches"] == 0
    assert store.read(None, "SoldWeapon", inventory_only=True, include_history=True)["totalMatches"] == 1


def test_build_mod_slots_and_nested_recipe_are_readable(doc, store):
    store.accept(canonical(doc))
    result = store.record("inventory.Suits", 0, doc["revision"], "/configs/0/mods")
    assert result["data"][0]["rank"] == 8
    result = store.record("game.items", 0, doc["revision"], "/recipe/ingredients")
    assert result["data"][0]["count"] == 4


def test_cursor_remains_on_old_revision_and_expires_explicitly(doc, store):
    store.accept(canonical(doc)); page = store.read("inventory.MiscItems", limit=2)
    newer = copy.deepcopy(doc); newer["revision"] = "2"*64; newer["createdAt"] += 100
    store.accept(canonical(newer))
    second = store.read("inventory.MiscItems", limit=2, cursor=page["nextCursor"])
    assert second["snapshotRevision"] == doc["revision"]
    assert second["items"][0]["row"] == 2
    newest = copy.deepcopy(newer); newest["revision"] = "3"*64; newest["createdAt"] += 100
    store.accept(canonical(newest))
    with pytest.raises(DataError, match="expired"): store.read("inventory.MiscItems", cursor=page["nextCursor"])


def test_changed_filters_and_invalid_cursor_fail(doc, store):
    store.accept(canonical(doc)); cursor = store.read("inventory.MiscItems",limit=2)["nextCursor"]
    with pytest.raises(DataError): store.read("inventory.Suits", cursor=cursor)
    with pytest.raises(DataError): store.read("inventory.MiscItems", cursor="invalid!")


def test_bad_or_older_data_never_replaces_working_snapshot(doc, store):
    store.accept(canonical(doc)); original = store.file.read_bytes()
    bad = copy.deepcopy(doc); bad["sections"][0]["rows"][0]["sessionToken"] = "secret"
    with pytest.raises(DataError): store.accept(canonical(bad))
    bad = copy.deepcopy(doc); bad["revision"] = "4"*64; bad["inventoryUpdatedAt"] -= 100
    with pytest.raises(DataError, match="older inventory"): store.accept(canonical(bad))
    assert store.file.read_bytes() == original


def test_cross_account_and_same_revision_mutation_denied(doc, store):
    store.accept(canonical(doc)); assert store.accept(canonical(doc))["duplicate"]
    bad = copy.deepcopy(doc); bad["bindingId"] = "f"*64
    with pytest.raises(DataError, match="another account"): store.accept(canonical(bad))
    bad = copy.deepcopy(doc); bad["createdAt"] += 1
    with pytest.raises(DataError, match="different data"): store.accept(canonical(bad))


def test_duplicate_json_keys_and_false_complete_metadata_denied(doc):
    with pytest.raises(DataError): strict_json(b'{"x":1,"x":2}')
    bad=copy.deepcopy(doc); bad["sections"][0]["originalRows"] += 1
    with pytest.raises(DataError): validate(bad)
    with pytest.raises(DataError): strict_json(b'{"x":NaN}')


def test_store_survives_restart(doc, store):
    store.accept(canonical(doc))
    restarted = Store(store.directory)
    assert restarted.overview()["snapshotRevision"] == doc["revision"]


def test_legacy_manifest_preserves_revision_and_marks_extension_unknown(doc, store):
    legacy = copy.deepcopy(doc)
    legacy["sections"] = [s for s in legacy["sections"] if s["id"] != "extra.Consumables"]
    original = canonical(legacy)
    assert len(legacy["sections"]) == 51
    assert validate(legacy) is legacy
    store.accept(original)
    restarted = Store(store.directory)
    extension = next(s for s in restarted.sections()["sections"] if s["id"] == "extra.Consumables")
    assert (extension["status"], extension["capturedAt"], extension["source"], extension["rows"]) == ("missing", None, "legacy-exporter", 0)
    assert "неизвестно" in extension["note"]
    assert canonical(restarted.snapshot()) == original
    assert restarted.accept(original)["duplicate"] is True
    page = restarted.read("extra.Consumables")
    assert page["snapshotRevision"] == legacy["revision"]
    assert page["coverage"][0]["status"] == "missing"
    cursor = restarted.read("inventory.MiscItems", limit=2)["nextCursor"]
    newer = copy.deepcopy(doc); newer["revision"] = "2" * 64; newer["createdAt"] += 100
    restarted.accept(canonical(newer))
    assert restarted.read("inventory.MiscItems", cursor=cursor)["snapshotRevision"] == legacy["revision"]
    with pytest.raises(DataError, match="not exported"):
        restarted.compare("extra.Consumables")
    broken = copy.deepcopy(doc)
    broken["sections"] = [s for s in broken["sections"] if s["id"] != "inventory.MiscItems"]
    with pytest.raises(DataError, match="Incomplete section manifest"):
        validate(broken)


def test_world_unavailable_is_not_no_events(monkeypatch):
    import asyncio
    from wantedframe_mcp.world import World
    w = World(); w.attempt_at = 10**15
    with pytest.raises(DataError, match="unavailable"): asyncio.run(w.read("",0,10))
