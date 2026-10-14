<script lang="ts">
  import { showMasteredBadges, showOwnedParentBadges } from "../../stores/preferences.js";
  import { itemLabel } from "../../lib/itemLabel.js";
  import { createEventDispatcher, onDestroy, onMount } from "svelte";

  import ArchonShardPips from "../archon/ArchonShardPips.svelte";
  import ItemImage from "../ItemImage.svelte";
  import MarketMetricStrip from "../MarketMetricStrip.svelte";
  import { NAV_ICON_URLS } from "../../lib/assetUrls.js";
  import { archonShardsBySuit } from "../../stores/archonShards.js";
  import {
    inventorySafetyVerdicts,
    showsSafetyBadge,
    verdictFor,
  } from "../../stores/inventorySafety.js";
  import { itemMarksFor } from "../../lib/parentMastery.js";
  import { tr } from "../../lib/i18n.js";
  import type { InventoryViewItem } from "../../lib/inventoryMarket.js";
  import { isRankedGroup } from "../../../config/shared/numeric.js";

  export let item: InventoryViewItem;
  export let showDucats = true;
  export let canExpand = true;
  export let selectionMode = false;
  export let selected = false;
  /** False for rows the bulk-sell queue would reject; the box stays disabled. */
  export let selectable = true;

  const dispatch = createEventDispatcher<{
    select: InventoryViewItem;
    visible: InventoryViewItem;
    expand: InventoryViewItem;
    toggle: { item: InventoryViewItem; shiftKey: boolean };
  }>();
  let cardEl: HTMLDivElement | null = null;
  let visibilityObserver: IntersectionObserver | null = null;
  let visibilityReported = false;

  $: shardCopies = $archonShardsBySuit.get(item.uniqueName || item.internalName || "") ?? [];

  // Only a reserving verdict earns the badge; the owned count covers the rest.
  $: verdict = verdictFor(item, $inventorySafetyVerdicts);
  $: reservedVerdict = showsSafetyBadge(item, verdict) ? verdict : null;
  $: safeToSellTitle = reservedVerdict
    ? [
        $tr("inventory.safety.safeCount", { count: reservedVerdict.safe }),
        ...reservedVerdict.reservations.map((entry) => $tr(entry.reasonKey, entry.params)),
      ].join("\n")
    : "";

  $: marks = itemMarksFor(item);

  $: mastered = item.rank >= item.maxRank && item.maxRank > 1;
  $: canShowRank = item.maxRank > 1 && isRankedGroup(item.inventoryGroup);
  $: rankFillPct =
    canShowRank && item.maxRank > 0
      ? Math.max(0, Math.min(100, (item.rank / item.maxRank) * 100))
      : 0;

  $: showRankOrderSummary = isRankedGroup(item.inventoryGroup) && item.maxRank > 1;
  $: rankCapLabel = Number.isFinite(item.maxRank) ? Math.max(0, Math.floor(item.maxRank)) : 0;

  $: wtsRank0Label = item.wtsR0 != null ? `${item.wtsR0}p` : "-";
  $: wtbRank0Label = item.wtbR0 != null ? `${item.wtbR0}p` : "-";
  $: wtsRankMaxLabel = item.wtsRmax != null ? `${item.wtsRmax}p` : "-";
  $: wtbRankMaxLabel = item.wtbRmax != null ? `${item.wtbRmax}p` : "-";

  function selectCard(event: MouseEvent | KeyboardEvent): void {
    if (selectionMode) {
      if (selectable) dispatch("toggle", { item, shiftKey: event.shiftKey });
      return;
    }
    dispatch("select", item);
  }

  onMount(() => {
    if (!cardEl) return;

    visibilityObserver = new IntersectionObserver(
      (entries) => {
        if (visibilityReported) return;
        const entry = entries[0];
        if (!entry?.isIntersecting) return;

        visibilityReported = true;
        dispatch("visible", item);
        visibilityObserver?.disconnect();
        visibilityObserver = null;
      },
      {
        root: null,
        rootMargin: "160px 0px 240px 0px",
        threshold: 0.01,
      },
    );

    visibilityObserver.observe(cardEl);
  });

  onDestroy(() => {
    if (visibilityObserver) {
      visibilityObserver.disconnect();
      visibilityObserver = null;
    }
  });
</script>

<div
  data-inventory-card={item.internalName}
  class="item-card inventory-collection-card group relative {mastered
    ? 'border-success/25'
    : ''} {item.isPrime ? 'border-accent/30' : ''} {selectionMode && !selectable
    ? 'opacity-45'
    : ''} {selected ? 'outline outline-2 outline-offset-[-2px] outline-[color:var(--accent)]' : ''}"
  role="button"
  tabindex="0"
  aria-label={!selectionMode
    ? $tr("common.openDetailsFor", { name: itemLabel(item) })
    : selectable
      ? $tr("inventory.selectItem", { name: itemLabel(item) })
      : $tr("inventory.notSellableItem", { name: itemLabel(item) })}
  aria-pressed={selectionMode ? selected : undefined}
  aria-disabled={selectionMode && !selectable ? true : undefined}
  on:click={selectCard}
  on:keydown={(event) => {
    if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " "))
      return;
    event.preventDefault();
    selectCard(event);
  }}
  bind:this={cardEl}
>
  {#if selectionMode}
    <!-- Sits where the Details button would be, which selection mode hides. The
         card is the labelled control, so the box is state paint, not a second one. -->
    <input
      type="checkbox"
      class="absolute top-1.5 right-1.5 z-10"
      checked={selected}
      disabled={!selectable}
      data-inventory-select-item={item.internalName}
      title={selectable ? undefined : $tr("inventory.notSellable")}
      aria-hidden="true"
      tabindex="-1"
      on:click|stopPropagation={(event) => {
        if (selectable) dispatch("toggle", { item, shiftKey: event.shiftKey });
      }}
    />
  {:else if canExpand}
    <button
      type="button"
      class="expand-link absolute top-1.5 right-1.5 z-10 inline-flex items-center rounded border border-border bg-bg-deep/45 px-1.5 py-0.5 font-display text-xs font-semibold text-text-secondary opacity-0 transition-[opacity,color,border-color] duration-100 group-hover:opacity-100 hover:text-accent hover:border-accent-dim"
      title={$tr("inventory.openItemDetails")}
      aria-label={$tr("common.openDetailsFor", { name: itemLabel(item) })}
      on:click|stopPropagation={() => dispatch("expand", item)}
    >
      {$tr("common.details")}
    </button>
  {/if}
  <div class="item-img-wrap">
    <ItemImage
      src={item.displayImageUrl}
      fallbackSrc={item.imageUrl !== item.displayImageUrl ? item.imageUrl : null}
      alt={itemLabel(item)}
      auditKey={item.name}
      cls="inventory-art"
    />
    {#if item.vaulted || ($showMasteredBadges && marks.mastered) || ($showOwnedParentBadges && marks.crafted)}
      <span class="item-mark-row">
        {#if item.vaulted}<span class="vault-badge">V</span>{/if}
        {#if $showMasteredBadges && marks.mastered}<span
            class="item-mark item-mark--mastered"
            data-item-mark="mastered"
            title={$tr("common.mastered")}>M</span
          >{/if}
        {#if $showOwnedParentBadges && marks.crafted}<span
            class="item-mark item-mark--crafted"
            data-item-mark="crafted"
            title={$tr("common.parentItemOwned")}>C</span
          >{/if}
      </span>
    {/if}
    {#if shardCopies.length > 0}
      <!-- Absolute so a shardless card keeps exactly the same height. -->
      <span class="absolute bottom-1.5 left-1.5 flex flex-col items-start gap-0.5">
        {#each shardCopies as copy, copyIndex (copy.instanceId ?? copyIndex)}
          <ArchonShardPips
            slots={copy.slots}
            size="lg"
            title={copy.filled === 1
              ? $tr("archon.shardCountOne", { count: copy.filled })
              : $tr("archon.shardCount", { count: copy.filled })}
          />
        {/each}
      </span>
    {/if}
    {#if item.orderPlaced}
      <span
        class="absolute top-1.5 left-1.5 inline-flex items-center justify-center rounded-full border border-border bg-bg-deep/50 p-1"
        title={$tr("inventory.listedOnWfm")}
      >
        <img src={NAV_ICON_URLS.market} alt={$tr("inventory.listedOnWfm")} class="h-3 w-3" />
      </span>
    {/if}
    {#if item.inventoryGroup === "incomplete_sets"}
      <span
        class="absolute right-2 bottom-1.5 font-display text-base font-bold text-info drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]"
        >{item.ownedPartTypes ?? 0}/{item.totalPartTypes ?? 0}</span
      >
    {:else}
      <span
        class="absolute right-2 bottom-1.5 font-display text-base font-bold text-success drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]"
        >x{item.amount}{#if reservedVerdict}<span
            class="ml-1 text-sm text-warning"
            data-safe-to-sell={reservedVerdict.safe}
            title={safeToSellTitle}>({reservedVerdict.safe})</span
          >{/if}</span
      >
    {/if}
  </div>
  <div class="item-body">
    <span class="item-name">{itemLabel(item)}</span>
    <span class="item-type">
      {item.categoryLabel}
      {#if item.inventoryGroup === "full_sets"}
        {$tr("inventory.completeCount", {
          count: typeof item.completeSets === "number" ? item.completeSets : 0,
        })}
      {:else if item.inventoryGroup === "incomplete_sets"}
        {typeof item.missingParts === "number" && item.missingParts === 1
          ? $tr("inventory.needsPartsOne", { count: item.missingParts })
          : $tr("inventory.needsPartsMany", {
              count: typeof item.missingParts === "number" ? item.missingParts : 0,
            })}
      {/if}
    </span>

    <MarketMetricStrip
      platinum={item.platinum}
      ducats={item.ducats}
      ratio={item.ducatonator}
      {showDucats}
      className="mt-1"
    />

    {#if showRankOrderSummary}
      <div class="grid grid-cols-2 gap-1">
        <span
          class="inventory-rank-order-box grid gap-0.5 min-h-8 content-center border border-accent-bright/50 bg-accent/20 rounded-md py-1 px-1.5"
        >
          <span class="inventory-rank-order-label text-xs uppercase tracking-[0.04em] font-display"
            >{$tr("inventory.wtsRank", { rank: rankCapLabel })}</span
          >
          <strong>{wtsRankMaxLabel}</strong>
        </span>
        <span
          class="inventory-rank-order-box grid gap-0.5 min-h-8 content-center border border-accent-bright/50 bg-accent/20 rounded-md py-1 px-1.5"
        >
          <span class="inventory-rank-order-label text-xs uppercase tracking-[0.04em] font-display"
            >{$tr("inventory.wtbRank", { rank: rankCapLabel })}</span
          >
          <strong>{wtbRankMaxLabel}</strong>
        </span>
        <span
          class="inventory-rank-order-box grid gap-0.5 min-h-8 content-center border border-accent-bright/50 bg-accent/20 rounded-md py-1 px-1.5"
        >
          <span class="inventory-rank-order-label text-xs uppercase tracking-[0.04em] font-display"
            >{$tr("inventory.wtsR0")}</span
          >
          <strong>{wtsRank0Label}</strong>
        </span>
        <span
          class="inventory-rank-order-box grid gap-0.5 min-h-8 content-center border border-accent-bright/50 bg-accent/20 rounded-md py-1 px-1.5"
        >
          <span class="inventory-rank-order-label text-xs uppercase tracking-[0.04em] font-display"
            >{$tr("inventory.wtbR0")}</span
          >
          <strong>{wtbRank0Label}</strong>
        </span>
      </div>
    {/if}

    {#if canShowRank}
      <div class="item-rank-bar">
        <svg class="rank-bar-svg" viewBox="0 0 100 4" preserveAspectRatio="none" aria-hidden="true">
          <rect
            class="rank-fill-svg"
            class:max={mastered}
            class:partial={!mastered}
            x="0"
            y="0"
            width={rankFillPct}
            height="4"
            rx="2"
            ry="2"
          ></rect>
        </svg>
      </div>
      <span class="item-rank-text">{item.rank}/{item.maxRank}</span>
    {/if}

    {#if item.equippedSummary}
      <span class="text-xs text-success whitespace-nowrap overflow-hidden text-ellipsis"
        >{item.equippedSummary}</span
      >
    {/if}
  </div>
</div>

<style>
  .inventory-collection-card {
    display: grid;
    grid-template-columns: 6.8rem minmax(0, 1fr);
    min-width: 0;
    min-height: 11rem;
    overflow: hidden;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    background: var(--bg-surface);
    box-shadow: 0 2px 12px color-mix(in oklab, var(--bg-deep) 35%, transparent);
    transition:
      border-color 150ms ease,
      background 150ms ease,
      box-shadow 150ms ease;
  }
  .inventory-collection-card:hover {
    border-color: color-mix(in oklab, var(--accent) 45%, var(--border-subtle));
    background: var(--bg-raised);
    box-shadow: 0 5px 20px color-mix(in oklab, var(--bg-deep) 50%, transparent);
  }
  .inventory-collection-card:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
  }
  .inventory-collection-card:focus-within .expand-link {
    opacity: 1;
  }
  .item-img-wrap {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: auto;
    height: auto;
    min-height: 100%;
    padding: 2.3rem 0.45rem 2.2rem;
    overflow: hidden;
    border-right: 1px solid var(--border-subtle);
    background: radial-gradient(
      ellipse at 50% 45%,
      color-mix(in oklab, var(--accent) 8%, var(--bg-soft)),
      var(--bg-deep)
    );
  }
  .item-img-wrap :global(.inventory-art) {
    width: auto;
    height: auto;
    max-width: 5.8rem;
    max-height: 8rem;
    object-fit: contain;
    filter: drop-shadow(0 5px 10px color-mix(in oklab, var(--bg-deep) 65%, transparent));
  }
  .item-body {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    min-width: 0;
    padding: 1rem 0.9rem 0.85rem;
  }
  .item-name {
    font-family: var(--font-display);
    font-size: 1.02rem;
    font-weight: 650;
    line-height: 1.35;
    letter-spacing: -0.018em;
    color: var(--text-primary);
    white-space: normal;
    overflow-wrap: anywhere;
  }
  .item-type {
    font-size: 0.8rem;
    line-height: 1.4;
    color: var(--text-muted);
  }
  .inventory-rank-order-box {
    min-height: 2.25rem;
    padding: 0.4rem 0.45rem;
    border-color: var(--border-subtle);
    border-radius: var(--radius-sm);
    background: var(--bg-deep);
  }
  .inventory-rank-order-label {
    font-size: 0.74rem;
    font-weight: 500;
    color: var(--text-muted);
  }
  .inventory-rank-order-box :global(strong) {
    font-family: var(--font-display);
    color: var(--accent-bright);
    font-size: 0.9rem;
    font-weight: 600;
    line-height: 1.25;
    letter-spacing: 0.01em;
  }
  .item-rank-bar {
    margin-top: auto;
  }
  .item-rank-text {
    font-size: 0.72rem;
    font-variant-numeric: tabular-nums;
    color: var(--text-muted);
  }
  .expand-link {
    top: 0.5rem;
    right: 0.5rem;
    min-height: 1.7rem;
    font-size: 0.72rem;
    background: var(--bg-deep);
  }
  @media (prefers-reduced-motion: reduce) {
    .inventory-collection-card {
      transition: none;
    }
  }
</style>
