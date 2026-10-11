import json
from types import SimpleNamespace
import pytest
pytest.importorskip("fastmcp")
from fastmcp import Client
from starlette.testclient import TestClient
from wantedframe_mcp.server import create_server
from wantedframe_mcp.store import Store

@pytest.fixture
def server(tmp_path, monkeypatch):
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path / "oauth"))
    cfg = {"githubClientId":"test-client", "githubClientSecret":"x"*48,
           "publicUrl":"https://wantedframe.example.com", "githubOwnerId":"159386897",
           "signingKey":"a"*48, "ingestToken":"b"*48,
           "redirectUris":["https://chatgpt.com/test-callback"]}
    return create_server(cfg, Store(tmp_path / "data"))

@pytest.mark.asyncio
async def test_owner_discovery_and_wrong_owner_denial(server, monkeypatch):
    monkeypatch.setattr("wantedframe_mcp.server.get_access_token", lambda: SimpleNamespace(claims={"sub":"159386897"}))
    async with Client(server) as client:
        tools = await client.list_tools()
        assert {t.name for t in tools} == {"get_account_overview","list_data_sections","search_inventory","read_account_section","get_record","lookup_game_item","compare_snapshots","get_world_state","get_profile"}
        assert all(t.annotations.model_dump(by_alias=True)["readOnlyHint"] is True for t in tools)
        result = await client.call_tool("get_account_overview", {})
        assert json.loads(result.content[0].text)["snapshotAvailable"] is False
        monkeypatch.setattr("wantedframe_mcp.server.get_access_token", lambda: SimpleNamespace(claims={"sub":"123"}))
        with pytest.raises(Exception, match="владельцу"):
            await client.call_tool("get_account_overview", {})

def test_http_requires_distinct_auth_and_oauth_discovery(server):
    with TestClient(server.http_app(path="/mcp", stateless_http=True)) as http:
        assert http.get("/healthz").status_code == 200
        assert http.get("/.well-known/oauth-authorization-server").status_code == 200
        assert http.post("/ingest",json={}).status_code == 401
        assert http.post("/ingest",json={},headers={"Authorization":"Bearer "+"b"*48}).status_code == 400
        response = http.post("/mcp",json={"jsonrpc":"2.0","id":1,"method":"tools/list"},headers={"Authorization":"Bearer "+"b"*48})
        assert response.status_code == 401

def test_authorized_upload_is_queryable_not_raw_inventory(server, monkeypatch):
    from pathlib import Path
    data = Path("test-results/bridge/account.json").read_bytes()
    with TestClient(server.http_app(path="/mcp", stateless_http=True)) as http:
        response = http.post("/ingest", content=data, headers={"Authorization":"Bearer "+"b"*48, "Content-Type":"application/json"})
        assert response.status_code == 200
        assert response.json()["accepted"] is True
    monkeypatch.setattr("wantedframe_mcp.server.get_access_token", lambda: SimpleNamespace(claims={"sub":"159386897"}))
    async def check_reads():
        async with Client(server) as client:
            response = await client.call_tool("get_account_overview", {})
            overview = json.loads(response.content[0].text)
            assert overview["snapshotAvailable"] is True
            response = await client.call_tool("read_account_section", {"section":"inventory.MiscItems", "limit":5, "revision":overview["snapshotRevision"]})
            page = json.loads(response.content[0].text)
            assert len(page["items"]) == 5 and page["nextCursor"]
    import asyncio
    asyncio.run(check_reads())
