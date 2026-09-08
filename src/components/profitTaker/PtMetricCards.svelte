<script lang="ts">
  import { tr } from "../../lib/i18n.js";
  import { formatPtSeconds, PT_METRIC_KEYS, type PtMetric } from "../../lib/profitTakerStats.js";

  let {
    rows,
    mode = "run",
  }: {
    rows: readonly {
      metric: PtMetric;
      value: number | null;
      detail?: { text: string; good: boolean } | null;
      delta?: { seconds: number; percent: number | null } | null;
    }[];
    mode?: "run" | "mean";
  } = $props();
  const accents: Record<PtMetric, string> = {
    total: "bg-info/15 text-info",
    flight: "bg-warning/15 text-warning",
    shield: "bg-accent/15 text-accent",
    leg: "bg-success/15 text-success",
    body: "bg-danger/15 text-danger",
    pylon: "bg-text-secondary/15 text-text-secondary",
  };
</script>

<div class="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6" data-pt-metric-cards>
  {#each rows as row (row.metric)}
    <section
      class="min-w-0 rounded-xl border border-border bg-bg-surface p-4"
      data-pt-stat={row.metric}
    >
      <div class="mb-4 flex items-center gap-2.5">
        <span
          class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl {accents[
            row.metric
          ]}"
        >
          <svg
            viewBox="0 0 24 24"
            class="h-6 w-6"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            {#if row.metric === "total"}<circle cx="12" cy="12" r="9" /><path d="M12 6v6l4 2" />
            {:else if row.metric === "flight"}<path
                d="m12 3 2 7 7 4v2l-8-2v5l3 2H8l3-2v-5l-8 2v-2l7-4z"
              />
            {:else if row.metric === "shield"}<path d="m12 3 8 3v6c0 4-4 7-8 9-4-2-8-5-8-9V6z" />
            {:else if row.metric === "leg"}<path d="M5 4v10h8l4 6M9 4v6h7l5 7M3 20h7" />
            {:else if row.metric === "body"}<circle cx="12" cy="12" r="7" /><circle
                cx="12"
                cy="12"
                r="2"
              /><path d="M12 1v4m0 14v4M1 12h4m14 0h4" />
            {:else}<circle cx="12" cy="5" r="3" /><circle cx="5" cy="18" r="3" /><circle
                cx="19"
                cy="18"
                r="3"
              /><path d="m10 8-3 6m7-6 3 6M8 18h8" />{/if}
          </svg>
        </span>
        <h3 class="m-0 text-sm font-semibold leading-tight text-text-secondary">
          {$tr(PT_METRIC_KEYS[row.metric])}
        </h3>
      </div>
      <div
        class="whitespace-nowrap font-display text-[1.8rem] font-bold leading-none text-text-primary"
      >
        <span
          data-pt-stat-value={row.metric}
          data-pt-mean={mode === "mean" ? row.metric : undefined}>{formatPtSeconds(row.value)}</span
        ><span class="ml-0.5 text-sm font-normal text-text-muted">s</span>
      </div>
      {#if row.detail}<p
          class="mb-0 mt-2 text-xs {row.detail.good ? 'text-success' : 'text-text-muted'}"
        >
          {row.detail.text}
        </p>{/if}
      {#if row.delta}
        <p
          data-pt-delta={row.metric}
          class="mb-0 mt-2 text-xs font-semibold {row.delta.seconds < 0
            ? 'text-success'
            : row.delta.seconds > 0
              ? 'text-warning'
              : 'text-text-muted'}"
        >
          {row.delta.seconds >= 0 ? "+" : ""}{row.delta.seconds.toFixed(3)}s
          {#if row.delta.percent !== null}
            ({row.delta.percent >= 0 ? "+" : ""}{row.delta.percent.toFixed(1)}%)
          {/if}
        </p>
      {/if}
    </section>
  {/each}
</div>
