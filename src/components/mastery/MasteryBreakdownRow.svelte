<script lang="ts">
  let {
    label,
    done,
    total,
    inProgress = 0,
    display,
    tone = "success",
  }: {
    label: string;
    done: number;
    total: number;
    inProgress?: number;
    display: "bars" | "rings";
    tone?: "success" | "info" | "accent";
  } = $props();

  const percent = $derived(total > 0 ? Math.max(0, Math.min(100, (done / total) * 100)) : 0);
  const progress = $derived(
    total > 0 ? Math.max(0, Math.min(100 - percent, (inProgress / total) * 100)) : 0,
  );
  const fill = $derived(
    tone === "info" ? "fill-info" : tone === "accent" ? "fill-accent" : "fill-success",
  );
</script>

<div
  class={display === "rings"
    ? "flex min-w-0 flex-col items-center gap-1.5 py-2 text-center"
    : "col-span-full grid grid-cols-subgrid items-center gap-x-3 gap-y-1.5"}
  data-mastery-breakdown-row={label}
  data-display={display}
>
  <span
    class={display === "rings"
      ? "min-w-0 text-sm font-semibold text-text-primary"
      : "min-w-0 text-xs text-text-secondary"}
    data-breakdown-category>{label}</span
  >
  <span class="whitespace-nowrap text-xs text-text-secondary tabular-nums" data-breakdown-count>
    {done}/{total}
    <small class:text-text-muted={display === "bars"} class:sr-only={display === "rings"}>
      ({percent.toFixed(1)}%)
    </small>
  </span>
  <div
    class={display === "rings" ? "order-first mb-1" : "col-span-2 min-w-0 sm:col-span-1"}
    data-breakdown-progress
  >
    {#if display === "rings"}
      <svg class="block h-20 w-20" viewBox="0 0 60 60" aria-hidden="true">
        <circle cx="30" cy="30" r="25" fill="none" class="stroke-surface-hover" stroke-width="4" />
        <circle
          cx="30"
          cy="30"
          r="25"
          fill="none"
          class="stroke-accent-blue"
          stroke-width="4"
          pathLength="100"
          stroke-dasharray="100"
          stroke-dashoffset={100 - percent}
          stroke-linecap="round"
          transform="rotate(-90 30 30)"
        />
        <text
          x="30"
          y="34"
          text-anchor="middle"
          class="fill-text-primary font-display text-[12px] font-bold">{percent.toFixed(1)}%</text
        >
      </svg>
    {:else}
      <svg
        class="block h-1.5 w-full overflow-hidden rounded-full bg-surface-hover"
        viewBox="0 0 100 1"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <rect class={fill} x="0" y="0" width={percent} height="1" />
        <rect class="fill-warning opacity-60" x={percent} y="0" width={progress} height="1" />
      </svg>
    {/if}
  </div>
</div>
