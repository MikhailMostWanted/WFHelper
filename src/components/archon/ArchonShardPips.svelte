<script lang="ts">
  import {
    archonShardColorKey,
    archonShardIconUrl,
    type ArchonShardColor,
    type ArchonShardSlot,
  } from "../../lib/inventory/archonShards.js";
  import { tr, type Translator } from "../../lib/i18n.js";
  import { itemDb } from "../../stores/data.js";

  interface Props {
    slots: ArchonShardSlot[];
    /** Render unfilled sockets as placeholders instead of dropping them. */
    showEmpty?: boolean;
    size?: "sm" | "md" | "lg";
    title?: string;
  }

  let { slots, showEmpty = false, size = "sm", title }: Props = $props();

  // Shard hues are fixed game colours, so they stay out of the theme presets.
  // Only the fallback dot needs them; the icons carry their own colour.
  const SHARD_HEX: Record<ArchonShardColor, string> = {
    crimson: "#e2465b",
    amber: "#e8a63a",
    azure: "#3f9ee0",
    emerald: "#3fc489",
    topaz: "#ef8a3c",
    violet: "#a271e6",
  };

  // A 404 on the icon mirror would otherwise leave an invisible pip.
  let brokenIcons = $state<string[]>([]);

  // Translator passed in rather than read inside: keeps the dependency textual.
  function pipTitle(slot: ArchonShardSlot, t: Translator): string | undefined {
    if (!slot.filled) return undefined;
    const colorLabel = slot.color ? t(archonShardColorKey(slot.color)) : t("common.unknown");
    return slot.tauforged ? `${colorLabel} - ${t("archon.tauforged")}` : colorLabel;
  }

  const pips = $derived(
    (showEmpty ? slots : slots.filter((slot) => slot.filled)).map((slot) => {
      const icon = archonShardIconUrl($itemDb, slot.color, slot.tauforged);
      return {
        slot,
        icon: icon && !brokenIcons.includes(icon) ? icon : null,
        title: pipTitle(slot, $tr),
      };
    }),
  );

  function markBroken(url: string): void {
    if (!brokenIcons.includes(url)) brokenIcons = [...brokenIcons, url];
  }
</script>

{#if pips.length > 0}
  <span
    class="shard-pips"
    class:md={size === "md"}
    class:lg={size === "lg"}
    {title}
    data-archon-pips
  >
    {#each pips as pip (pip.slot.index)}
      {#if pip.icon}
        {@const icon = pip.icon}
        <img
          class="shard-icon"
          src={icon}
          alt=""
          loading="lazy"
          draggable="false"
          title={pip.title}
          data-archon-pip={pip.slot.color}
          data-archon-tau={pip.slot.tauforged ? "true" : null}
          onerror={() => markBroken(icon)}
        />
      {:else}
        <span
          class="shard-pip"
          class:tau={pip.slot.tauforged}
          class:empty={!pip.slot.filled}
          class:unknown={pip.slot.filled && !pip.slot.color}
          title={pip.title}
          style={pip.slot.color ? `--shard:${SHARD_HEX[pip.slot.color]}` : undefined}
          data-archon-pip={pip.slot.color ?? (pip.slot.filled ? "unknown" : "empty")}
          data-archon-tau={pip.slot.tauforged ? "true" : null}
        ></span>
      {/if}
    {/each}
  </span>
{/if}

<style>
  .shard-pips {
    display: inline-flex;
    align-items: center;
    gap: var(--pip-gap, 3px);
  }

  .shard-icon {
    width: 9px;
    height: 9px;
    flex: none;
    object-fit: contain;
    /* Big downscale, so smooth beats nearest-neighbour. */
    image-rendering: auto;
    /* Alpha-shaped outline: pips sit on card art, not on a flat panel. */
    filter: drop-shadow(0 0 1px color-mix(in oklab, var(--bg-deep) 85%, transparent));
  }

  .shard-pip {
    width: 9px;
    height: 9px;
    flex: none;
    border-radius: 50%;
    background: color-mix(in oklab, var(--shard, var(--text-muted)) 72%, transparent);
    border: 1px solid color-mix(in oklab, var(--shard, var(--text-muted)) 55%, transparent);
    box-shadow: 0 0 0 1px color-mix(in oklab, var(--bg-deep) 40%, transparent);
  }

  /* No icon to fall back on here, so the diamond keeps tauforged readable. */
  .shard-pip.tau {
    width: 9px;
    height: 9px;
    border-radius: 1px;
    transform: rotate(45deg);
    background: var(--shard, var(--text-secondary));
    border-color: color-mix(in oklab, var(--shard, white) 45%, white);
  }

  .shard-pip.empty {
    background: transparent;
    border-style: dashed;
    border-color: var(--border);
    box-shadow: none;
  }

  /* Opaque on purpose: a filled socket DE sent no colour for still has to draw,
     or the pip count disagrees with the tooltip. */
  .shard-pip.unknown {
    background: var(--text-muted);
    border-color: color-mix(in oklab, var(--text-muted) 60%, white);
    box-shadow: 0 0 0 1px color-mix(in oklab, var(--bg-deep) 55%, transparent);
  }

  .shard-pips.md .shard-icon,
  .shard-pips.lg .shard-icon {
    width: 16px;
    height: 16px;
  }

  .shard-pips.md .shard-pip,
  .shard-pips.lg .shard-pip {
    width: 16px;
    height: 16px;
  }

  .shard-pips.md .shard-pip.tau,
  .shard-pips.lg .shard-pip.tau {
    width: 15px;
    height: 15px;
  }

  /* The rotated tau diamond overruns its box, so a full row needs more gap. */
  .shard-pips.lg {
    --pip-gap: 5px;
  }
</style>
