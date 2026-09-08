<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import {
    DEFAULT_REWARD_FIELD_STYLE,
    REWARD_OVERLAY_CANVAS,
    REWARD_OVERLAY_FIELDS,
  } from "../../config/shared/rewardOverlayLayout.js";
  import type {
    RewardOverlayEditCommand,
    RewardOverlayEditState,
    RewardOverlayField,
    RewardOverlayFieldStyle,
  } from "../../config/shared/rewardOverlayLayout.js";
  import { tr } from "../lib/i18n.js";
  import type { MessageKey } from "../lib/i18n.js";
  import { invoke, on } from "../lib/ipc.js";
  import ModalShell from "./ModalShell.svelte";
  import RewardOverlayCanvas from "./RewardOverlayCanvas.svelte";

  let { onClose }: { onClose: () => void } = $props();

  const labels: Record<RewardOverlayField, { key: MessageKey; number?: number }> = {
    slotLabel: { key: "rewardEditor.slotLabel" },
    itemName: { key: "common.name" },
    rarity: { key: "wiki.col.rarity" },
    platinumIcon: { key: "rewardEditor.platinumIcon" },
    platinumValue: { key: "common.platinum" },
    ducatIcon: { key: "rewardEditor.ducatIcon" },
    ducatValue: { key: "common.ducats" },
    pricePlaceholder: { key: "rewardEditor.pricePlaceholder" },
    owned: { key: "common.owned" },
    mastery: { key: "common.mastery" },
    foundry: { key: "common.foundry" },
    setOwned: { key: "rewardEditor.setOwned" },
    setPrice: { key: "rewardEditor.setPrice" },
    part0Icon: { key: "rewardEditor.partIcon", number: 1 },
    part0Count: { key: "rewardEditor.partCount", number: 1 },
    part1Icon: { key: "rewardEditor.partIcon", number: 2 },
    part1Count: { key: "rewardEditor.partCount", number: 2 },
    part2Icon: { key: "rewardEditor.partIcon", number: 3 },
    part2Count: { key: "rewardEditor.partCount", number: 3 },
    part3Icon: { key: "rewardEditor.partIcon", number: 4 },
    part3Count: { key: "rewardEditor.partCount", number: 4 },
    part4Icon: { key: "rewardEditor.partIcon", number: 5 },
    part4Count: { key: "rewardEditor.partCount", number: 5 },
    part5Icon: { key: "rewardEditor.partIcon", number: 6 },
    part5Count: { key: "rewardEditor.partCount", number: 6 },
    bestLabel: { key: "rewardEditor.bestLabel" },
    bestName: { key: "rewardEditor.bestName" },
    bestPlatinumIcon: { key: "rewardEditor.bestPlatinumIcon" },
    bestPlatinumValue: { key: "rewardEditor.bestPlatinumValue" },
    bestPlaceholder: { key: "rewardEditor.bestPlaceholder" },
    scanSpinner: { key: "rewardEditor.scanSpinner" },
    scanText: { key: "rewardEditor.scanText" },
    errorText: { key: "rewardEditor.errorText" },
    dragHint: { key: "rewardEditor.dragHint" },
    closeButton: { key: "rewardEditor.closeButton" },
  };
  const variants: Array<{ value: RewardOverlayEditState["previewVariant"]; key: MessageKey }> = [
    { value: "rewards", key: "rewardEditor.previewRewards" },
    { value: "missing", key: "rewardEditor.previewMissing" },
    { value: "scanning", key: "overlay.riven.scanning" },
    { value: "error", key: "rewardEditor.previewError" },
  ];
  const previewCounts = [1, 2, 3, 4] as const;
  let editState = $state<RewardOverlayEditState | null>(null);
  let errorKey = $state<MessageKey | null>(null);
  let ending = $state(false);
  let canvas = $state<{ flush: () => Promise<void> }>();
  let draining = false;
  let hostUpdates: Promise<void> = Promise.resolve();
  let destroyed = false;
  let sessionId: string | null = null;
  let earlyState: RewardOverlayEditState | null = null;
  let unsubscribe: (() => void) | null = null;
  const selected = $derived(editState?.selectedField ?? "platinumValue");
  const style = $derived(editState?.layout.fields[selected] ?? DEFAULT_REWARD_FIELD_STYLE);

  function accept(next: RewardOverlayEditState): void {
    if (destroyed) return;
    if (!sessionId) {
      earlyState = next;
      return;
    }
    if (next.revision <= (editState?.revision ?? -1)) return;
    if (next.sessionId === null) {
      sessionId = null;
      if (!ending) onClose();
      return;
    }
    if (next.sessionId === sessionId) editState = next;
  }

  async function begin(): Promise<void> {
    try {
      unsubscribe = on("reward-overlay-edit-state", accept);
      const next = await invoke("beginRewardOverlayEdit");
      if (destroyed) {
        if (next.sessionId) await invoke("endRewardOverlayEdit", next.sessionId, false);
        return;
      }
      if (!next.sessionId) throw new Error("No reward editor session");
      sessionId = next.sessionId;
      editState = next;
      if (earlyState) accept(earlyState);
      earlyState = null;
    } catch {
      if (!destroyed) errorKey = "rewardEditor.openFailed";
    }
  }

  async function update(
    command: RewardOverlayEditCommand,
  ): Promise<RewardOverlayEditState | undefined> {
    if (!sessionId || (ending && !draining)) return;
    errorKey = null;
    try {
      const next = await invoke("updateRewardOverlayEdit", sessionId, command);
      accept(next);
      return next;
    } catch {
      if (!destroyed && !ending) errorKey = "rewardEditor.updateFailed";
    }
  }

  function patch(changes: Partial<RewardOverlayFieldStyle>): void {
    edit({ type: "field", field: selected, patch: changes });
  }

  function edit(command: RewardOverlayEditCommand): void {
    hostUpdates = hostUpdates
      .then(async () => {
        if (destroyed || !sessionId) return;
        await canvas?.flush();
        await update(command);
      })
      .catch(() => {
        if (!destroyed) errorKey = "rewardEditor.updateFailed";
      });
  }

  function position(axis: "x" | "y", value: string): void {
    if (!value.trim()) return;
    const amount = Number(value);
    if (Number.isFinite(amount)) patch({ [axis]: amount });
  }

  async function finish(save: boolean): Promise<void> {
    if (ending) return;
    if (!sessionId) {
      onClose();
      return;
    }
    ending = true;
    draining = save;
    errorKey = null;
    try {
      if (save) {
        await hostUpdates;
        await canvas?.flush();
      }
      draining = false;
      await invoke("endRewardOverlayEdit", sessionId, save);
      sessionId = null;
      if (!destroyed) onClose();
    } catch {
      draining = false;
      if (destroyed && sessionId) {
        void invoke("endRewardOverlayEdit", sessionId, false).catch(() => {});
      } else if (!destroyed) {
        ending = false;
        errorKey = "rewardEditor.finishFailed";
      }
    }
  }

  onMount(() => void begin());
  onDestroy(() => {
    destroyed = true;
    unsubscribe?.();
    if (sessionId && !ending) {
      void invoke("endRewardOverlayEdit", sessionId, false).catch(() => {});
    }
  });
</script>

<ModalShell ariaLabel={$tr("rewardEditor.title")} onClose={() => void finish(false)}>
  <section
    data-reward-editor
    class="relative z-[1] flex max-h-[90vh] w-[1240px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-border-strong bg-bg-surface p-5"
  >
    <h2 class="m-0 font-display text-lg font-semibold text-text-primary">
      {$tr("rewardEditor.title")}
    </h2>
    <p class="mb-3 mt-1 text-sm text-text-secondary">{$tr("rewardEditor.hint")}</p>
    {#if errorKey}
      <p role="alert" class="mb-3 mt-0 text-sm text-danger">{$tr(errorKey)}</p>
    {/if}
    {#if editState}
      <fieldset disabled={ending} class="m-0 min-h-0 min-w-0 overflow-y-auto border-0 p-0">
        <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_250px]">
          <div class="min-w-0">
            <div
              class="overflow-hidden rounded-lg border border-border-strong bg-bg-deep"
              class:pointer-events-none={ending}
            >
              <RewardOverlayCanvas
                bind:this={canvas}
                state={editState}
                onCommand={update}
                onCancel={() => void finish(false)}
              />
            </div>
            <details data-reward-editor-elements class="mt-3 rounded-md border border-border">
              <summary class="cursor-pointer px-3 py-2 text-sm text-text-secondary">
                {$tr("rewardEditor.elements")}
              </summary>
              <div
                class="grid max-h-48 gap-1 overflow-y-auto border-t border-border p-2 sm:grid-cols-2 xl:grid-cols-3"
              >
                {#each REWARD_OVERLAY_FIELDS as field (field)}
                  {@const label = labels[field]}
                  <button
                    type="button"
                    data-reward-editor-field={field}
                    aria-pressed={selected === field}
                    class="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs {selected ===
                    field
                      ? 'bg-accent/15 text-accent'
                      : 'text-text-secondary hover:bg-bg-hover'}"
                    onclick={() => edit({ type: "select", field })}
                  >
                    <span>{$tr(label.key, label.number ? { number: label.number } : {})}</span>
                    {#if editState.layout.fields[field]?.hidden}
                      <span class="text-xs text-text-muted">{$tr("common.hidden")}</span>
                    {/if}
                  </button>
                {/each}
              </div>
            </details>
          </div>
          <div class="min-w-0 space-y-3 rounded-lg border border-border bg-bg-deep/30 p-3">
            <h3 class="m-0 text-sm font-semibold">
              {$tr(
                labels[selected].key,
                labels[selected].number ? { number: labels[selected].number ?? 1 } : {},
              )}
            </h3>
            <div class="grid grid-cols-2 gap-3">
              {#each ["x", "y"] as axis}
                <label class="grid gap-1 text-xs text-text-secondary">
                  {$tr(axis === "x" ? "rewardEditor.offsetX" : "rewardEditor.offsetY")}
                  <input
                    type="number"
                    data-reward-editor-position={axis}
                    value={axis === "x" ? style.x : style.y}
                    min={-(axis === "x"
                      ? REWARD_OVERLAY_CANVAS.width
                      : REWARD_OVERLAY_CANVAS.height)}
                    max={axis === "x" ? REWARD_OVERLAY_CANVAS.width : REWARD_OVERLAY_CANVAS.height}
                    step="1"
                    class="w-full rounded border border-border bg-bg-deep px-2 py-1.5 text-sm text-text-primary"
                    onchange={(event) =>
                      position(axis === "x" ? "x" : "y", event.currentTarget.value)}
                  />
                </label>
              {/each}
            </div>
            <label class="grid gap-1 text-sm text-text-secondary">
              <span class="flex justify-between gap-2">
                <span>{$tr("rewardEditor.elementScale")}</span>
                <span>{Math.round(style.scale * 100)}%</span>
              </span>
              <input
                type="range"
                data-reward-editor-scale
                min="0.5"
                max="3"
                step="0.05"
                value={style.scale}
                class="w-full accent-accent"
                oninput={(event) => patch({ scale: Number(event.currentTarget.value) })}
              />
            </label>
            <div class="flex flex-wrap items-center gap-2">
              <label class="flex items-center gap-2 text-sm text-text-secondary">
                {$tr("rewardEditor.color")}
                <input
                  type="color"
                  data-reward-editor-color
                  value={style.color ?? "#ffffff"}
                  class="h-8 w-10 cursor-pointer rounded border border-border bg-transparent p-0.5"
                  oninput={(event) => patch({ color: event.currentTarget.value })}
                />
              </label>
              <button
                type="button"
                class="btn-secondary btn-sm"
                data-reward-editor-default-color
                disabled={style.color === null}
                onclick={() => patch({ color: null })}>{$tr("common.default")}</button
              >
            </div>
            <label class="flex items-center gap-2 text-sm text-text-secondary">
              <input
                type="checkbox"
                data-reward-editor-hidden
                checked={style.hidden}
                onchange={(event) => patch({ hidden: event.currentTarget.checked })}
              />
              {$tr("common.hidden")}
            </label>
            <button
              type="button"
              data-reward-editor-reset-field
              class="btn-secondary btn-sm"
              onclick={() => edit({ type: "reset", field: selected })}
              >{$tr("rewardEditor.resetElement")}</button
            >
            <div class="border-t border-border pt-3">
              <label class="grid gap-1 text-sm text-text-secondary">
                <span class="flex justify-between gap-2">
                  <span>{$tr("settings.overlayScaleReward")}</span>
                  <span>{Math.round(editState.scale * 100)}%</span>
                </span>
                <input
                  type="range"
                  data-reward-editor-window-scale
                  min="0.75"
                  max="1.5"
                  step="0.05"
                  value={editState.scale}
                  class="w-full accent-accent"
                  oninput={(event) =>
                    edit({ type: "scale", scale: Number(event.currentTarget.value) })}
                />
              </label>
            </div>
          </div>
        </div>
        <div class="mt-4 flex flex-wrap items-end gap-3 border-t border-border pt-3">
          <label class="grid flex-1 gap-1 text-xs text-text-secondary">
            {$tr("rewardEditor.preview")}
            <select
              data-reward-editor-preview
              value={editState.previewVariant}
              class="rounded border border-border bg-bg-deep px-2 py-1.5 text-sm text-text-primary"
              onchange={(event) => {
                const variant = variants.find(
                  (entry) => entry.value === event.currentTarget.value,
                )?.value;
                if (variant && editState)
                  edit({ type: "preview", count: editState.previewCount, variant });
              }}
            >
              {#each variants as variant}
                <option value={variant.value}>{$tr(variant.key)}</option>
              {/each}
            </select>
          </label>
          <label class="grid gap-1 text-xs text-text-secondary">
            {$tr("rewardEditor.choices")}
            <select
              data-reward-editor-count
              value={editState.previewCount}
              class="rounded border border-border bg-bg-deep px-2 py-1.5 text-sm text-text-primary"
              onchange={(event) => {
                const count = previewCounts.find(
                  (value) => value === Number(event.currentTarget.value),
                );
                if (count && editState)
                  edit({ type: "preview", count, variant: editState.previewVariant });
              }}
            >
              {#each previewCounts as count}<option value={count}>{count}</option>{/each}
            </select>
          </label>
        </div>
      </fieldset>
    {:else if !errorKey}
      <p class="text-sm text-text-secondary">{$tr("common.loading")}</p>
    {/if}
    <div class="mt-4 flex flex-wrap justify-between gap-2 border-t border-border pt-3">
      <button
        type="button"
        class="btn-secondary btn-sm"
        data-reward-editor-reset
        disabled={!editState || ending}
        onclick={() => edit({ type: "reset" })}>{$tr("rewardEditor.resetAll")}</button
      >
      <div class="flex gap-2">
        <button
          type="button"
          class="btn-secondary btn-sm"
          data-reward-editor-cancel
          disabled={ending}
          onclick={() => void finish(false)}>{$tr("common.cancel")}</button
        >
        <button
          type="button"
          class="btn-primary btn-sm"
          data-reward-editor-save
          disabled={!editState || ending}
          onclick={() => void finish(true)}>{$tr("common.save")}</button
        >
      </div>
    </div>
  </section>
</ModalShell>
