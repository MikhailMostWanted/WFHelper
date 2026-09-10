import { withScope } from "./logger";

const log = withScope("rivenStateMachine");

export const RIVEN_PATTERNS = {
  sessionOpen: /Sys \[Info\]: Created \/Lotus\/Interface\/OmegaRerollSelection\.swf/,
  sessionClose: /NpcManager::ClearAgents\(\) ReadyToCreateAgents = false/,
  /** Matches any HudVis line - we extract the number to track increments/decrements. */
  hudVis: /ThemedDetailedPurchaseDialog\.lua: DBG: HudVis (\d+)/,
  /** Two-step riven detection: PopulateInfo with a Randomized mod path confirms it's a riven. */
  populateRiven:
    /ThemedDetailedPurchaseDialog\.lua: PopulateInfo->\/Lotus\/StoreItems\/Upgrades\/Mods\/Randomized\//,
  cycleConfirmEn:
    /Dialog::CreateOkCancel\(description=Are you sure you want to cycle (.+?) for ([\d,. ]+)\?/,
  choiceConfirmEn: /Dialog::CreateOkCancel\(description=Cycle Riven into current selection\?/,
  genericDialog: /Dialog::CreateOkCancel\(/,
  genericDialogNonInteractive: /leftItem=nil/,
  sendResult: /Dialog\.lua:\s*Dialog::SendResult\((\d+)\)/,
  dioramaSetup: /OmegaRerollSelection\.lua.*Diorama setup/i,
  /** The roll-screen diorama loads the riven's weapon model right after the
   *  screen opens - the resource path names the exact weapon variant. */
  dioramaWeaponLoad:
    /(?:ResourceLoader|Resloader|Resource load completed) 0x[0-9A-Fa-f]+ \((\/Lotus\/Weapons\/[^)]+)\)/,
  /** Extra close signal emitted by the recycled effects line. */
  recycledEffects: /ytes of recycled effects/,
} as const;

interface RivenCallbacks {
  onRivenSessionOpen: (() => void) | null;
  onRivenSessionClose: (() => void) | null;
  onRivenChatView: (() => void) | null;
  onRivenRollPending: ((weapon: string, kuvaPerRoll: number) => void) | null;
  onRivenRollConfirmed: (() => void) | null;
  onRivenDioramaSetup: (() => void) | null;
  onRivenChoiceConfirmed: (() => void) | null;
  onRivenWeaponPath: ((weaponPath: string) => void) | null;
}

let _callbacks: RivenCallbacks = {
  onRivenSessionOpen: null,
  onRivenSessionClose: null,
  onRivenChatView: null,
  onRivenRollPending: null,
  onRivenRollConfirmed: null,
  onRivenDioramaSetup: null,
  onRivenChoiceConfirmed: null,
  onRivenWeaponPath: null,
};

export function setRivenCallbacks(cbs: Partial<RivenCallbacks>): void {
  _callbacks = { ..._callbacks, ...cbs };
}

let _rivenPendingDialog: "roll_confirm" | "choice" | null = null;
let _rivenSessionActive = false;
let _rivenSessionStartedAt = 0;
let _rivenSessionIdleTimer: ReturnType<typeof setTimeout> | null = null;
// Backstop for a missed close marker, not a screen-idle detector: only riven events reset it.
const RIVEN_SESSION_IDLE_TIMEOUT_MS = 600_000;
// The idle timeout cannot cap active rolling because every match resets it.
// Force-close sessions at 30 minutes even while matches continue.
const RIVEN_SESSION_MAX_MS = 30 * 60_000;

let _rivenNextDialog: "cycle" | "choice" = "cycle";
let _rivenChatViewActive = false;
let _rivenChatHudVisLevel = 0;
let _rivenChatWeaponPath: string | null = null;

let _lastRivenSendResultAt = 0;
const RIVEN_SEND_RESULT_COOLDOWN_MS = 400;

let _lastRivenGenericDialogAt = 0;
const RIVEN_GENERIC_DIALOG_COOLDOWN_MS = 600;

let _lastRivenChoiceDialogAt = 0;
const RIVEN_CHOICE_DIALOG_COOLDOWN_MS = 2000;

let _lastRivenSessionOpenAt = 0;
// The game writes the rolling-screen marker dozens of times in one burst;
// log the suppression once per window instead of once per line.
let _lastSuppressedOpenLogAt = 0;
// An active session absorbs the burst, so this only guards a close racing it.
const RIVEN_SESSION_OPEN_COOLDOWN_MS = 2_000;
// Teardown markers trail up to ~2s behind the close they belong to, and a fast
// reopen puts that tail inside the next session.
const RIVEN_CLOSE_MARKER_SPACING_MS = 2_000;
let _lastRivenCloseMarkerAt = 0;
let _lastRivenCloseDispatchAt = 0;

let _lastRivenDioramaAt = 0;
const RIVEN_DIORAMA_DEDUP_MS = 2_000;

/** True once this session's diorama weapon load was reported (once per session). */
let _rivenWeaponPathSent = false;
/** Accept the diorama weapon-load line this long after session open. */
const RIVEN_WEAPON_PATH_WINDOW_MS = 15_000;

// Gate close patterns on diorama setup so loading-transition lines cannot close the screen.
let _rivenDioramaReady = false;

let _rivenForceEndedAt = 0;
const RIVEN_FORCE_END_COOLDOWN_MS = 5_000;

/** Track HudVis for two-step chat riven detection. */
let _lastHudVis = 0;
let _lastHudVisIncreaseAt = 0;
const CHAT_RIVEN_POPULATE_WINDOW_MS = 2_000;

function endRivenSessionState(): void {
  _rivenSessionActive = false;
  _rivenSessionStartedAt = 0;
  _rivenDioramaReady = false;
  _rivenPendingDialog = null;
  _rivenNextDialog = "cycle";
  _rivenWeaponPathSent = false;
  // A closed session must not leak its cooldowns into the next open.
  _lastRivenSessionOpenAt = 0;
  _lastRivenDioramaAt = 0;
  if (_rivenSessionIdleTimer) {
    clearTimeout(_rivenSessionIdleTimer);
    _rivenSessionIdleTimer = null;
  }
}

function resetRivenIdleTimer(): void {
  if (_rivenSessionIdleTimer) clearTimeout(_rivenSessionIdleTimer);
  _rivenSessionIdleTimer = setTimeout(() => {
    _rivenSessionIdleTimer = null;
    endRivenSessionState();
    // Backstop for a missed close marker - close the overlay too, not just state.
    log.info("[EELog] Riven session idle timeout -> dispatching overlay close");
    _callbacks.onRivenSessionClose?.();
  }, RIVEN_SESSION_IDLE_TIMEOUT_MS);
}

/** Force-closes an overlong session and returns whether this call closed it. */
function forceEndRivenSessionIfExpired(): boolean {
  if (!_rivenSessionActive || _rivenSessionStartedAt === 0) return false;
  if (Date.now() - _rivenSessionStartedAt < RIVEN_SESSION_MAX_MS) return false;

  log.info(
    `[EELog] Riven session exceeded ${RIVEN_SESSION_MAX_MS / 60_000}min cap - force closing`,
  );
  endRivenSessionState();
  _rivenForceEndedAt = Date.now();
  _callbacks.onRivenSessionClose?.();
  return true;
}

/** Returns whether the riven flow consumed a SendResult from this EE.log line. */
export function processRivenPatterns(
  line: string,
  source: "dbwin" | "file",
  dbwinActive: boolean,
): boolean {
  const skipRivenFromFilePoll = dbwinActive && source === "file";

  // Check before extending the session so continuous matches cannot bypass the cap.
  forceEndRivenSessionIfExpired();

  if (!skipRivenFromFilePoll && RIVEN_PATTERNS.sessionOpen.test(line)) {
    const now = Date.now();
    if (!_rivenSessionActive && now - _lastRivenSessionOpenAt >= RIVEN_SESSION_OPEN_COOLDOWN_MS) {
      _lastRivenSessionOpenAt = now;
      _rivenSessionActive = true;
      _rivenSessionStartedAt = now;
      _rivenChatViewActive = false;
      _rivenChatHudVisLevel = 0;
      _rivenChatWeaponPath = null;
      _rivenNextDialog = "cycle";
      _rivenPendingDialog = null;
      _rivenWeaponPathSent = false;
      resetRivenIdleTimer();
      log.info("[EELog] Riven rolling screen opened -> dispatching session open");
      _callbacks.onRivenSessionOpen?.();
    } else if (now - _lastSuppressedOpenLogAt >= RIVEN_SESSION_OPEN_COOLDOWN_MS) {
      _lastSuppressedOpenLogAt = now;
      log.info("[EELog] Riven session open suppressed (cooldown)");
    }
  }

  // The short open window excludes relay bystanders while allowing the file poll's delayed
  // exact-variant path after DBWIN has already marked the diorama ready.
  const weaponMatch = line.match(RIVEN_PATTERNS.dioramaWeaponLoad);
  if (
    _rivenSessionActive &&
    !_rivenWeaponPathSent &&
    _rivenSessionStartedAt > 0 &&
    Date.now() - _rivenSessionStartedAt < RIVEN_WEAPON_PATH_WINDOW_MS &&
    weaponMatch
  ) {
    _rivenWeaponPathSent = true;
    log.info(`[EELog] Riven diorama weapon load: ${weaponMatch[1]}`);
    _callbacks.onRivenWeaponPath?.(weaponMatch[1]);
  }

  // Accept readiness from either source so DBWIN/file ordering cannot block roll OCR.
  if (_rivenSessionActive && RIVEN_PATTERNS.dioramaSetup.test(line)) {
    const now = Date.now();
    if (now - _lastRivenDioramaAt >= RIVEN_DIORAMA_DEDUP_MS) {
      _lastRivenDioramaAt = now;
      _rivenDioramaReady = true;
      resetRivenIdleTimer();
      log.info("[EELog] Riven diorama ready -> dispatching diorama OCR trigger");
      _callbacks.onRivenDioramaSetup?.();
    }
  }

  // Require diorama readiness because these close lines also fire during screen loading.
  if (
    !skipRivenFromFilePoll &&
    _rivenSessionActive &&
    _rivenDioramaReady &&
    (RIVEN_PATTERNS.sessionClose.test(line) || RIVEN_PATTERNS.recycledEffects.test(line))
  ) {
    // Spacing gate is real-time only - file polls deliver batched, stale timestamps.
    // The chain cap stops sub-2s marker streams from starving the close forever.
    const now = Date.now();
    const trailing =
      dbwinActive &&
      now - _lastRivenCloseMarkerAt < RIVEN_CLOSE_MARKER_SPACING_MS &&
      now - _lastRivenCloseDispatchAt < 2 * RIVEN_CLOSE_MARKER_SPACING_MS;
    _lastRivenCloseMarkerAt = now;
    if (trailing) {
      log.info("[EELog] Riven close marker ignored - trailing the previous close");
    } else {
      log.info("[EELog] Riven session close detected -> dispatching overlay close");
      _lastRivenCloseDispatchAt = now;
      endRivenSessionState();
      _callbacks.onRivenSessionClose?.();
    }
  }

  const hudVisMatch = line.match(RIVEN_PATTERNS.hudVis);
  if (!skipRivenFromFilePoll && hudVisMatch && !_rivenSessionActive) {
    const newVis = parseInt(hudVisMatch[1], 10);
    if (_rivenChatViewActive && newVis < _rivenChatHudVisLevel) {
      _rivenChatViewActive = false;
      _rivenChatHudVisLevel = 0;
      _rivenChatWeaponPath = null;
      _lastHudVisIncreaseAt = 0;
      log.info("[EELog] Riven chat-link view closed below its HudVis level");
      _callbacks.onRivenSessionClose?.();
    } else if (newVis > _lastHudVis) {
      if (!_rivenChatViewActive) _rivenChatWeaponPath = null;
      _lastHudVisIncreaseAt = Date.now();
    } else if (!_rivenChatViewActive && newVis < _lastHudVis) {
      _rivenChatWeaponPath = null;
      _lastHudVisIncreaseAt = 0;
    }
    _lastHudVis = newVis;
  }

  if (
    !skipRivenFromFilePoll &&
    !_rivenSessionActive &&
    !_rivenChatViewActive &&
    _lastHudVisIncreaseAt > 0 &&
    Date.now() - _lastHudVisIncreaseAt < CHAT_RIVEN_POPULATE_WINDOW_MS &&
    weaponMatch
  ) {
    _rivenChatWeaponPath = weaponMatch[1];
  }

  // PopulateInfo with Randomized mod path within 2s of HudVis increase = riven
  if (
    !skipRivenFromFilePoll &&
    !_rivenSessionActive &&
    !_rivenChatViewActive &&
    _lastHudVisIncreaseAt > 0 &&
    RIVEN_PATTERNS.populateRiven.test(line) &&
    Date.now() - _lastHudVisIncreaseAt < CHAT_RIVEN_POPULATE_WINDOW_MS
  ) {
    const weaponPath = _rivenChatWeaponPath;
    _rivenChatWeaponPath = null;
    _rivenChatViewActive = true;
    _rivenChatHudVisLevel = _lastHudVis;
    log.info(
      "[EELog] Riven chat-link view confirmed (PopulateInfo within HudVis window) -> dispatching chat view",
    );
    _callbacks.onRivenChatView?.();
    if (weaponPath) {
      log.info(`[EELog] Riven chat-link weapon load: ${weaponPath}`);
      _callbacks.onRivenWeaponPath?.(weaponPath);
    }
  }

  let rivenDialogHandled = skipRivenFromFilePoll;

  const rivenCycleMatch = !skipRivenFromFilePoll ? line.match(RIVEN_PATTERNS.cycleConfirmEn) : null;
  if (
    rivenCycleMatch &&
    !(!_rivenSessionActive && Date.now() - _rivenForceEndedAt < RIVEN_FORCE_END_COOLDOWN_MS)
  ) {
    rivenDialogHandled = true;
    _rivenSessionActive = true;
    resetRivenIdleTimer();
    _rivenPendingDialog = "roll_confirm";
    const weapon = rivenCycleMatch[1].trim();
    const cost = parseInt(rivenCycleMatch[2].replace(/[,. ]/g, ""), 10) || 0;
    log.info(`[EELog] Riven roll pending: weapon=${weapon}, cost=${cost}`);
    _callbacks.onRivenRollPending?.(weapon, cost);
  }

  if (
    !rivenDialogHandled &&
    !skipRivenFromFilePoll &&
    RIVEN_PATTERNS.choiceConfirmEn.test(line) &&
    !(!_rivenSessionActive && Date.now() - _rivenForceEndedAt < RIVEN_FORCE_END_COOLDOWN_MS)
  ) {
    rivenDialogHandled = true;
    _rivenSessionActive = true;
    resetRivenIdleTimer();
    _rivenPendingDialog = "choice";
    const now = Date.now();
    if (now - _lastRivenChoiceDialogAt >= RIVEN_CHOICE_DIALOG_COOLDOWN_MS) {
      _lastRivenChoiceDialogAt = now;
      log.info("[EELog] Riven choice dialog detected (English)");
    }
  }

  // Layer 2: generic fallback
  if (
    !rivenDialogHandled &&
    _rivenSessionActive &&
    _rivenPendingDialog === null &&
    Date.now() - _lastRivenSendResultAt >= RIVEN_GENERIC_DIALOG_COOLDOWN_MS &&
    RIVEN_PATTERNS.genericDialog.test(line) &&
    !RIVEN_PATTERNS.genericDialogNonInteractive.test(line)
  ) {
    resetRivenIdleTimer();
    _lastRivenGenericDialogAt = Date.now();
    if (_rivenNextDialog === "cycle") {
      _rivenPendingDialog = "roll_confirm";
      log.info("[EELog] Riven roll pending (generic dialog)");
      _callbacks.onRivenRollPending?.("", 0);
    } else {
      _rivenPendingDialog = "choice";
      log.info("[EELog] Riven choice dialog detected (generic)");
    }
  }

  let sendResultConsumedByRiven = false;

  const sendResultMatch = line.match(RIVEN_PATTERNS.sendResult);
  // Even when skipping riven from file poll, mark as consumed so it doesn't
  // leak to the relic picker close handler.
  if (sendResultMatch && _rivenSessionActive && skipRivenFromFilePoll) {
    sendResultConsumedByRiven = true;
  }
  if (
    sendResultMatch &&
    !skipRivenFromFilePoll &&
    (_rivenPendingDialog !== null || _rivenSessionActive)
  ) {
    sendResultConsumedByRiven = true;
    if (_rivenSessionActive) resetRivenIdleTimer();
    const resultCode = sendResultMatch[1];

    if (_rivenPendingDialog !== null) {
      if (resultCode === "4") {
        const now = Date.now();
        if (now - _lastRivenSendResultAt >= RIVEN_SEND_RESULT_COOLDOWN_MS) {
          _lastRivenSendResultAt = now;
          if (_rivenPendingDialog === "roll_confirm") {
            _rivenNextDialog = "choice";
            log.info("[EELog] Riven roll confirmed -> dispatching OCR trigger");
            _callbacks.onRivenRollConfirmed?.();
          } else if (_rivenPendingDialog === "choice") {
            _rivenNextDialog = "cycle";
            log.info("[EELog] Riven choice confirmed -> dispatching choice scan");
            _callbacks.onRivenChoiceConfirmed?.();
          }
        }
      } else {
        log.info(`[EELog] Riven dialog cancelled (SendResult ${resultCode})`);
      }
      _rivenPendingDialog = null;
    }
  }

  return sendResultConsumedByRiven;
}

export function isRivenSessionActive(): boolean {
  return _rivenSessionActive;
}

export function forceEndRivenSession(): void {
  if (!_rivenSessionActive && !_rivenPendingDialog && !_rivenChatViewActive) return;
  _rivenSessionActive = false;
  _rivenSessionStartedAt = 0;
  _rivenDioramaReady = false;
  _rivenChatViewActive = false;
  _rivenChatHudVisLevel = 0;
  _rivenChatWeaponPath = null;
  _rivenPendingDialog = null;
  _rivenNextDialog = "cycle";
  _rivenForceEndedAt = Date.now();
  _lastHudVis = 0;
  _lastHudVisIncreaseAt = 0;
  if (_rivenSessionIdleTimer) {
    clearTimeout(_rivenSessionIdleTimer);
    _rivenSessionIdleTimer = null;
  }
  log.info("[EELog] Riven session force-ended (overlay dismissed externally)");
}

export function resetRivenState(): void {
  _rivenPendingDialog = null;
  _rivenNextDialog = "cycle";
  _rivenSessionActive = false;
  _rivenSessionStartedAt = 0;
  _rivenDioramaReady = false;
  _rivenWeaponPathSent = false;
  _rivenChatViewActive = false;
  _rivenChatHudVisLevel = 0;
  _rivenChatWeaponPath = null;
  _lastRivenSendResultAt = 0;
  _lastRivenGenericDialogAt = 0;
  _lastRivenChoiceDialogAt = 0;
  _lastRivenSessionOpenAt = 0;
  _lastSuppressedOpenLogAt = 0;
  _lastRivenDioramaAt = 0;
  _lastRivenCloseMarkerAt = 0;
  _lastRivenCloseDispatchAt = 0;
  _rivenForceEndedAt = 0;
  _lastHudVis = 0;
  _lastHudVisIncreaseAt = 0;
  if (_rivenSessionIdleTimer) {
    clearTimeout(_rivenSessionIdleTimer);
    _rivenSessionIdleTimer = null;
  }
  _callbacks = {
    onRivenSessionOpen: null,
    onRivenSessionClose: null,
    onRivenChatView: null,
    onRivenRollPending: null,
    onRivenRollConfirmed: null,
    onRivenDioramaSetup: null,
    onRivenChoiceConfirmed: null,
    onRivenWeaponPath: null,
  };
}
