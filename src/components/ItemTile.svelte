<script lang="ts">
  import ItemImage from "./ItemImage.svelte";

  interface Props {
    /** Value for data-item-tile; e2e locates tiles by it. */
    tileKey: string;
    label: string;
    /** Pre-translated, so the locale change re-renders through the parent. */
    count: string;
    /** Neutral tints the count alone; danger paints the whole tile. */
    tone?: "neutral" | "danger";
    /** Neutral only: false turns the count red. */
    enough?: boolean;
    imageUrl?: string | null;
    auditKey?: string | null;
    /** Item type to expose on data-item-tile-missing, null when it is covered. */
    missingKey?: string | null;
    /** Absent for the credits tile, which has nothing to open. */
    onOpen?: (() => void) | null;
    ariaLabel?: string | null;
  }

  const {
    tileKey,
    label,
    count,
    tone = "neutral",
    enough = true,
    imageUrl = null,
    auditKey = null,
    missingKey = null,
    onOpen = null,
    ariaLabel = null,
  }: Props = $props();

  const TILE_CLASS = "item-tile flex w-24 flex-col items-center gap-1 rounded-lg p-1 text-center";
</script>

{#snippet tile()}
  <span class="flex h-14 w-14 shrink-0 items-center justify-center">
    <ItemImage src={imageUrl} alt={label} {auditKey} cls="max-h-14 max-w-14 object-contain" />
  </span>
  <span
    class="line-clamp-2 break-words text-xs leading-tight {tone === 'danger'
      ? 'text-text-primary'
      : 'text-text-secondary'}">{label}</span
  >
  <span
    class="text-xs leading-tight {tone === 'danger'
      ? 'font-semibold tabular-nums'
      : enough
        ? 'text-text-secondary'
        : 'text-danger'}"
    data-item-tile-missing={missingKey}
  >
    {count}
  </span>
{/snippet}

{#if onOpen}
  <button
    type="button"
    class="{TILE_CLASS} {tone === 'danger'
      ? 'item-tile--danger'
      : 'item-tile--neutral'} cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
    title={label}
    aria-label={ariaLabel}
    data-item-tile={tileKey}
    onclick={onOpen}
  >
    {@render tile()}
  </button>
{:else}
  <div
    class="{TILE_CLASS} {tone === 'danger' ? 'item-tile--danger' : 'item-tile--neutral'}"
    title={label}
    data-item-tile={tileKey}
  >
    {@render tile()}
  </div>
{/if}

<style>
  /* color-mix has no utility form, so both tones live here. */
  .item-tile {
    border: 1px solid transparent;
    background: transparent;
    color: inherit;
    transition:
      background-color 0.15s,
      border-color 0.15s;
  }
  button.item-tile--neutral:hover {
    border-color: var(--accent-dim);
    background: var(--surface-hover);
  }
  .item-tile--danger {
    border-color: color-mix(in oklab, var(--danger) 40%, transparent);
    background: color-mix(in oklab, var(--danger) 12%, transparent);
    color: color-mix(in oklab, var(--danger) 88%, white);
  }
  button.item-tile--danger:hover {
    border-color: color-mix(in oklab, var(--danger) 65%, transparent);
  }
</style>
