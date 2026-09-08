<script lang="ts">
  // Aliased: a store named `tr` makes svelte-check flag every <tr> row as a lowercase component.
  import { tr as t } from "../../lib/i18n.js";
  import type { PtRunRecord } from "../../types/ipc.js";
  import { deletePtRun, deletePtRunLog } from "../../stores/ptRuns.js";
  import {
    formatPtTime,
    ptSquadSize,
    ptComparisonExclusionReason,
    PT_EXCLUSION_KEYS,
  } from "../../lib/profitTakerStats.js";
  import RunList from "../arbi/RunList.svelte";

  interface Props {
    runs: PtRunRecord[];
    onSelect: (id: string) => void;
    bestRunIds?: ReadonlySet<string>;
  }

  const { runs, onSelect, bestRunIds = new Set<string>() }: Props = $props();
</script>

{#snippet headers()}
  <th class="px-3 py-2 text-right font-semibold">{$t("common.total")}</th>
  <th class="px-3 py-2 text-right font-semibold">{$t("pt.stat.flight")}</th>
  <th class="px-3 py-2"></th>
{/snippet}

{#snippet cells(run: PtRunRecord)}
  {@const size = ptSquadSize(run)}
  {@const exclusion = ptComparisonExclusionReason(run)}
  <td class="whitespace-nowrap px-3 py-2 text-right font-mono font-semibold text-text-primary"
    >{formatPtTime(run.durationSec)}</td
  >
  <td class="whitespace-nowrap px-3 py-2 text-right font-mono text-text-secondary"
    >{formatPtTime(run.flightSec)}</td
  >
  <td class="px-3 py-2">
    <span class="flex flex-wrap items-center gap-1">
      <span
        class="rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-text-muted"
        >{size === null
          ? $t("pt.unknownSquad")
          : size === 1
            ? $t("pt.recordedPlayer")
            : $t("pt.squadSize", { count: size })}</span
      >
      {#if run.aborted}
        <span
          class="rounded border border-danger/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-danger"
          >{$t("arbi.end.aborted")}</span
        >
      {:else if run.complete}
        <span
          class="rounded border border-success/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-success"
          >{$t("pt.badge.complete")}</span
        >
      {:else}
        <span
          class="rounded border border-warning/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-warning"
          title={$t("arbi.incompleteHint")}>{$t("arbi.incomplete")}</span
        >
      {/if}
      {#if run.bugged}
        <span
          data-pt-bugged
          class="rounded border border-warning/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-warning"
          title={$t("pt.badge.buggedHint")}>{$t("pt.badge.bugged")}</span
        >
      {/if}
      {#if bestRunIds.has(run.id)}
        <span
          data-pt-pb
          class="rounded border border-success/40 bg-success/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-success"
          >{$t("arbi.pb.badge")}</span
        >
      {/if}
      {#if exclusion === "migrated" || exclusion === "flight" || exclusion === "telemetry" || exclusion === "squad"}
        <span
          data-pt-exclusion={exclusion}
          class="rounded border border-warning/30 px-1.5 py-0.5 text-[10px] text-warning"
          >{$t(PT_EXCLUSION_KEYS[exclusion])}</span
        >
      {/if}
      {#if run.source === "imported"}
        <span
          class="rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-text-muted"
          >{$t("common.imported")}</span
        >
      {/if}
      {#if run.duplicateOf}
        <span
          data-pt-duplicate
          class="rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-text-muted"
          title={$t("arbi.duplicateHint")}>{$t("arbi.duplicate")}</span
        >
      {/if}
      {#each run.tags ?? [] as tag (tag)}
        <span
          class="rounded border border-info/40 bg-info/10 px-1.5 py-0.5 text-[10px] font-semibold text-info"
          >{tag}</span
        >
      {/each}
    </span>
  </td>
{/snippet}

<p data-pt-recorded-roster class="m-0 text-xs text-text-muted">{$t("pt.recordedRosterHint")}</p>
<RunList
  {runs}
  {onSelect}
  {headers}
  {cells}
  deleteRun={deletePtRun}
  deleteRunLog={deletePtRunLog}
  listAttrs={{ "data-pt-runs": "" }}
  rowAttrs={(run) => ({ "data-pt-run": run.id })}
/>
