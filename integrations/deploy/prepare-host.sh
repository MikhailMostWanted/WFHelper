#!/usr/bin/env bash
# Fresh isolated install. Does not start a service or edit the HTTPS proxy.
set -euo pipefail
umask 077

if [[ "${1:-}" == "--help" ]]; then
  printf '%s\n' 'sudo bash deploy/prepare-host.sh' \
    'Creates only the WantedFrame system user, directories, venv and systemd unit.' \
    'Refuses an existing installation. Never edits proxy config or starts services.'
  exit 0
fi
[[ $# -eq 0 && $EUID -eq 0 ]] || { printf '%s\n' 'Run as root without arguments; see --help.' >&2; exit 1; }
source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
python_bin="$(command -v python3.12 || command -v python3 || true)"
[[ -n "$python_bin" ]] || { printf '%s\n' 'Python 3.12+ is required.' >&2; exit 1; }
"$python_bin" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 12) else "Python 3.12+ is required")'
for target in /opt/wantedframe-mcp /etc/wantedframe-mcp /var/lib/wantedframe-mcp /etc/systemd/system/wantedframe-mcp.service; do
  [[ ! -e "$target" && ! -L "$target" ]] || { printf 'Existing target; inspect before update: %s\n' "$target" >&2; exit 1; }
done
[[ -f "$source_dir/pyproject.toml" && -f "$source_dir/wantedframe-mcp.service" ]] || { printf '%s\n' 'Run from an extracted integrations package.' >&2; exit 1; }
if [[ -f "$source_dir/MANIFEST.sha256" ]]; then
  (cd -- "$source_dir" && sha256sum --check --quiet MANIFEST.sha256)
fi
if ! getent group wantedframe-mcp >/dev/null; then groupadd --system wantedframe-mcp; fi
if ! id wantedframe-mcp >/dev/null 2>&1; then
  useradd --system --gid wantedframe-mcp --home-dir /var/lib/wantedframe-mcp --shell /usr/sbin/nologin wantedframe-mcp
fi
[[ "$(id -gn wantedframe-mcp)" == wantedframe-mcp ]] || { printf '%s\n' 'Existing user has an unexpected primary group.' >&2; exit 1; }
install -d -m 0755 /opt/wantedframe-mcp
install -d -m 0700 -o wantedframe-mcp -g wantedframe-mcp /etc/wantedframe-mcp /var/lib/wantedframe-mcp
"$python_bin" -m venv /opt/wantedframe-mcp/venv
/opt/wantedframe-mcp/venv/bin/python -m pip install "$source_dir"
/opt/wantedframe-mcp/venv/bin/python -m pip freeze --all > /opt/wantedframe-mcp/requirements.lock.txt
install -m 0644 "$source_dir/wantedframe-mcp.service" /etc/systemd/system/wantedframe-mcp.service
systemctl daemon-reload
printf '%s\n' 'WantedFrame installed; service remains stopped.' \
  'Next: create private OAuth config/pairing, add a separate HTTPS hostname, then start only wantedframe-mcp.'
