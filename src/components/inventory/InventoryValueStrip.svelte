<script lang="ts">
  import { PLATINUM_ICON_URL, STAT_ICON_URLS } from "../../lib/assetUrls.js";
  import { locale, tr, type Translator } from "../../lib/i18n.js";
  import {
    VALUE_MIN_PLATINUM_PRESETS,
    selectValueStripRows,
    type InventoryValueTotals,
  } from "../../lib/inventory/valueTotals.js";

  interface Props {
    /** Totals for the rows the tab, its chips and the filters currently show. */
    inView: InventoryValueTotals;
    /** Totals for the whole inventory in the same valuation scope. */
    inventory: InventoryValueTotals;
    allTradables: boolean;
    onSelectScope: (allTradables: boolean) => void;
    /** Per-unit platinum floor applied to both figures; 0 is off. */
    minPlatinum: number;
    onSelectMinPlatinum: (minPlatinum: number) => void;
  }

  let { inView, inventory, allTradables, onSelectScope, minPlatinum, onSelectMinPlatinum }: Props =
    $props();

  const PLAT_ICON = PLATINUM_ICON_URL;
  const DUCAT_ICON = STAT_ICON_URLS.ducatsDelta;

  const rows = $derived(
    selectValueStripRows(inView, inventory).map((key) => ({
      key,
      label:
        key === "inView" ? $tr("inventory.value.inView") : $tr("inventory.value.wholeInventory"),
      totals: key === "inView" ? inView : inventory,
    })),
  );

  // A hole means the real total is higher, so the figure reads as a floor. The
  // translator is a parameter because Svelte only tracks $tr where it is textual.
  function figure(value: number, unpriced: number, code: string, t: Translator): string {
    const amount = value.toLocaleString(code);
    return unpriced > 0 ? t("inventory.value.atLeast", { value: amount }) : amount;
  }

  function hasDucats(totals: InventoryValueTotals): boolean {
    return totals.ducats > 0 || totals.ducatsUnpriced > 0;
  }
</script>

{#if rows.length > 0}
  <div class="inventory-value-band" data-inventory-value-strip title={$tr("inventory.value.hint")}>
    <span class="value-band-label">
      {$tr("inventory.value.title")}
    </span>

    <div class="value-band-metrics">
      {#each rows as row, index (row.key)}
        <div class="value-metric" class:valueMetricPrimary={index === 0} data-value-scope={row.key}>
          <span class="value-metric-label">
            {row.label}
          </span>
          <span class="value-metric-figure" data-value-platinum>
            <img src={PLAT_ICON} alt="" class="h-3.5 w-3.5 shrink-0 self-center object-contain" />
            {figure(row.totals.platinum, row.totals.platinumUnpriced, $locale, $tr)}
          </span>
          {#if hasDucats(row.totals)}
            <span class="value-metric-figure value-metric-ducats" data-value-ducats>
              <img
                src={DUCAT_ICON}
                alt=""
                class="h-3.5 w-3.5 shrink-0 self-center object-contain"
              />
              {figure(row.totals.ducats, row.totals.ducatsUnpriced, $locale, $tr)}
            </span>
          {/if}
          {#if index === 0 && row.totals.unpriced > 0}
            <span class="value-metric-note" data-value-unpriced>
              {$tr("inventory.value.unpriced", { count: row.totals.unpriced })}
            </span>
          {/if}
        </div>
      {/each}
    </div>

    <div class="value-band-controls">
      <div
        class="filter-tabs"
        data-value-scope-toggle
        role="group"
        aria-label={$tr("inventory.value.title")}
      >
        <button
          type="button"
          class="filter-tab min-h-7 py-0 text-xs"
          class:active={!allTradables}
          aria-pressed={!allTradables}
          data-value-scope-option="prime"
          title={$tr("inventory.value.scopePrimeHint")}
          onclick={() => onSelectScope(false)}
        >
          {$tr("inventory.value.scopePrime")}
        </button>
        <button
          type="button"
          class="filter-tab min-h-7 py-0 text-xs"
          class:active={allTradables}
          aria-pressed={allTradables}
          data-value-scope-option="tradable"
          title={$tr("inventory.value.allTradablesHint")}
          onclick={() => onSelectScope(true)}
        >
          {$tr("inventory.value.allTradables")}
        </button>
      </div>

      <!-- The title sits on the group so all four buttons show it; browsers walk
         up to the nearest titled ancestor. -->
      <div
        class="filter-tabs"
        data-value-min-plat-toggle
        title={$tr("inventory.value.minPlatHint")}
        role="group"
        aria-label={$tr("inventory.value.minPlatHint")}
      >
        <img
          src={PLAT_ICON}
          alt=""
          class="h-3.5 w-3.5 shrink-0 self-center object-contain opacity-70"
        />
        {#each VALUE_MIN_PLATINUM_PRESETS as preset (preset)}
          <button
            type="button"
            class="filter-tab min-h-7 py-0 text-xs"
            class:active={minPlatinum === preset}
            aria-pressed={minPlatinum === preset}
            aria-label={preset === 0
              ? $tr("inventory.value.minPlatOff")
              : $tr("inventory.value.minPlatOption", { value: preset })}
            data-value-min-plat-option={preset}
            onclick={() => onSelectMinPlatinum(preset)}
          >
            {preset === 0
              ? $tr("inventory.value.minPlatOff")
              : `${preset.toLocaleString($locale)}+`}
          </button>
        {/each}
      </div>
    </div>
  </div>
{/if}

<style>
  .inventory-value-band {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.65rem 1.1rem;
    margin-top: 0.85rem;
    padding: 0.85rem 0.95rem;
    border: 1px solid color-mix(in oklab, var(--accent) 20%, var(--border-subtle));
    border-radius: var(--radius-md);
    background: linear-gradient(
      110deg,
      color-mix(in oklab, var(--accent) 6%, var(--bg-deep)),
      var(--bg-deep)
    );
  }
  .value-band-label {
    max-width: 9rem;
    font-family: var(--font-display);
    font-size: 0.8rem;
    font-weight: 600;
    line-height: 1.45;
    color: var(--text-secondary);
  }
  .value-band-metrics {
    display: flex;
    flex-wrap: wrap;
    gap: 0.65rem 1.2rem;
  }
  .value-metric {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.25rem 0.55rem;
    color: var(--text-secondary);
  }
  .value-metric-label {
    flex-basis: 100%;
    font-size: 0.76rem;
    font-weight: 500;
    color: var(--text-muted);
  }
  .value-metric-figure {
    display: inline-flex;
    align-items: baseline;
    gap: 0.3rem;
    font-family: var(--font-display);
    font-size: 1.05rem;
    font-weight: 650;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.02em;
  }
  .valueMetricPrimary .value-metric-figure {
    font-size: 1.25rem;
    color: var(--accent-bright);
  }
  .valueMetricPrimary .value-metric-ducats {
    color: var(--text-primary);
  }
  .value-metric-note {
    font-size: 0.75rem;
    color: var(--text-muted);
  }
  .value-band-controls {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.5rem;
    max-width: 34rem;
  }
  .value-band-controls :global(.filter-tab) {
    min-height: 2rem;
    font-size: 0.8rem;
  }
  .value-band-controls :global(button:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
  }
  @media (max-width: 1100px) {
    .inventory-value-band {
      grid-template-columns: auto minmax(0, 1fr);
    }
    .value-band-controls {
      grid-column: 1 / -1;
      max-width: none;
      justify-content: flex-start;
    }
  }
</style>
