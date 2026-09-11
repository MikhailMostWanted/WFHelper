<script lang="ts">
  import ModalShell from "../ModalShell.svelte";
  import { tr } from "../../lib/i18n.js";
  import { invoke, tradeInvoke } from "../../lib/ipc.js";
  import { fetchItemOrderBookBySlug } from "../../lib/wfm/orderBook.js";
  import { loadQueueMarketData } from "../../lib/tradeWorkbench/queueModel.js";
  import { STRATEGY_KEYS } from "../../lib/tradeWorkbench/strategyLabels.js";
  import {
    WORKBENCH_STRATEGY_IDS,
    type StrategyConfig,
    type WorkbenchStrategyId,
  } from "../../lib/tradeWorkbench/pricingStrategies.js";
  import {
    buildRepriceRows,
    priceRepriceRow,
    repriceRowsToSend,
    repriceTotals,
    runReprice,
    type RepriceRow,
    type RepriceSkipReason,
  } from "../../lib/market/repriceOrders.js";
  import type { MessageKey } from "../../lib/i18n.js";
  import type { WfmOrder } from "../../types/market.js";

  let {
    orders,
    onClose,
    onApplied,
  }: {
    orders: WfmOrder[];
    onClose: () => void;
    onApplied: (updates: Array<{ id: string; platinum: number }>) => void;
  } = $props();

  let ownUserName = $state<string | null>(null);
  $effect(() => {
    void invoke("wfmGetSession").then((session) => {
      ownUserName = session.loggedIn ? session.userName : null;
    });
  });

  const SKIP_KEYS: Record<RepriceSkipReason, MessageKey> = {
    "no-book": "market.reprice.skip.noBook",
    "no-price": "market.reprice.skip.noPrice",
    unchanged: "market.reprice.skip.unchanged",
    "not-sell": "market.reprice.skip.notSell",
  };

  const FIELD =
    "rounded-[var(--radius-md)] border border-[color:var(--ui-control-border)] " +
    "bg-[var(--ui-control-bg)] px-2 py-1 text-sm text-text-primary";

  // "manual" has no per-row price field here, so it can never decide a price.
  const STRATEGIES = WORKBENCH_STRATEGY_IDS.filter((id) => id !== "manual");

  // svelte-ignore state_referenced_locally
  let rows = $state<RepriceRow[]>(buildRepriceRows(orders));
  let strategyId = $state<WorkbenchStrategyId>("cheapest-minus-one");
  let percentOffset = $state(-5);
  let averageCount = $state(3);
  let averageThreshold = $state(30);
  let loading = $state(false);
  let loaded = $state(0);
  let loadTotal = $state(0);
  let applying = $state(false);
  let applied = $state(0);
  let failures = $state<string[]>([]);
  let stoppedAuth = $state(false);
  let cancelled = false;

  const strategyConfig = $derived.by<StrategyConfig>(() => {
    if (strategyId === "percent-offset") return { id: "percent-offset", percent: percentOffset };
    if (strategyId === "bounded-cheapest-average") {
      return {
        id: "bounded-cheapest-average",
        count: averageCount,
        thresholdPercent: averageThreshold,
      };
    }
    if (strategyId === "target-margin")
      return { id: "target-margin", costPlat: 0, marginPercent: 0 };
    return { id: strategyId } as StrategyConfig;
  });

  const totals = $derived(repriceTotals(rows));
  const priced = $derived(rows.some((row) => row.sellBook !== null));

  function reprice(): void {
    rows = rows.map((row) => priceRepriceRow(row, strategyConfig, ownUserName));
  }

  async function loadBooks(): Promise<void> {
    if (loading) return;
    const pending = rows.filter((row) => row.sellBook === null);
    if (pending.length === 0) return;
    loading = true;
    loaded = 0;
    loadTotal = pending.length;
    cancelled = false;
    try {
      await loadQueueMarketData(pending, {
        isCancelled: () => cancelled,
        fetchBook: async (row) => {
          const result = await fetchItemOrderBookBySlug(row.slug, {
            rank: row.rank,
            subtype: row.subtype,
            priority: "background",
          });
          return result.status === "ok" ? { sell: result.data.sell, buy: result.data.buy } : null;
        },
        onRow: (row, book) => {
          loaded += 1;
          const index = rows.findIndex((entry) => entry.rowId === row.rowId);
          if (index < 0) return;
          const next = { ...rows[index], sellBook: book?.sell ?? null };
          rows[index] = priceRepriceRow(next, strategyConfig, ownUserName);
        },
      });
    } finally {
      loading = false;
    }
  }

  async function apply(): Promise<void> {
    const sending = repriceRowsToSend(rows);
    if (sending.length === 0 || applying) return;
    applying = true;
    applied = 0;
    failures = [];
    stoppedAuth = false;
    cancelled = false;
    try {
      const result = await runReprice(sending, {
        updateOrder: (row, platinum) =>
          tradeInvoke("wfmUpdateOrder", row.order.id, {
            platinum,
            quantity: row.order.quantity,
          }),
        isCancelled: () => cancelled,
        isSignedOut: async () => !(await invoke("wfmGetSession")).loggedIn,
        onProgress: (done, failed) => {
          applied = done;
          failures = [...failed];
        },
      });
      stoppedAuth = result.stopReason === "auth";
      // Applied even when the modal closed mid-run; those listings did change price.
      if (result.applied.length > 0) onApplied(result.applied);
    } finally {
      applying = false;
    }
  }

  function close(): void {
    cancelled = true;
    onClose();
  }
</script>

<ModalShell ariaLabel={$tr("market.reprice.title")} onClose={close}>
  <div
    class="detail-panel flex max-h-[88vh] w-[900px] max-w-[95vw] flex-col overflow-hidden"
    data-reprice-modal
  >
    <header class="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
      <h2 class="m-0 font-display text-xl font-bold text-text-primary">
        {$tr("market.reprice.title")}
      </h2>
      <button class="btn-sm btn-secondary" onclick={close}>{$tr("common.close")}</button>
    </header>

    <div class="flex flex-wrap items-end gap-3 border-b border-border px-4 py-3">
      <label class="flex flex-col gap-1 text-xs text-text-secondary">
        {$tr("workbench.strategyLabel")}
        <select class="{FIELD} w-52" data-reprice-strategy bind:value={strategyId}>
          {#each STRATEGIES as id (id)}
            <option value={id}>{$tr(STRATEGY_KEYS[id])}</option>
          {/each}
        </select>
      </label>
      {#if strategyId === "percent-offset"}
        <label class="flex flex-col gap-1 text-xs text-text-secondary">
          {$tr("workbench.strategy.percentLabel")}
          <input class="{FIELD} w-20" type="number" bind:value={percentOffset} />
        </label>
      {:else if strategyId === "bounded-cheapest-average"}
        <label class="flex flex-col gap-1 text-xs text-text-secondary">
          {$tr("workbench.strategy.countLabel")}
          <input class="{FIELD} w-20" type="number" min="1" bind:value={averageCount} />
        </label>
        <label class="flex flex-col gap-1 text-xs text-text-secondary">
          {$tr("workbench.strategy.thresholdLabel")}
          <input class="{FIELD} w-20" type="number" min="0" bind:value={averageThreshold} />
        </label>
      {/if}
      <button
        class="btn-secondary btn-sm"
        data-reprice-load
        disabled={loading || applying}
        onclick={() => void loadBooks()}
      >
        {loading
          ? $tr("market.reprice.loading", { done: String(loaded), total: String(loadTotal) })
          : $tr("market.reprice.loadPrices")}
      </button>
      {#if priced}
        <button class="btn-secondary btn-sm" disabled={loading || applying} onclick={reprice}>
          {$tr("workbench.applyStrategy")}
        </button>
      {/if}
    </div>

    <div class="min-h-0 flex-1 overflow-auto px-4 py-3">
      <div class="text-sm" data-reprice-table>
        <div
          class="grid grid-cols-[1fr_5rem_5rem_12rem] gap-2 pb-1 text-xs uppercase
                 tracking-[0.06em] text-text-muted"
        >
          <span>{$tr("common.item")}</span>
          <span class="text-right">{$tr("market.reprice.current")}</span>
          <span class="text-right">{$tr("market.reprice.next")}</span>
          <span>{$tr("common.details")}</span>
        </div>
        {#each rows as row (row.rowId)}
          <div
            class="grid grid-cols-[1fr_5rem_5rem_12rem] gap-2 border-t border-border py-1"
            data-reprice-row={row.rowId}
          >
            <span class="truncate">{row.label}</span>
            <span class="text-right tabular-nums">{row.currentPrice}</span>
            <span class="text-right tabular-nums">
              {row.nextPrice === null ? "-" : row.nextPrice}
            </span>
            <span class="text-xs text-text-muted">
              {row.skipReason ? $tr(SKIP_KEYS[row.skipReason]) : ""}
            </span>
          </div>
        {/each}
      </div>
    </div>

    <footer class="flex flex-wrap items-center gap-3 border-t border-border px-4 py-3">
      <span class="text-xs text-text-secondary" data-reprice-summary>
        {$tr("market.reprice.summary", {
          sending: String(totals.sending),
          raised: String(totals.raised),
          lowered: String(totals.lowered),
        })}
      </span>
      {#if failures.length > 0}
        <span class="text-xs text-danger">
          {$tr("market.reprice.failed", { count: String(failures.length) })}
        </span>
      {/if}
      {#if stoppedAuth}
        <span class="text-xs text-danger" data-reprice-stopped>
          {$tr("market.reprice.stoppedAuth")}
        </span>
      {/if}
      <button
        class="btn-primary btn-sm ml-auto"
        data-reprice-apply
        disabled={totals.sending === 0 || applying || loading}
        onclick={() => void apply()}
      >
        {applying
          ? $tr("market.reprice.applying", {
              done: String(applied),
              total: String(totals.sending),
            })
          : $tr("market.reprice.apply", { count: String(totals.sending) })}
      </button>
    </footer>
  </div>
</ModalShell>
