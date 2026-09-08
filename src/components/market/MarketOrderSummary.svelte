<script lang="ts">
  import { tr } from "../../lib/i18n.js";

  export let isRankedListing = false;
  export let modVariant = false;
  export let summaryRank: number | null = null;
  export let wtsLabel = "-";
  export let wtbLabel = "-";
  export let medianLabel = "-";
</script>

<div class="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5 font-display">
  {#if modVariant || (isRankedListing && summaryRank != null)}
    <span class="market-summary-line">
      <small>WTS{summaryRank != null ? ` R${summaryRank}` : ""}</small>
      <strong>{wtsLabel}</strong>
    </span>
    <span class="market-summary-line">
      <small>WTB{summaryRank != null ? ` R${summaryRank}` : ""}</small>
      <strong>{wtbLabel}</strong>
    </span>
  {:else}
    <span class="market-summary-line">
      <small>{$tr("market.averageSale48h")}</small>
      <strong>{medianLabel}</strong>
    </span>
  {/if}
</div>

<style>
  .market-summary-line {
    display: inline-flex;
    align-items: baseline;
    gap: 0.22rem;
    min-width: 0;
  }
  .market-summary-line small {
    color: var(--text-secondary);
    font-size: 0.58rem;
    font-weight: 800;
    letter-spacing: 0.04em;
    line-height: 1;
    text-transform: uppercase;
  }
  .market-summary-line strong {
    color: var(--accent-bright);
    font-size: 0.8rem;
    line-height: 1;
  }
</style>
