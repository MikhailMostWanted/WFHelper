<script lang="ts">
  import { onMount } from "svelte";
  import { invoke, on } from "../lib/ipc.js";
  import { locale, tr } from "../lib/i18n.js";
  import { formatNumber } from "../lib/format.js";
  import { fallbackNameFromUniqueName } from "../../config/shared/displayName.js";
  import type { ResourceTrackingReport } from "../../config/shared/resourceBalances.js";
  import ThemedPanel from "./ThemedPanel.svelte";

  let report: ResourceTrackingReport | null = null;
  let failed = false;
  let generation = 0;
  async function refresh() {
    const ticket = ++generation;
    try {
      const next = await invoke("getResourceTracking");
      if (ticket === generation) {
        report = next;
        failed = false;
      }
    } catch {
      if (ticket === generation) {
        report = null;
        failed = true;
      }
    }
  }
  onMount(() => {
    void refresh();
    const dispose = on("inventory-updated", () => {
      void refresh();
    });
    const sourceDispose = on("inventory-status-updated", () => {
      void refresh();
    });
    return () => {
      generation++;
      dispose();
      sourceDispose();
    };
  });
  $: rows = report?.rows.filter((row) => row.event) ?? [];
  function date(stamp: number | null): string {
    return stamp === null ? $tr("eventResources.unknown") : new Date(stamp).toLocaleString($locale);
  }
</script>

<ThemedPanel className="p-4 mb-3">
  <section data-event-resources aria-label={$tr("eventResources.title")}>
    <div class="flex flex-wrap items-baseline justify-between gap-2 mb-3">
      <h3 class="m-0 text-sm font-semibold">{$tr("eventResources.title")}</h3>
      {#if report}<span class="text-xs text-text-muted"
          >{$tr("eventResources.captured", { date: date(report.capturedAt) })}</span
        >{/if}
    </div>
    {#if failed || !report}
      <p class="m-0 text-xs text-text-muted">{$tr("eventResources.unavailable")}</p>
    {:else if rows.length === 0}
      <p class="m-0 text-xs text-text-muted">{$tr("eventResources.empty")}</p>
    {:else}
      <div class="grid grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-3">
        {#each rows as row (row.type)}
          <article class="resource-card p-3" data-event-resource={row.type}>
            <div class="font-semibold text-sm mb-2" title={row.type}>
              {($locale === "ru" ? row.nameRu : row.name) ||
                row.name ||
                fallbackNameFromUniqueName(row.type)}
            </div>
            <dl class="m-0 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-xs">
              <dt class="text-text-muted">{$tr("eventResources.balance")}</dt>
              <dd class="m-0 font-semibold" data-event-balance>
                {row.count === null ? $tr("eventResources.unknown") : formatNumber(row.count)}
              </dd>
              <dt class="text-text-muted">{$tr("eventResources.change")}</dt>
              <dd class="m-0" data-event-delta>
                {row.delta === null ? "—" : `${row.delta > 0 ? "+" : ""}${formatNumber(row.delta)}`}
              </dd>
              <dt class="text-text-muted">{$tr("eventResources.mission")}</dt>
              <dd class="m-0">{$tr("eventResources.unknown")}</dd>
            </dl>
          </article>
        {/each}
      </div>
      <p class="mt-3 mb-0 text-xs text-text-muted">
        {report.previousCapturedAt === null
          ? $tr("eventResources.baseline")
          : $tr("eventResources.between", { date: date(report.previousCapturedAt) })}
      </p>
      <p class="mt-1 mb-0 text-xs text-text-muted">{$tr("eventResources.explanation")}</p>
    {/if}
  </section>
</ThemedPanel>
