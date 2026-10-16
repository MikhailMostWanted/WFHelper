<script lang="ts">
  import { formatNumber } from "../lib/format.js";
  import { tr } from "../lib/i18n.js";
  import { itemLabel } from "../lib/itemLabel.js";
  import ItemImage from "../components/ItemImage.svelte";
  import type { Resource } from "../types/inventory.js";
  import EventResourcePanel from "../components/EventResourcePanel.svelte";

  export let resources: Resource[] = [];
</script>

<div class="resources-sub-panel">
  <EventResourcePanel />
  <div class="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-3">
    {#if resources.length === 0}
      <div class="empty-state col-span-full">
        <p>{$tr("resources.noResourcesFound")}</p>
      </div>
    {:else}
      {#each resources as r}
        <div class="resource-card flex items-center gap-2.5 px-2.5 py-2">
          <div
            class="resource-img-wrap h-[var(--resource-image-wrap)] w-[var(--resource-image-wrap)] shrink-0"
          >
            <ItemImage
              src={r.imageUrl}
              alt={itemLabel(r)}
              cls="h-[var(--resource-image-max)] w-[var(--resource-image-max)] object-contain"
            />
          </div>
          <div class="resource-info flex-1 justify-center p-0">
            <span class="resource-name whitespace-normal break-words leading-tight"
              >{itemLabel(r)}</span
            >
            <span class="resource-count">{formatNumber(r.count)}</span>
          </div>
        </div>
      {/each}
    {/if}
  </div>
</div>
