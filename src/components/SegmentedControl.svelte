<script lang="ts" generics="T extends string | number">
  export let value: T;
  export let options: ReadonlyArray<{ value: T; label: string }>;
  export let onChange: (value: T) => void;
  export let disabled = false;
  export let wrap = false;
</script>

<div
  class="inline-flex overflow-hidden rounded-[var(--radius-md)] border border-[var(--ui-control-border)] text-xs {wrap
    ? 'flex-wrap gap-px bg-border'
    : 'bg-bg-surface'}"
>
  {#each options as option, index (option.value)}
    <button
      type="button"
      {disabled}
      data-segment-value={option.value}
      aria-pressed={value === option.value}
      class="px-2 py-1 transition-colors disabled:cursor-not-allowed disabled:opacity-50 {wrap
        ? 'grow'
        : index > 0
          ? 'border-l border-border'
          : ''} {value === option.value
        ? 'bg-accent text-bg-base font-semibold'
        : 'bg-bg-surface text-text-secondary hover:text-text-primary'}"
      on:click={() => onChange(option.value)}
    >
      {option.label}
    </button>
  {/each}
</div>
