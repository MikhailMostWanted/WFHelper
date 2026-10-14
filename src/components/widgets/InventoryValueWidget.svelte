<script lang="ts">
  import { tr } from "../../lib/i18n.js";
  import {
    buildBaseInventoryItems,
    buildInventoryViewItems,
    buildOrderLookups,
    type InventoryFilterTab,
  } from "../../lib/inventoryMarket.js";
  import {
    computeInventoryValueTotals,
    isCountedForValue,
    type InventoryValueScope,
  } from "../../lib/inventory/valueTotals.js";
  import { parsedItems, wfmItems } from "../../stores/data.js";
  import { dashboardLayout, settingBoolean, widgetSettings } from "../../stores/dashboard.js";
  import { getInventoryHydrationController } from "../../stores/inventoryHydration.js";
  import { marketOrders } from "../../stores/market.js";
  import { relicDb } from "../../stores/relics.js";
  import WidgetFrame from "./WidgetFrame.svelte";

  // Read-only view of the shared hydration controller: the Inventory tab owns
  // the queue, so nothing here enqueues work or touches the network.
  const hydrationMetrics = getInventoryHydrationController().metricsByKey;

  const settings = $derived(widgetSettings($dashboardLayout, "widget.inventoryValue"));
  const allTradables = $derived(settingBoolean(settings, "allTradables", false));
  const scope: InventoryValueScope = $derived(allTradables ? "tradable" : "prime");
  const sourceTab: InventoryFilterTab = $derived(allTradables ? "everything" : "all_parts");
  const lookups = $derived(buildOrderLookups($marketOrders));

  // Same pipeline as the Inventory value strip; the cheap base rows are gated
  // first so the priced rows are only built for what the totals actually count.
  const baseRows = $derived(
    buildBaseInventoryItems(
      $parsedItems,
      sourceTab,
      $wfmItems,
      lookups.orderedNames,
      lookups.orderedSlugs,
      $relicDb,
      lookups.orderedSubtypes,
    ).filter((item) => isCountedForValue(item, scope)),
  );
  const totals = $derived(
    computeInventoryValueTotals(buildInventoryViewItems(baseRows, $hydrationMetrics), scope),
  );
</script>

<WidgetFrame
  widgetId="widget.inventoryValue"
  empty={totals.counted === 0}
  emptyKey="app.noInventoryLoaded"
>
  {#snippet subtitle()}
    <p class="m-0 text-[0.68rem] uppercase tracking-[0.06em] text-text-muted" data-widget-status>
      {allTradables ? $tr("inventory.value.allTradables") : $tr("inventory.value.scopePrime")}
    </p>
  {/snippet}
  <dl class="inventory-worth m-0 grid grid-cols-2 gap-4">
    <div class="min-w-0">
      <dt class="text-[0.68rem] uppercase tracking-[0.06em] text-text-muted">
        {$tr("common.platinum")}
      </dt>
      <dd class="m-0 font-display tabular-nums text-text-primary">
        {totals.platinum.toLocaleString()}
      </dd>
    </div>
    <div class="min-w-0">
      <dt class="text-[0.68rem] uppercase tracking-[0.06em] text-text-muted">
        {$tr("common.ducats")}
      </dt>
      <dd class="m-0 font-display tabular-nums text-text-primary">
        {totals.ducats.toLocaleString()}
      </dd>
    </div>
  </dl>
  {#if totals.unpriced > 0}
    <p class="m-0 text-[0.68rem] text-text-muted">
      {$tr("inventory.value.unpriced", { count: String(totals.unpriced) })}
    </p>
  {/if}
</WidgetFrame>

<style>
  .inventory-worth {
    padding: 0.3rem 0 0.6rem;
  }
  .inventory-worth dt {
    font-size: 0.7rem;
    letter-spacing: 0.1em;
  }
  .inventory-worth dd {
    margin-top: 0.25rem;
    font-size: 2rem;
    font-weight: 500;
    line-height: 1.2;
    letter-spacing: -0.04em;
  }
  .inventory-worth > div:first-child dd {
    color: var(--accent);
  }
</style>
