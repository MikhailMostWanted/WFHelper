<script lang="ts">
  import { onMount } from "svelte";
  import { locale } from "../../lib/i18n.js";
  import { invoke, on } from "../../lib/ipc.js";
  import { dashboardDesignCopy } from "../../lib/dashboardDesignCopy.js";
  import { currentView, settingsTabRequest } from "../../stores/app.js";
  import type { AccountBridgeStatus } from "../../types/ipc.js";

  let status = $state<AccountBridgeStatus | null>(null);
  let failed = $state(false);
  let loading = $state(true);
  const copy = $derived(dashboardDesignCopy($locale));
  const snapshot = $derived(status?.snapshot ?? null);
  const bridge = $derived(status?.bridge ?? null);
  const counts = $derived({
    available: snapshot?.sections.filter((section) => section.status === "available").length ?? 0,
    partial: snapshot?.sections.filter((section) => section.status === "partial").length ?? 0,
    missing: snapshot?.sections.filter((section) => section.status === "missing").length ?? 0,
  });

  function date(value: number | null | undefined, language: string): string {
    if (value == null || !Number.isFinite(value) || !Number.isFinite(new Date(value).getTime()))
      return copy.unknownDate;
    return new Date(value).toLocaleString(language, { dateStyle: "short", timeStyle: "short" });
  }

  async function refresh(): Promise<void> {
    try {
      status = await invoke("getAccountBridgeStatus");
      failed = false;
    } catch {
      failed = true;
    } finally {
      loading = false;
    }
  }

  function openAccount(): void {
    settingsTabRequest.set("chatgpt");
    currentView.set("settings");
  }

  onMount(() => {
    void refresh();
    const removeInventory = on("inventory-updated", () => void refresh());
    const removeAccount = on("profile-account-changed", () => void refresh());
    return () => {
      removeInventory();
      removeAccount();
    };
  });
</script>

<section class="account-pulse" aria-label={copy.accountLabel} data-dashboard-account>
  <div class="pulse-heading">
    <span class="eyebrow">{copy.accountLabel}</span>
    <span class="connection-state" class:connected={bridge?.connected}>
      <i aria-hidden="true"></i>{bridge?.connected ? copy.serverReady : copy.serverOff}
    </span>
  </div>
  <div class="pulse-identity">
    <span class="chatgpt-mark" aria-hidden="true">W<span>↗</span></span>
    <div>
      <h3>{copy.accountTitle}</h3>
      <p>{copy.accountLead}</p>
    </div>
  </div>

  {#if snapshot}
    <div class="pulse-dates">
      <div>
        <span>{copy.snapshotDate}</span><strong>{date(snapshot.inventoryUpdatedAt, $locale)}</strong
        >
      </div>
      <div>
        <span>{copy.syncDate}</span><strong
          >{bridge?.lastSentAt != null ? date(bridge.lastSentAt, $locale) : copy.notSent}</strong
        >
      </div>
    </div>
    <div class="pulse-coverage" aria-label={copy.dataMapTitle}>
      <span><strong>{counts.available}</strong>{copy.received}</span>
      <span><strong>{counts.partial}</strong>{copy.partial}</span>
      <span><strong>{counts.missing}</strong>{copy.missing}</span>
    </div>
  {:else}
    <p class="pulse-message">
      {loading ? copy.reading : failed ? copy.statusUnavailable : copy.unavailable}
    </p>
  {/if}
  <button type="button" class="pulse-action" data-chatgpt-quick-open onclick={openAccount}>
    {copy.accountOpen}<span aria-hidden="true">↗</span>
  </button>
</section>

<style>
  .account-pulse {
    display: flex;
    flex-direction: column;
    gap: 1.1rem;
    min-width: 0;
    padding: 1.35rem;
    background: var(--ui-panel-bg);
    border: 1px solid var(--ui-panel-border);
    border-radius: var(--radius-xl);
  }
  .pulse-heading {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    align-items: center;
    justify-content: space-between;
  }
  .eyebrow {
    color: var(--text-muted);
    font-size: 0.7rem;
    letter-spacing: 0.14em;
    font-weight: 600;
  }
  .connection-state {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.74rem;
    color: var(--text-secondary);
  }
  .connection-state i {
    width: 0.38rem;
    height: 0.38rem;
    border-radius: 50%;
    background: var(--text-muted);
  }
  .connection-state.connected i {
    background: var(--accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 10%, transparent);
  }
  .pulse-identity {
    display: flex;
    gap: 0.8rem;
    align-items: center;
  }
  .chatgpt-mark {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.1rem;
    flex-shrink: 0;
    width: 2.7rem;
    height: 2.7rem;
    border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--border));
    border-radius: 0.8rem;
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 7%, var(--bg-base));
    font-family: var(--font-display);
    font-size: 1.25rem;
    font-weight: 700;
  }
  .chatgpt-mark span {
    font-size: 0.85rem;
    align-self: flex-start;
    margin-top: 0.4rem;
  }
  h3 {
    margin: 0 0 0.25rem;
    color: var(--text-primary);
    font-size: 1.1rem;
    font-weight: 600;
    letter-spacing: -0.02em;
  }
  p {
    margin: 0;
    color: var(--text-secondary);
    font-size: 0.82rem;
    line-height: 1.55;
  }
  .pulse-dates {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 150px), 1fr));
    gap: 1rem;
    padding-top: 0.2rem;
  }
  .pulse-dates span {
    display: block;
    color: var(--text-muted);
    font-size: 0.73rem;
  }
  .pulse-dates strong {
    display: block;
    margin-top: 0.3rem;
    color: var(--text-primary);
    font-size: 0.85rem;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }
  .pulse-coverage {
    display: flex;
    flex-wrap: wrap;
    gap: 0.8rem;
    padding: 0.8rem 0;
    border-top: 1px solid var(--border-subtle);
    border-bottom: 1px solid var(--border-subtle);
  }
  .pulse-coverage span {
    display: inline-flex;
    gap: 0.3rem;
    align-items: baseline;
    font-size: 0.72rem;
    color: var(--text-muted);
  }
  .pulse-coverage strong {
    font-size: 0.96rem;
    color: var(--text-secondary);
    font-weight: 500;
  }
  .pulse-coverage span:first-child strong {
    color: var(--accent);
  }
  .pulse-message {
    min-height: 5rem;
    display: flex;
    align-items: center;
  }
  .pulse-action {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
    margin-top: auto;
    border: 0;
    padding: 0.35rem 0;
    background: transparent;
    color: var(--accent);
    font-size: 0.84rem;
    font-weight: 600;
    cursor: pointer;
    text-align: left;
  }
  .pulse-action:hover {
    color: var(--text-primary);
  }
  .pulse-action:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 5px;
    border-radius: var(--radius-sm);
  }
</style>
