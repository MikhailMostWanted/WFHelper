<script lang="ts">
  // Shared by the Market header and the titlebar popover.
  import { invoke } from "../../lib/ipc.js";
  import { tr } from "../../lib/i18n.js";
  import { log } from "../../lib/log.js";
  import { setWfmStatus } from "../../lib/wfm/presence.js";
  import { marketViewState } from "../../stores/market.js";
  import { applyOverlaySettingsResponse, overlaySettings } from "../../stores/overlaySettings.js";
  import {
    WFM_STATUS_HOLD_MINUTES,
    normalizeWfmAwayIdleMinutes,
  } from "../../../config/shared/wfm.js";
  import type { WfmStatus } from "../../types/market.js";

  let holdNow = $state(Date.now());
  let holdTicker: ReturnType<typeof setInterval> | null = null;

  const statusOptions = $derived<Array<[WfmStatus, string]>>([
    ["online", $tr("common.online")],
    ["ingame", $tr("common.inGame")],
    ["invisible", $tr("common.invisible")],
  ]);

  const autoIngameEnabled = $derived($overlaySettings.wfmAutoIngameEnabled === true);
  const statusHoldMinutes = $derived($overlaySettings.wfmStatusHoldMinutes ?? 0);
  const awayIdleEnabled = $derived($overlaySettings.wfmAwayIdleEnabled === true);
  const awayIdleMinutes = $derived(
    normalizeWfmAwayIdleMinutes($overlaySettings.wfmAwayIdleMinutes),
  );
  const awayClosedEnabled = $derived($overlaySettings.wfmAwayWhenClosedEnabled === true);
  const holdDeadline = $derived($marketViewState.statusExpiresAt);
  const holdRemaining = $derived(formatHoldRemaining(holdDeadline, holdNow));
  const holdIdle = $derived(!$marketViewState.status || $marketViewState.status === "invisible");
  const holdLabels = $derived(
    WFM_STATUS_HOLD_MINUTES.map((minutes) => {
      if (!minutes) return $tr("market.holdAlways");
      return minutes < 60 ? `${minutes}m` : `${minutes / 60}h`;
    }),
  );

  // Keyed on the deadline alone, or every unrelated presence change would
  // restart the interval.
  $effect(() => {
    if (holdDeadline === null) return;
    holdNow = Date.now();
    holdTicker = setInterval(() => (holdNow = Date.now()), 1000);
    return () => {
      if (holdTicker) clearInterval(holdTicker);
      holdTicker = null;
    };
  });

  function formatHoldRemaining(expiresAt: number | null, now: number): string {
    if (!expiresAt) return "";
    const totalSeconds = Math.max(0, Math.round((expiresAt - now) / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    if (hours) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
    return minutes ? `${minutes}m` : `${totalSeconds}s`;
  }

  async function saveOverlayPatch(patch: Record<string, unknown>): Promise<void> {
    try {
      const saved = await invoke("setOverlaySettings", patch);
      if (saved) applyOverlaySettingsResponse(saved);
    } catch (error) {
      log.error("[Market] saving presence settings failed:", error);
    }
  }

  const saveAutoIngame = (enabled: boolean) => saveOverlayPatch({ wfmAutoIngameEnabled: enabled });
  const saveHoldMinutes = (minutes: number) => saveOverlayPatch({ wfmStatusHoldMinutes: minutes });
  const saveAwayIdle = (enabled: boolean) => saveOverlayPatch({ wfmAwayIdleEnabled: enabled });
  const saveAwayClosed = (enabled: boolean) =>
    saveOverlayPatch({ wfmAwayWhenClosedEnabled: enabled });

  // An emptied number input binds to null, which would clamp up to the floor.
  function saveAwayIdleMinutes(value: string): void {
    const minutes = normalizeWfmAwayIdleMinutes(value, awayIdleMinutes);
    void saveOverlayPatch({ wfmAwayIdleMinutes: minutes });
  }
</script>

<div class="presence-workspace" data-wfm-presence-bar>
  <div class="presence-status-group" role="group" aria-label={$tr("browse.status")}>
    {#each statusOptions as [statusKey, label] (statusKey)}
      <button
        type="button"
        class="presence-status"
        class:statusOnlineActive={statusKey === "online" && $marketViewState.status === statusKey}
        class:statusIngameActive={statusKey === "ingame" && $marketViewState.status === statusKey}
        class:statusInvisibleActive={statusKey === "invisible" &&
          $marketViewState.status === statusKey}
        data-wfm-status-option={statusKey}
        aria-pressed={$marketViewState.status === statusKey}
        onclick={() => setWfmStatus(statusKey)}>{label}</button
      >
    {/each}
  </div>

  <div class="presence-automations">
    <button
      type="button"
      class="presence-chip"
      class:presenceChipActive={autoIngameEnabled}
      aria-pressed={autoIngameEnabled}
      title={$tr("market.autoIngameTitle")}
      onclick={() => saveAutoIngame(!autoIngameEnabled)}
    >
      {$tr("market.autoInGame")}{autoIngameEnabled ? $tr("market.stateOn") : $tr("market.stateOff")}
    </button>

    <div class="presence-idle-control" role="group" aria-label={$tr("market.awayIdleTitle")}>
      <button
        type="button"
        class="presence-chip"
        class:presenceChipActive={awayIdleEnabled}
        aria-pressed={awayIdleEnabled}
        title={$tr("market.awayIdleTitle")}
        onclick={() => saveAwayIdle(!awayIdleEnabled)}
      >
        {$tr("market.awayIdle", { minutes: awayIdleMinutes })}{awayIdleEnabled
          ? $tr("market.stateOn")
          : $tr("market.stateOff")}
      </button>
      <input
        class="presence-minutes"
        type="number"
        min="1"
        max="60"
        value={awayIdleMinutes}
        disabled={!awayIdleEnabled}
        title={$tr("market.awayIdleTitle")}
        aria-label={$tr("market.awayIdle", { minutes: awayIdleMinutes })}
        onchange={(event) => saveAwayIdleMinutes(event.currentTarget.value)}
      />
    </div>

    <button
      type="button"
      class="presence-chip"
      class:presenceChipActive={awayClosedEnabled}
      aria-pressed={awayClosedEnabled}
      title={$tr("market.awayClosedTitle")}
      onclick={() => saveAwayClosed(!awayClosedEnabled)}
    >
      {$tr("market.awayClosed")}{awayClosedEnabled ? $tr("market.stateOn") : $tr("market.stateOff")}
    </button>
  </div>

  <!-- Warframe.market disables this too; a hidden status cannot expire. -->
  <div
    class="presence-hold-group"
    class:presenceHoldIdle={holdIdle}
    role="group"
    aria-label={$tr("market.keepStatusFor")}
  >
    <span class="presence-label">{$tr("market.keepStatusFor")}</span>
    {#each WFM_STATUS_HOLD_MINUTES as minutes, index (minutes)}
      <button
        type="button"
        class="presence-chip"
        class:presenceChipActive={statusHoldMinutes === minutes && !holdIdle}
        aria-pressed={statusHoldMinutes === minutes && !holdIdle}
        disabled={holdIdle}
        onclick={() => saveHoldMinutes(minutes)}>{holdLabels[index]}</button
      >
    {/each}
  </div>

  {#if holdRemaining}
    <span class="presence-countdown">{$tr("market.holdLeft", { time: holdRemaining })}</span>
  {/if}
  {#if $marketViewState.statusAutoActive}
    <span class="font-display text-xs text-text-muted">{$tr("market.followingGame")}</span>
  {:else if $marketViewState.statusAwayActive}
    <span class="font-display text-xs text-text-muted">{$tr("market.presenceAway")}</span>
  {/if}
</div>

<style>
  .presence-workspace {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.65rem 0.9rem;
  }
  .presence-status-group,
  .presence-automations,
  .presence-hold-group {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem;
  }
  .presence-idle-control {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    max-width: 100%;
  }
  .presence-status-group {
    padding: 0.25rem;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    background: var(--bg-deep);
  }
  .presence-status {
    min-height: 2rem;
    padding: 0.35rem 0.7rem;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    font-family: var(--font-display);
    font-size: 0.8rem;
    font-weight: 600;
    line-height: 1.25;
    color: var(--text-secondary);
    cursor: pointer;
  }
  .presence-status:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }
  .statusOnlineActive {
    border-color: var(--success-dim);
    background: var(--success-bg);
    color: var(--success);
  }
  .statusIngameActive {
    border-color: var(--info-dim);
    background: var(--info-bg);
    color: var(--info);
  }
  .statusInvisibleActive {
    border-color: var(--border-subtle);
    background: var(--surface-hover);
    color: var(--text-primary);
  }
  .presence-chip {
    min-height: 2rem;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    background: var(--bg-surface);
    padding: 0.35rem 0.65rem;
    font-family: var(--font-display);
    font-size: 0.8rem;
    font-weight: 600;
    line-height: 1.3;
    color: var(--text-secondary);
    cursor: pointer;
    transition:
      border-color 140ms,
      background 140ms,
      color 140ms;
  }
  .presence-chip:hover {
    border-color: var(--text-secondary);
    color: var(--text-primary);
  }
  .presenceChipActive {
    border-color: var(--accent-dim);
    background: var(--accent-glow);
    color: var(--accent-bright);
  }
  .presence-label {
    margin-right: 0.25rem;
    font-size: 0.78rem;
    color: var(--text-secondary);
  }
  .presenceHoldIdle .presence-label {
    color: var(--text-muted);
  }
  .presence-chip:disabled {
    cursor: default;
    color: var(--text-muted);
  }
  .presence-chip:disabled:hover {
    border-color: var(--border);
    color: var(--text-muted);
  }
  .presence-minutes {
    width: 3.6rem;
    min-height: 2rem;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    background: var(--bg-deep);
    padding: 0.35rem 0.5rem;
    font-family: var(--font-display);
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--text-primary);
  }
  .presence-minutes:disabled {
    opacity: 0.55;
  }
  .presence-countdown {
    padding: 0.35rem 0.65rem;
    border: 1px solid var(--accent-dim);
    border-radius: var(--radius-md);
    background: var(--accent-glow);
    font-family: var(--font-display);
    font-size: 0.8rem;
    font-variant-numeric: tabular-nums;
    color: var(--accent-bright);
  }
  button:focus-visible,
  input:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
  }
  @media (prefers-reduced-motion: reduce) {
    .presence-chip {
      transition: none;
    }
  }
</style>
