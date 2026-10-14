<script lang="ts">
  import {
    chainBuildableBlueprints,
    isFoundryRecipeReady,
  } from "../../lib/inventory/foundryResources.js";
  import { tr } from "../../lib/i18n.js";
  import { dashboardLayout, settingNumber, widgetSettings } from "../../stores/dashboard.js";
  import { componentOwnership, foundryData, itemDb } from "../../stores/data.js";
  import WidgetFrame from "./WidgetFrame.svelte";

  interface Props {
    nowCoarseMs: number;
  }

  const { nowCoarseMs }: Props = $props();

  interface ReadyRow {
    key: string;
    name: string;
    claimable: boolean;
  }

  const settings = $derived(widgetSettings($dashboardLayout, "widget.foundryReady"));
  const limit = $derived(settingNumber(settings, "limit", 5));
  const foundry = $derived($foundryData);
  // Kept out of the clock-driven derived below: walking the recipe chain is the
  // expensive half and only moves when the inventory or the item DB does.
  const chainBuildable = $derived(
    chainBuildableBlueprints(foundry.recipes, $componentOwnership, $itemDb),
  );

  const rows = $derived.by((): ReadyRow[] => {
    const claimable = foundry.building
      .filter((entry) => entry.endDate != null && entry.endDate.getTime() <= nowCoarseMs)
      .map((entry) => ({
        key: `building:${entry.productUniqueName ?? entry.name}`,
        name: entry.displayName || entry.name,
        claimable: true,
      }));
    const buildable = foundry.recipes
      .filter((recipe) => isFoundryRecipeReady(recipe, $componentOwnership, chainBuildable))
      .map((recipe) => ({
        key: `recipe:${recipe.uniqueName ?? recipe.name}`,
        name: recipe.displayName || recipe.name,
        claimable: false,
      }));
    return [...claimable, ...buildable];
  });

  const shown = $derived(rows.slice(0, limit));
</script>

<WidgetFrame
  widgetId="widget.foundryReady"
  empty={rows.length === 0}
  emptyKey="foundry.noItems"
  overflow={rows.length - shown.length}
>
  <ul class="m-0 max-h-[340px] flex-1 list-none overflow-y-auto p-0">
    {#each shown as row (row.key)}
      <li class="foundry-row flex items-center gap-3 text-sm">
        <span class="min-w-0 flex-1 truncate text-text-secondary" title={row.name}>{row.name}</span>
        <span class="foundry-state" class:claimable={row.claimable}>
          {row.claimable
            ? $tr("mastery.roadmap.accessClaimable")
            : $tr("foundry.status.readyToBuild")}
        </span>
      </li>
    {/each}
  </ul>
</WidgetFrame>

<style>
  .foundry-row {
    padding: 0.55rem 0;
    border-bottom: 1px solid var(--border-subtle);
  }
  .foundry-row:last-child {
    border-bottom: 0;
  }
  .foundry-state {
    flex-shrink: 0;
    max-width: 45%;
    padding: 0.22rem 0.45rem;
    border-radius: var(--radius-sm);
    background: var(--bg-base);
    color: var(--text-muted);
    font-size: 0.67rem;
    line-height: 1.4;
  }
  .foundry-state.claimable {
    background: color-mix(in srgb, var(--accent) 8%, var(--bg-base));
    color: var(--accent);
  }
</style>
