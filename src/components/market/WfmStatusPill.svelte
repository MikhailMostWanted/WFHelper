<script lang="ts">
  import { tr } from "../../lib/i18n.js";
  import { marketSession, marketViewState } from "../../stores/market.js";
  import WfmPresenceBar from "./WfmPresenceBar.svelte";

  const STATUS_LABEL_KEYS = {
    online: "common.online",
    ingame: "common.inGame",
    invisible: "common.invisible",
  } as const;

  const STATUS_DOT_CLASSES = {
    online: "bg-success",
    ingame: "bg-info",
    invisible: "bg-text-muted",
  } as const;

  let open = $state(false);
  let pill = $state<HTMLElement | null>(null);

  const status = $derived($marketViewState.status);
  const label = $derived(status ? $tr(STATUS_LABEL_KEYS[status]) : $tr("common.unknown"));
  const dotClass = $derived(status ? STATUS_DOT_CLASSES[status] : "bg-text-muted");
  const autoNote = $derived(
    $marketViewState.statusAutoActive
      ? $tr("market.followingGame")
      : $marketViewState.statusAwayActive
        ? $tr("market.presenceAway")
        : "",
  );

  function onWindowKey(event: KeyboardEvent): void {
    if (!open || event.key !== "Escape") return;
    event.preventDefault();
    open = false;
  }

  function onWindowPointerDown(event: PointerEvent): void {
    if (!open) return;
    const target = event.target instanceof Node ? event.target : null;
    if (target && pill?.contains(target)) return;
    open = false;
  }
</script>

<svelte:window onkeydown={onWindowKey} onpointerdown={onWindowPointerDown} />

{#if $marketSession.loggedIn}
  <div bind:this={pill} class="relative" data-wfm-status-pill>
    <button
      class="inline-flex min-w-0 items-center gap-1 rounded border border-border-subtle bg-surface-hover px-2 py-0.5 text-[10px] text-text-muted transition-colors duration-150 hover:border-border hover:text-text-secondary"
      title={$tr("market.wfmTitle")}
      aria-haspopup="dialog"
      aria-expanded={open}
      data-wfm-status-current={status ?? ""}
      onclick={() => (open = !open)}
    >
      <span class="inline-block h-1.5 w-1.5 shrink-0 rounded-full {dotClass}"></span>
      <span class="overflow-hidden text-ellipsis whitespace-nowrap">{label}</span>
      {#if autoNote}
        <span class="max-w-32 overflow-hidden text-ellipsis whitespace-nowrap opacity-70"
          >{autoNote}</span
        >
      {/if}
    </button>

    {#if open}
      <!-- A titlebar row has no space, so the panel hangs off the pill. -->
      <div
        class="absolute right-0 top-full z-50 mt-1 w-88 rounded border border-border bg-bg-surface p-2"
        data-wfm-status-menu
      >
        <WfmPresenceBar />
      </div>
    {/if}
  </div>
{/if}
