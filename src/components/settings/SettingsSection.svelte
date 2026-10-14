<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    // Optional because the Linux cards embed components that draw their own heading.
    title?: string;
    description?: string;
    aside?: Snippet;
    children: Snippet;
  }

  let { title, description, aside, children }: Props = $props();
</script>

{#snippet heading()}
  <h3
    class="m-0 mb-1.5 font-display text-[var(--font-heading-size,0.95rem)] font-semibold tracking-[0.03em] text-text-primary"
  >
    {title}
  </h3>
  {#if description}
    <p class="text-[var(--font-small-size,0.82rem)] text-text-secondary">{description}</p>
  {/if}
{/snippet}

<article
  class="wanted-settings-section w-full rounded-[var(--radius-xl)] border border-[var(--ui-panel-border)] bg-[var(--ui-panel-bg)] p-4 shadow-[var(--ui-panel-shadow)] [backdrop-filter:var(--ui-backdrop-blur)]"
>
  {#if title}
    {#if aside}
      <div class="flex items-start justify-between gap-3">
        <div>
          {@render heading()}
        </div>
        {@render aside()}
      </div>
    {:else}
      <div>
        {@render heading()}
      </div>
    {/if}
  {/if}
  {@render children()}
</article>
