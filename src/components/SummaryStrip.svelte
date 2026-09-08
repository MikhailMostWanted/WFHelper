<script context="module" lang="ts">
  export type SummaryStripItem = {
    key: string;
    label: string;
    value: string | number;
    tone?: "default" | "success" | "warning" | "danger";
    icon?: string | null;
    subtext?: string;
    subtextTone?: "default" | "success" | "warning" | "danger";
  };
</script>

<script lang="ts">
  import ThemedPanel from "./ThemedPanel.svelte";

  export let items: SummaryStripItem[] = [];
  export let variant: "stats" | "mastery" | "grid" = "stats";

  function toneClass(tone: SummaryStripItem["tone"]): string {
    if (tone === "success") return "text-success";
    if (tone === "warning") return "text-warning";
    if (tone === "danger") return "text-danger";
    return "text-text-primary";
  }

  function subtextToneClass(tone: SummaryStripItem["subtextTone"]): string {
    return tone && tone !== "default" ? toneClass(tone) : "text-text-secondary";
  }
</script>

<ThemedPanel
  className={variant === "mastery"
    ? "w-fit max-w-full min-w-0 px-7 py-5"
    : variant === "grid"
      ? "px-2 py-4"
      : "flex flex-wrap items-stretch gap-y-2 px-4 py-3"}
>
  <div
    class={variant === "grid"
      ? "grid overflow-hidden [grid-template-columns:repeat(auto-fit,minmax(min(100%,12rem),1fr))] gap-y-4"
      : variant === "mastery"
        ? "flex flex-wrap items-stretch gap-y-4 overflow-hidden"
        : "contents"}
    data-summary-strip={variant}
  >
    {#each items as item, index (item.key)}
      {#if index > 0 && variant === "stats"}
        <span class="self-stretch w-px bg-[color:var(--ui-panel-border)]" aria-hidden="true"></span>
      {/if}

      {#if variant === "grid"}
        <!-- The grid clips separators at the start of each wrapped row. -->
        <div
          class="relative flex min-w-0 flex-col gap-1.5 px-6 text-center before:absolute before:-left-px before:top-0 before:h-full before:w-px before:bg-[color:var(--ui-panel-border)] after:absolute after:-top-2 after:left-0 after:h-px after:w-full after:bg-[color:var(--ui-panel-border)]"
          data-summary-item={item.key}
        >
          <span class="text-xs font-semibold uppercase tracking-wide text-text-muted">
            {item.label}
          </span>
          <span
            class="font-display [overflow-wrap:anywhere] text-3xl font-bold leading-none {toneClass(
              item.tone,
            )}"
          >
            {item.value}
          </span>
          {#if item.subtext}
            <span class="text-xs font-semibold {subtextToneClass(item.subtextTone)}"
              >{item.subtext}</span
            >
          {/if}
        </div>
      {:else if variant === "mastery"}
        <div
          class="relative flex flex-col justify-center gap-1 px-6 before:absolute before:-left-px before:top-0 before:h-full before:w-px before:bg-[color:var(--ui-panel-border)]"
          data-summary-item={item.key}
        >
          <div class="flex items-center gap-4">
            <span class="font-display text-5xl font-bold leading-none {toneClass(item.tone)}"
              >{item.value}</span
            >
            <span class="text-2xl font-semibold text-text-secondary">{item.label}</span>
          </div>
          {#if item.subtext}
            <span class="text-lg font-semibold {subtextToneClass(item.subtextTone)}"
              >{item.subtext}</span
            >
          {/if}
        </div>
      {:else}
        <!-- min-w-fit so nowrap cells never paint into their neighbor -->
        <div class="flex min-w-fit flex-1 items-center gap-2.5 px-3.5">
          {#if item.icon}
            <img src={item.icon} alt="" class="h-8 w-8 shrink-0 object-contain opacity-90" />
          {/if}
          <div class="flex flex-1 flex-col gap-1">
            <div class="flex items-baseline gap-2 flex-wrap">
              <!-- nowrap so labels can't collide with values in image captures -->
              <span
                class="whitespace-nowrap text-sm font-semibold uppercase tracking-wide text-text-primary"
              >
                {item.label}
              </span>
              <span
                class="whitespace-nowrap text-xl font-bold leading-none tracking-tight {toneClass(
                  item.tone,
                )}"
              >
                {item.value}
              </span>
            </div>
            {#if item.subtext}
              <span class="text-xs font-semibold {subtextToneClass(item.subtextTone)}"
                >{item.subtext}</span
              >
            {/if}
          </div>
        </div>
      {/if}
    {/each}
  </div>
</ThemedPanel>
