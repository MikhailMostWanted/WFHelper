<script lang="ts">
  import { tr } from "../../lib/i18n.js";
  import { invoke } from "../../lib/ipc.js";
  import type { RewardOcrDiagnosticResult, RewardOcrDiagnosticSlot } from "../../types/ipc.js";

  let running = false;
  let requestFailed = false;
  let result: RewardOcrDiagnosticResult | null = null;

  function confidence(value: number | null): string {
    return value == null ? "-" : `${Math.round(value * 100)}%`;
  }

  function itemLabel(slot: RewardOcrDiagnosticSlot): string {
    return slot.itemDisplayName || slot.itemName || "-";
  }

  async function runDiagnostic(): Promise<void> {
    if (running) return;
    running = true;
    requestFailed = false;
    try {
      result = await invoke("runRewardOcrDiagnostic");
    } catch {
      result = null;
      requestFailed = true;
    } finally {
      running = false;
    }
  }

  async function openDebugFolder(): Promise<void> {
    try {
      await invoke("openScanDebugFolder");
    } catch {
      // The global settings status already covers normal folder access; this
      // shortcut is best-effort and should not erase the scan result.
    }
  }
</script>

<div class="mt-2 grid gap-2">
  <div class="flex flex-wrap items-center gap-2">
    <button class="btn-secondary btn-sm" disabled={running} onclick={runDiagnostic}>
      {running ? $tr("settings.ocrDiagnosticRunning") : $tr("settings.ocrDiagnosticRun")}
    </button>
    <button class="btn-secondary btn-sm" onclick={openDebugFolder}>
      {$tr("settings.openScanDebug")}
    </button>
  </div>

  <p class="m-0 text-xs leading-snug text-text-muted">
    {$tr("settings.ocrDiagnosticHint")}
  </p>

  {#if requestFailed}
    <p class="m-0 text-xs text-danger">{$tr("settings.ocrDiagnosticRequestFailed")}</p>
  {:else if result}
    <div class="grid gap-2 rounded-[var(--radius-md)] border border-border bg-bg-raised p-2.5">
      {#if !result.ok && result.error === "capture-failed"}
        <p class="m-0 text-sm text-danger">{$tr("settings.ocrDiagnosticCaptureFailed")}</p>
      {:else if !result.ok}
        <p class="m-0 text-sm text-danger">{$tr("settings.ocrDiagnosticRequestFailed")}</p>
      {:else if result.items.length > 0}
        <p class="m-0 text-sm font-semibold text-text-primary">
          {$tr("settings.ocrDiagnosticDetected", {
            count: result.items.length,
            ms: result.elapsedMs,
          })}
        </p>
      {:else}
        <p class="m-0 text-sm text-text-secondary">
          {$tr("settings.ocrDiagnosticNoRewards")}
        </p>
      {/if}

      <div class="grid gap-0.5 text-xs text-text-secondary">
        <span>
          {$tr("settings.ocrDiagnosticEngine", {
            reader: result.reader,
            mode: result.mode,
            width: result.captureWidth,
            height: result.captureHeight,
          })}
        </span>
        <span>
          {$tr("settings.ocrDiagnosticTiming", {
            ocr: result.ocrMs,
            total: result.elapsedMs,
            reads: result.ocrReads,
            retries: result.adaptiveRetries,
          })}
        </span>
      </div>

      {#if !result.ocrAvailable}
        <p class="m-0 text-xs text-danger">
          {$tr("settings.ocrDiagnosticUnavailable", { reason: result.ocrReason || "-" })}
        </p>
      {/if}

      {#each result.slots as slot (slot.slotIndex)}
        <div class="grid gap-1 rounded-[var(--radius-md)] border border-border p-2 text-xs">
          <div class="font-semibold text-text-primary">
            {$tr("settings.ocrDiagnosticSlot", { slot: slot.slotIndex + 1 })}
          </div>
          <div class="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-2 gap-y-1">
            <span class="text-text-muted">{$tr("settings.ocrDiagnosticRaw")}</span>
            <code class="break-words text-text-primary">{slot.rawText || "-"}</code>
            <span class="text-text-muted">{$tr("settings.ocrDiagnosticResolved")}</span>
            <code class="break-words text-text-primary">{slot.resolvedText || "-"}</code>
            <span class="text-text-muted">{$tr("settings.ocrDiagnosticMatch")}</span>
            <span class="text-text-primary">
              {slot.matchMode || slot.rankMode || "-"} ·
              {confidence(slot.matchConfidence ?? slot.rankConfidence)}
            </span>
            <span class="text-text-muted">{$tr("settings.ocrDiagnosticItem")}</span>
            <span class="text-text-primary">{itemLabel(slot)}</span>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
