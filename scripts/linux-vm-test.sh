#!/bin/bash
# Linux VM test kit for WFHelper (tier-2: overlay + desktop behavior, no game).
#
# Fakes what the app uses to decide "Warframe is running": a process whose
# name contains "warframe" and lines appended to an isolated EE.log.
#
# Usage:
#   ./linux-vm-test.sh setup      create an isolated fixture and app profile
#   ./linux-vm-test.sh launch /path/WFHelper.AppImage  launch with that fixture
#   ./linux-vm-test.sh game-on    start the fake Warframe process
#   ./linux-vm-test.sh game-off   stop it
#   ./linux-vm-test.sh reward     fire a reward-screen trigger (overlay should pop)
#   ./linux-vm-test.sh relic      open the relic-picker (planner overlay, top right)
#   ./linux-vm-test.sh relic-close  close the relic-picker overlay
#   ./linux-vm-test.sh whisper    fake an incoming whisper (desktop notification)
#   ./linux-vm-test.sh status     show fake-game/EE.log state
# With no argument: interactive menu.
#
# Test recipe: setup -> launch the AppImage -> game-on -> play a fullscreen
# video -> reward -> does the overlay appear ABOVE the fullscreen window?
# Repeat in both a Wayland and an "Ubuntu on Xorg" login session.

set -eu
umask 077
TEST_DIR="${WFHELPER_VM_TEST_DIR:-${XDG_RUNTIME_DIR:-/tmp}/wfhelper-vm-$UID}"
EE_LOG="$TEST_DIR/EE.log"
PID_FILE="$TEST_DIR/fake-game.pid"
MARKER="$TEST_DIR/.wfhelper-vm-fixture"

require_fixture() {
  if [ -L "$TEST_DIR" ] || [ ! -d "$TEST_DIR" ] || [ ! -O "$TEST_DIR" ] ||
     [ -L "$MARKER" ] || [ ! -f "$MARKER" ] ||
     [ "$(cat "$MARKER")" != "wfhelper-vm-fixture-v1" ]; then
    echo "Not an owned WFHelper fixture directory: $TEST_DIR (run setup)" >&2; exit 1
  fi
  for file in "$EE_LOG" "$PID_FILE" "$TEST_DIR/user-data"; do
    if [ -L "$file" ]; then
      echo "Refusing a fixture symlink: $file" >&2; exit 1
    fi
  done
}

fixture_game_running() {
  [ -f "$PID_FILE" ] || return 1
  local pid
  pid=$(cat "$PID_FILE")
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  [ -O "/proc/$pid" ] && [ -r "/proc/$pid/cmdline" ] || return 1
  local -a command=()
  mapfile -d '' -t command < "/proc/$pid/cmdline"
  [ "${command[3]:-}" = "wfhelper-vm-fixture" ] && [ "${command[4]:-}" = "$TEST_DIR" ]
}

now_stamp() { date +%s.%3N; }

append_line() {
  require_fixture
  if [ ! -f "$EE_LOG" ]; then
    echo "EE.log missing - run: $0 setup (and restart WFHelper)"; exit 1
  fi
  echo "$(now_stamp) $1" >> "$EE_LOG"
  echo "appended: $1"
}

cmd_setup() {
  if [ ! -e "$TEST_DIR" ] && [ ! -L "$TEST_DIR" ]; then
    mkdir "$TEST_DIR"
    printf '%s\n' 'wfhelper-vm-fixture-v1' > "$MARKER"
  fi
  require_fixture
  if [ ! -e "$EE_LOG" ]; then
    {
      echo "0.000 Sys [Info]: Main Startup."
      echo "0.500 Sys [Info]: Current time: $(date)"
    } > "$EE_LOG"
  fi
  mkdir -p "$TEST_DIR/user-data"
  echo "Fixture ready (existing log preserved): $EE_LOG"
  echo "Launch with: $0 launch /path/to/WFHelper.AppImage"
}

cmd_launch() {
  require_fixture
  if [ "$#" -eq 0 ]; then
    echo "usage: $0 launch /path/to/WFHelper.AppImage [args...]" >&2; exit 1
  fi
  WFHELPER_EE_LOG="$EE_LOG" WFHELPER_USER_DATA="$TEST_DIR/user-data" \
    WF_DISABLE_AUTO_UPDATE=1 "$@"
}

cmd_game_on() {
  require_fixture
  if fixture_game_running; then
    echo "fake game already running (pid $(cat "$PID_FILE"))"; return
  fi
  # comm rename; the loop keeps bash alive (a trailing sleep would get exec'd
  # and overwrite comm with "sleep")
  bash -c 'echo -n Warframe.x64 > /proc/self/comm; while sleep 1; do :; done' wfhelper-vm-fixture "$TEST_DIR" &
  echo $! > "$PID_FILE"
  echo "fake Warframe.x64 process started (pid $!)"
}

cmd_game_off() {
  require_fixture
  if fixture_game_running; then
    kill "$(cat "$PID_FILE")" 2>/dev/null || true
    rm -f "$PID_FILE"
    echo "fake game stopped"
  else
    echo "No matching fixture process; no process was stopped"
  fi
}

cmd_reward() {
  append_line "Sys [Info]: Pause countdown done"
}

cmd_relic() {
  append_line "Script [Info]: activeMissionTag=VoidT3"
  append_line "Script [Info]: ThemedProjectionManager.lua: LoadingCompleteEnd"
}

cmd_relic_close() {
  append_line "Sys [Info]: InitMapping for all devices with bindings"
}

cmd_whisper() {
  append_line "Script [Info]: ChatRedux::AddTab: Adding tab with channel name: FTestTenno to index 4"
}

cmd_status() {
  require_fixture
  if fixture_game_running; then
    echo "fake game: RUNNING (pid $(cat "$PID_FILE"))"
  else
    echo "fake game: stopped"
  fi
  if [ -f "$EE_LOG" ]; then
    echo "EE.log: $EE_LOG ($(wc -l < "$EE_LOG") lines)"
  else
    echo "EE.log: NOT SET UP - run: $0 setup"
  fi
}

menu() {
  echo "WFHelper VM test kit"
  if [ -d "$TEST_DIR" ]; then cmd_status; else echo "Run setup to create the fixture."; fi
  echo ""
  echo "  1) setup EE.log tree      4) reward trigger     7) whisper"
  echo "  2) fake game ON           5) relic picker open  8) status"
  echo "  3) fake game OFF          6) relic picker close q) quit"
  while true; do
    read -r -p "> " choice
    case "$choice" in
      1) cmd_setup ;;
      2) cmd_game_on ;;
      3) cmd_game_off ;;
      4) cmd_reward ;;
      5) cmd_relic ;;
      6) cmd_relic_close ;;
      7) cmd_whisper ;;
      8) cmd_status ;;
      q) exit 0 ;;
      *) echo "?" ;;
    esac
  done
}

case "${1:-}" in
  setup) cmd_setup ;;
  launch) shift; cmd_launch "$@" ;;
  game-on) cmd_game_on ;;
  game-off) cmd_game_off ;;
  reward) cmd_reward ;;
  relic) cmd_relic ;;
  relic-close) cmd_relic_close ;;
  whisper) cmd_whisper ;;
  status) cmd_status ;;
  "") menu ;;
  *) echo "unknown command: $1 (run with no args for menu)"; exit 1 ;;
esac
