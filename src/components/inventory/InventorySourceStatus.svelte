<script lang="ts">
  import { onMount } from "svelte";

  import { locale, tr, type MessageKey } from "../../lib/i18n.js";
  import { describeInventorySource } from "../../lib/inventorySourceLabel.js";
  import { useInterval } from "../../lib/timers.js";
  import { currentView, settingsTabRequest } from "../../stores/app.js";
  import { inventoryData, inventoryStatus } from "../../stores/data.js";
  import type { IpcInvokeMap } from "../../types/ipc.js";

  const STALE_AFTER_MS = 60 * 60 * 1_000;
  let now = Date.now();
  onMount(() =>
    useInterval(() => {
      now = Date.now();
    }, 30_000),
  );

  function stateKey(
    status: IpcInvokeMap["getInventoryStatus"]["return"] | null | undefined,
    hasSnapshot: boolean,
    fileTime: Date | null,
    currentTime: number,
  ): MessageKey {
    if (status === undefined) return "inventory.source.checking";
    if (!status) return "inventory.source.unknown";
    if (status.source === "none") return "inventory.source.disabled";
    if (status.lastError?.code === "access-denied") return "inventory.source.denied";
    if (status.lastError?.code === "missing") return "inventory.source.missing";
    if (status.lastError?.kind === "parse") return "inventory.source.invalid";
    if (status.lastError) return "inventory.source.unavailable";
    if (!hasSnapshot) return "inventory.source.missing";
    if (!fileTime) return "inventory.source.unknown";
    return currentTime - fileTime.getTime() > STALE_AFTER_MS
      ? "inventory.source.old"
      : "inventory.source.loaded";
  }

  $: source = $inventoryStatus
    ? describeInventorySource($inventoryStatus.source, $inventoryStatus.path)
    : null;
  $: modifiedAt = $inventoryStatus?.modifiedAt;
  $: fileTime = modifiedAt && modifiedAt <= now && modifiedAt > 0 ? new Date(modifiedAt) : null;
  $: statusKey = stateKey($inventoryStatus, Boolean($inventoryData), fileTime, now);

  function chooseSource(): void {
    settingsTabRequest.set("general");
    currentView.set("settings");
  }
</script>

<div class="source-status" data-inventory-source-status data-state={statusKey.split(".").at(-1)}>
  <div role="status">
    <strong>{$tr(statusKey)}</strong>
    <div class="source-details">
      {#if source}<span>{source.detail || $tr(source.labelKey)}</span>{/if}
      {#if fileTime}
        <time datetime={fileTime.toISOString()}>
          {fileTime.toLocaleString($locale, { dateStyle: "medium", timeStyle: "short" })}
        </time>
      {/if}
      {#if $inventoryStatus?.lastError && $inventoryData}
        <span>{$tr("inventory.source.retained")}</span>
      {/if}
    </div>
  </div>
  <button type="button" class="btn-secondary" on:click={chooseSource}>
    {$tr("inventory.source.settings")}
  </button>
</div>

<style>
  .source-status {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px 16px;
    border: 1px solid var(--wf-brand-border, var(--border));
    border-radius: 8px;
    background: var(--wf-brand-surface, var(--bg-surface));
    padding: 8px 12px;
    margin-block-end: 12px;
    color: var(--wf-brand-text, var(--text-primary));
    font-size: 0.875rem;
  }
  .source-status:is(
      [data-state="old"],
      [data-state="denied"],
      [data-state="invalid"],
      [data-state="unavailable"]
    )
    strong {
    color: var(--wf-brand-warning, var(--warning));
  }
  .source-details {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    color: var(--wf-brand-muted, var(--text-secondary));
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
  }
  .source-status button {
    min-height: 44px;
    color: inherit;
    border-color: var(--wf-brand-control-border, var(--border-strong));
  }
</style>
