<script lang="ts">
  // One copy of the presence controls for both the Market header and the
  // titlebar popover, so the two can never drift apart.
  import { invoke } from "../../lib/ipc.js";
  import { tr } from "../../lib/i18n.js";
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

  // Only tick while there is a deadline to count down, and key the effect on the
  // deadline alone: reading the whole store here would restart the interval on
  // every unrelated presence change.
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
      console.error("[Market] saving presence settings failed:", error);
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

<div class="flex flex-wrap items-center gap-1.5" data-wfm-presence-bar>
  {#each statusOptions as [statusKey, label] (statusKey)}
    <button
      class="rounded-md border border-border bg-bg-surface px-2 py-1 font-display text-xs font-semibold text-text-secondary transition-all duration-[0.14s] hover:border-text-secondary hover:text-text-primary"
      class:statusOnlineActive={statusKey === "online" && $marketViewState.status === statusKey}
      class:statusIngameActive={statusKey === "ingame" && $marketViewState.status === statusKey}
      class:statusInvisibleActive={statusKey === "invisible" &&
        $marketViewState.status === statusKey}
      data-wfm-status-option={statusKey}
      onclick={() => setWfmStatus(statusKey)}>{label}</button
    >
  {/each}

  <span class="mx-1 h-4 w-px bg-surface-hover"></span>

  <button
    class="presence-chip"
    class:presenceChipActive={autoIngameEnabled}
    title={$tr("market.autoIngameTitle")}
    onclick={() => saveAutoIngame(!autoIngameEnabled)}
  >
    {$tr("market.autoInGame")}{autoIngameEnabled ? $tr("market.stateOn") : $tr("market.stateOff")}
  </button>

  <button
    class="presence-chip"
    class:presenceChipActive={awayIdleEnabled}
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

  <button
    class="presence-chip"
    class:presenceChipActive={awayClosedEnabled}
    title={$tr("market.awayClosedTitle")}
    onclick={() => saveAwayClosed(!awayClosedEnabled)}
  >
    {$tr("market.awayClosed")}{awayClosedEnabled ? $tr("market.stateOn") : $tr("market.stateOff")}
  </button>

  <!-- Warframe.market disables the same control while invisible: an already
       hidden status has nothing left to expire. -->
  <div class="flex flex-wrap items-center gap-1.5" class:presenceHoldIdle={holdIdle}>
    <span class="ml-1 font-display text-xs text-text-muted">{$tr("market.keepStatusFor")}</span>
    {#each WFM_STATUS_HOLD_MINUTES as minutes, index (minutes)}
      <button
        class="presence-chip"
        class:presenceChipActive={statusHoldMinutes === minutes && !holdIdle}
        disabled={holdIdle}
        onclick={() => saveHoldMinutes(minutes)}>{holdLabels[index]}</button
      >
    {/each}
  </div>

  {#if holdRemaining}
    <span class="font-display text-xs text-text-secondary"
      >{$tr("market.holdLeft", { time: holdRemaining })}</span
    >
  {/if}
  {#if $marketViewState.statusAutoActive}
    <span class="font-display text-xs text-text-muted">{$tr("market.followingGame")}</span>
  {:else if $marketViewState.statusAwayActive}
    <span class="font-display text-xs text-text-muted">{$tr("market.presenceAway")}</span>
  {/if}
</div>

<style>
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
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--bg-surface);
    padding: 0.15rem 0.6rem;
    font-family: var(--font-display);
    font-size: 0.7rem;
    font-weight: 600;
    color: var(--text-muted);
    transition: all 0.14s;
  }
  .presence-chip:hover {
    border-color: var(--text-secondary);
    color: var(--text-primary);
  }
  .presenceChipActive {
    border-color: var(--info-dim);
    background: var(--info-bg);
    color: var(--info);
  }
  .presenceHoldIdle {
    opacity: 0.4;
  }
  .presence-chip:disabled {
    cursor: default;
  }
  .presence-chip:disabled:hover {
    border-color: var(--border);
    color: var(--text-muted);
  }
  .presence-minutes {
    width: 3.2rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--bg-surface);
    padding: 0.15rem 0.5rem;
    font-family: var(--font-display);
    font-size: 0.7rem;
    font-weight: 600;
    color: var(--text-primary);
  }
  .presence-minutes:disabled {
    opacity: 0.4;
  }
</style>
