from __future__ import annotations
import argparse
import getpass
import json
import os
from pathlib import Path
import re
import secrets
from urllib.parse import urlparse
import zipfile
from .store import Store, MAX_BYTES, DataError


def private_write(path: Path, data: dict):
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as out:
        json.dump(data, out, ensure_ascii=False, indent=2)


def https_root(value: str) -> str:
    parsed = urlparse(value)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ("", "/"):
        raise ValueError("A public HTTPS origin is required")
    return value.rstrip("/")


def main():
    parser = argparse.ArgumentParser(description="WantedFrame personal data MCP")
    parser.add_argument("command", choices=("init", "serve", "import", "overview"))
    parser.add_argument("--config", type=Path, default=Path("/etc/wantedframe-mcp/config.json"))
    parser.add_argument("--data", type=Path, default=Path("/var/lib/wantedframe-mcp"))
    parser.add_argument("--pairing", type=Path, default=Path("wantedframe-pairing.json"))
    parser.add_argument("--input", type=Path)
    args = parser.parse_args()
    if args.command == "init":
        public = https_root(input("Public HTTPS origin: ").strip())
        owner = input("GitHub numeric owner ID [159386897]: ").strip() or "159386897"
        if not re.fullmatch(r"[0-9]{1,20}", owner): parser.error("Invalid owner ID")
        redirect = input("Exact ChatGPT OAuth redirect URI from the connection settings: ").strip()
        if not redirect.startswith("https://") or "*" in redirect or not urlparse(redirect).hostname:
            parser.error("An exact HTTPS redirect URI is required")
        client_id = input("Separate GitHub OAuth App client ID: ").strip()
        client_secret = getpass.getpass("Client secret (hidden): ")
        if not client_id or not client_secret: parser.error("OAuth credentials required")
        cfg = {"publicUrl": public, "githubOwnerId": owner, "githubClientId": client_id,
               "githubClientSecret": client_secret, "redirectUris": [redirect],
               "signingKey": secrets.token_urlsafe(48), "ingestToken": secrets.token_urlsafe(48),
               "listenHost": "127.0.0.1", "listenPort": 18767}
        if args.config.exists() or args.pairing.exists(): parser.error("Refusing to overwrite existing configuration or pairing")
        private_write(args.config, cfg)
        private_write(args.pairing, {"format": "wantedframe.pairing.v1", "server": public, "token": cfg["ingestToken"]})
        print("Configuration and PRIVATE pairing file written. Import pairing in WantedFrame, not in ChatGPT or GitHub.")
        return
    store = Store(args.data)
    if args.command == "overview":
        print(json.dumps(store.overview(), ensure_ascii=False, indent=2)); return
    if args.command == "import":
        if args.input is None: parser.error("--input is required")
        if args.input.suffix.lower() == ".zip":
            with zipfile.ZipFile(args.input) as archive:
                info = archive.getinfo("account.json")
                if info.file_size > MAX_BYTES: parser.error("Bundle too large")
                body = archive.read(info)
        else:
            with args.input.open("rb") as stream: body = stream.read(MAX_BYTES + 1)
        print(json.dumps(store.accept(body))); return
    if args.config.is_symlink() or args.config.stat().st_mode & 0o077:
        parser.error("Configuration must be a private regular file (0600)")
    cfg = json.loads(args.config.read_text(encoding="utf-8"))
    https_root(cfg["publicUrl"])
    if cfg.get("listenHost", "127.0.0.1") != "127.0.0.1": parser.error("Only loopback behind the existing HTTPS proxy is supported")
    if not re.fullmatch(r"[A-Za-z0-9_-]{43,128}", cfg.get("ingestToken", "")): parser.error("Strong upload token required")
    if not re.fullmatch(r"[0-9]{1,20}", str(cfg.get("githubOwnerId", ""))): parser.error("Numeric owner ID required")
    if not cfg.get("redirectUris") or any(not u.startswith("https://") or "*" in u for u in cfg["redirectUris"]): parser.error("Exact OAuth redirects required")
    os.umask(0o077)
    os.environ["XDG_DATA_HOME"] = str(args.data / "oauth")
    os.environ["FASTMCP_LOG_LEVEL"] = "CRITICAL"
    os.environ["FASTMCP_ENABLE_RICH_TRACEBACKS"] = "0"
    import logging
    for name in ("fastmcp", "httpx", "httpx2", "httpcore", "authlib", "uvicorn.access"):
        logging.getLogger(name).setLevel(logging.CRITICAL)
    from .server import create_server
    server = create_server(cfg, store)
    import uvicorn
    options = {"uds": cfg["listenUds"]} if cfg.get("listenUds") else {"host": "127.0.0.1", "port": int(cfg.get("listenPort", 18767))}
    if cfg.get("listenUds") and cfg["listenUds"] != "/run/wantedframe-mcp/web.sock": parser.error("Invalid Unix socket path")
    uvicorn.run(server.http_app(path="/mcp", stateless_http=True), **options,
                access_log=False, proxy_headers=False, log_level="warning", limit_concurrency=16, timeout_keep_alive=5)

if __name__ == "__main__":
    try: main()
    except (DataError, ValueError) as exc: raise SystemExit(str(exc)) from None
