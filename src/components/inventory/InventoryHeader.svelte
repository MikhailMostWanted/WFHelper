<script lang="ts">
  import { createEventDispatcher, onMount } from "svelte";

  import HeaderTabs from "../HeaderTabs.svelte";
  import SharedFilterBar from "../SharedFilterBar.svelte";
  import DocsLink from "../DocsLink.svelte";
  import { tr } from "../../lib/i18n.js";
  import type { MessageKey } from "../../lib/i18n.js";
  import type { InventoryFilterTab } from "../../lib/inventoryMarket.js";
  import type { SharedSortKey } from "../../types/filters.js";

  export let totalCount = 0;
  export let filters: Array<{ key: InventoryFilterTab; labelKey: MessageKey }> = [];
  export let activeFilter: InventoryFilterTab = "all_parts";
  export let showFilterPanel = false;
  export let sortOptions: Array<[SharedSortKey, string]> | null = null;
  export let advancedCount = 0;
  export let filtersEnabled = true;
  export let basicFiltersEnabled = true;
  export let selectionMode = false;
  export let selectionEnabled = true;
  export let onToggleSelectionMode: () => void = () => {};
  export let marketPriceSide: "wtb" | "wts" = "wtb";
  export let onMarketPriceSideChange: (side: "wtb" | "wts") => void = () => {};

  const dispatch = createEventDispatcher<{
    filter: InventoryFilterTab;
    toggle: void;
  }>();

  function selectFilter(value: InventoryFilterTab): void {
    dispatch("filter", value);
  }

  function toggleFilters(): void {
    dispatch("toggle");
  }

  $: tabOptions = filters.map((entry) => ({ key: entry.key, label: $tr(entry.labelKey) }));

  function handleTabSelect(value: string): void {
    selectFilter(value as InventoryFilterTab);
  }

  let stickyEl: HTMLDivElement | null = null;

  // The order-book panel is sticky in the same scroll container and has to pin
  // below this band, which is opaque and sits above it. The band grows with the
  // tab rows, the value strip and the filter popover, so publish the measured
  // height instead of hard-coding one.
  onMount(() => {
    const root = document.documentElement;
    const publish = (): void => {
      root.style.setProperty("--inventory-sticky-height", `${stickyEl?.offsetHeight ?? 0}px`);
    };
    publish();
    const observer = new ResizeObserver(publish);
    if (stickyEl) observer.observe(stickyEl);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--inventory-sticky-height");
    };
  });
</script>

<!-- Keep the sticky row outside the scrolling heading. -->
<!-- The layout-edit button rides the title row; on its own row it leaves a band of dead space beside it. -->
<div class="inventory-heading">
  <h2>
    {$tr("inventory.title", { count: totalCount })}
  </h2>
  <div class="ml-auto flex items-center gap-2">
    <DocsLink page="inventory" />
    <slot name="actions" />
  </div>
</div>
<div class="view-sticky-filters inventory-workspace" bind:this={stickyEl}>
  <!-- The tab row will not shrink below its own labels, so the controls take the
       next row whole once they no longer fit beside it. A px breakpoint measured
       the window while the zoom factor decided what a tab costs, which on a
       rotated screen wrapped the tabs mid-row into a band of empty header. -->
  <div class="inventory-category-nav" data-tour="inventory-tabs">
    <div class="max-w-full shrink-0 grow">
      <HeaderTabs options={tabOptions} activeKey={activeFilter} onSelect={handleTabSelect} />
    </div>
  </div>
  <!-- Controls have their own row so the category navigation always stays readable. -->
  <div class="inventory-command-bar">
    <div
      class="inventory-price-side inline-flex min-h-8 overflow-hidden rounded border border-border"
      role="group"
      aria-label={$tr("common.platinum")}
    >
      <button
        type="button"
        class="filter-tab min-h-8 rounded-none border-0 px-2 py-0 text-xs"
        class:active={marketPriceSide === "wtb"}
        aria-pressed={marketPriceSide === "wtb"}
        title={$tr("orderbook.bestWtb")}
        on:click={() => onMarketPriceSideChange("wtb")}>WTB</button
      >
      <button
        type="button"
        class="filter-tab min-h-8 rounded-none border-0 border-l border-border px-2 py-0 text-xs"
        class:active={marketPriceSide === "wts"}
        aria-pressed={marketPriceSide === "wts"}
        title={$tr("orderbook.bestWts")}
        on:click={() => onMarketPriceSideChange("wts")}>WTS</button
      >
    </div>
    {#if basicFiltersEnabled}
      <SharedFilterBar
        scope="inventory"
        singleLine={true}
        showBasic={true}
        showAdvanced={false}
        basicVariant="quick"
        {sortOptions}
      />
    {/if}
    {#if selectionEnabled}
      <button
        class="filter-tab min-h-8 py-0 text-xs"
        class:active={selectionMode}
        aria-pressed={selectionMode}
        data-inventory-select-toggle
        title={$tr("inventory.selectModeHint")}
        on:click={onToggleSelectionMode}
      >
        {$tr("workbench.title")}
      </button>
    {/if}
    {#if filtersEnabled}
      <button
        class="filter-tab inline-flex min-h-8 items-center gap-1.5 pt-0 pb-0 [&_svg]:h-3.5 [&_svg]:w-3.5"
        data-advanced-filters-toggle
        class:active={showFilterPanel || advancedCount > 0}
        aria-expanded={showFilterPanel}
        title={advancedCount > 0
          ? advancedCount === 1
            ? $tr("inventory.advancedFilterActiveOne", { count: advancedCount })
            : $tr("inventory.advancedFilterActiveMany", { count: advancedCount })
          : $tr("inventory.advancedFilters")}
        on:click={toggleFilters}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 5h18" />
          <path d="M6 12h12" />
          <path d="M10 19h4" />
        </svg>
        {$tr("common.filters")}
        {#if advancedCount > 0}
          <span
            class="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[color:var(--accent)] px-1 text-[10px] font-bold leading-none text-bg-deep"
          >
            {advancedCount}
          </span>
        {/if}
      </button>
    {/if}
  </div>
  <slot />
</div>

<style>
  .inventory-heading {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 1.1rem;
  }
  .inventory-heading h2 {
    margin: 0;
    font-family: var(--font-display);
    font-size: clamp(1.7rem, 2.1vw, 2.3rem);
    font-weight: 650;
    line-height: 1.2;
    letter-spacing: -0.035em;
    color: var(--text-primary);
  }
  .inventory-workspace {
    margin-bottom: 1.1rem;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    background: var(--bg-surface);
    padding: 0.15rem 0.9rem 0.85rem;
  }
  .inventory-category-nav {
    min-width: 0;
    border-bottom: 1px solid var(--border-subtle);
    padding-top: 0.3rem;
  }
  .inventory-command-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.55rem;
    min-width: 0;
    padding-top: 0.85rem;
  }
  .inventory-command-bar :global(.shared-filter-bar) {
    flex: 1 1 20rem;
    min-width: min(100%, 16rem);
  }
  .inventory-command-bar :global(.filter-tab) {
    min-height: 2.2rem;
    font-size: 0.85rem;
  }
  .inventory-price-side {
    flex-shrink: 0;
    border-radius: var(--radius-md);
    background: var(--bg-deep);
  }
  .inventory-command-bar :global(button:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
  }
  @media (max-width: 720px) {
    .inventory-workspace {
      padding-inline: 0.65rem;
    }
    .inventory-command-bar :global(.shared-filter-bar) {
      order: -1;
      flex-basis: 100%;
    }
  }
</style>
