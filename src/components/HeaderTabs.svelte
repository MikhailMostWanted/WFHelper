<script lang="ts">
  export let options: Array<{ key: string; label: string }> = [];
  export let activeKey = "";
  export let onSelect: (key: string) => void;
</script>

<div class="wanted-header-tabs flex flex-wrap">
  {#each options as option (option.key)}
    <button
      class="wanted-header-tab flex items-center whitespace-nowrap font-display text-sm text-text-secondary"
      data-active={activeKey === option.key || undefined}
      aria-pressed={activeKey === option.key}
      data-tour-tab={option.key}
      on:click={() => onSelect(option.key)}
    >
      {option.label}
    </button>
  {/each}
</div>

<style>
  .wanted-header-tabs {
    gap: 0.3rem;
    padding: 0.4rem;
    align-items: center;
  }
  .wanted-header-tab {
    padding: 0.65rem 0.9rem;
    border: 1px solid transparent;
    border-radius: 0.55rem;
    background: none;
    cursor: pointer;
    transition:
      color 0.15s,
      background-color 0.15s,
      border-color 0.15s;
    line-height: 1.25;
    font-weight: 500;
  }
  .wanted-header-tab:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }
  .wanted-header-tab[data-active] {
    color: var(--accent);
    border-color: var(--border-strong);
    background: var(--accent-glow);
  }
  @media (max-width: 800px) {
    .wanted-header-tab {
      padding: 0.55rem 0.65rem;
      font-size: 0.75rem;
    }
  }
</style>
