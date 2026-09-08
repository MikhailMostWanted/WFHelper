<script lang="ts">
  import {
    PROFILE_COLOR_GROUPS,
    PROFILE_COLOR_CHANNELS,
    type ProfileAppearanceItem,
    type ProfileColorGroup,
    type ProfileColorChannel,
  } from "../../../config/shared/personalProfile.js";
  import { fallbackNameFromUniqueName } from "../../../config/shared/displayName.js";
  import { itemDb } from "../../stores/data.js";
  import { itemLabel } from "../../lib/itemLabel.js";
  import { tr as t, type MessageKey } from "../../lib/i18n.js";
  import ThemedPanel from "../ThemedPanel.svelte";

  let { items }: { items: ProfileAppearanceItem[] } = $props();
  const CATEGORY_KEYS: Record<ProfileAppearanceItem["category"], MessageKey> = {
    Suits: "profile.warframe",
    LongGuns: "common.primary",
    Pistols: "appearance.label.textSecondary",
    Melee: "rivens.type.melee",
  };
  const GROUP_KEYS: Record<ProfileColorGroup, MessageKey> = {
    pricol: "profile.bodyColors",
    attcol: "profile.attachmentColors",
    syancol: "profile.syandanaColors",
    sigcol: "profile.sigilColors",
  };
  const COLOR_KEYS: Record<ProfileColorChannel, MessageKey> = {
    t0: "common.primary",
    t1: "appearance.label.textSecondary",
    t2: "profile.tertiary",
    t3: "pet.trait.accent",
    m0: "profile.emissiveOne",
    m1: "profile.emissiveTwo",
    en: "profile.energyOne",
    e1: "profile.energyTwo",
  };
  const SUIT_SLOT_KEYS: Record<number, MessageKey> = {
    0: "profile.helmet",
    7: "profile.skin",
    5: "profile.animation",
    6: "profile.syandana",
    8: "profile.chest",
    1: "profile.leftShoulder",
    9: "profile.rightShoulder",
    2: "profile.leftLeg",
    10: "profile.rightLeg",
    12: "profile.frontSigil",
    13: "profile.backSigil",
    16: "profile.ephemera",
    25: "profile.signa",
  };
  const WEAPON_SLOT_KEYS: Record<number, MessageKey> = {
    0: "profile.skin",
    2: "profile.holster",
    6: "profile.meleeAttachment",
  };
  let selected = $state(0);
  let selectedConfig = $state<number | null>(null);
  const item = $derived(items[Math.min(selected, Math.max(0, items.length - 1))] ?? null);
  const configIndex = $derived(
    Math.min(
      selectedConfig ?? item?.activeConfig ?? 0,
      Math.max(0, (item?.configs.length ?? 0) - 1),
    ),
  );
  const config = $derived(item?.configs[configIndex] ?? null);
  const colors = $derived(
    PROFILE_COLOR_GROUPS.filter((group) => Object.keys(config?.colors[group] ?? {}).length > 0),
  );

  function slotKey(slot: number, category: ProfileAppearanceItem["category"]): MessageKey | null {
    return (category === "Suits" ? SUIT_SLOT_KEYS : WEAPON_SLOT_KEYS)[slot] ?? null;
  }
</script>

<div class="flex flex-col gap-4" data-profile-appearance>
  <p class="m-0 text-sm text-text-secondary">{$t("profile.appearanceSource")}</p>
  {#if !item}
    <div class="empty-state"><p>{$t("profile.noAppearance")}</p></div>
  {:else}
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {#each items as entry, index}
        <button
          type="button"
          class="flex items-center gap-3 rounded-lg border p-3 text-left transition-colors {selected ===
          index
            ? 'border-accent bg-accent/10'
            : 'border-border bg-transparent hover:bg-bg-hover'}"
          data-profile-appearance-item={entry.category}
          aria-pressed={selected === index}
          onclick={() => {
            selected = index;
            selectedConfig = null;
          }}
        >
          {#if $itemDb[entry.type]?.imageUrl}<img
              src={$itemDb[entry.type].imageUrl ?? ""}
              alt=""
              class="h-16 w-16 shrink-0 object-contain"
            />{/if}
          <span class="flex min-w-0 flex-col gap-1"
            ><span class="text-xs uppercase text-text-muted"
              >{$t(CATEGORY_KEYS[entry.category])}</span
            ><span class="font-display text-lg text-text-heading"
              >{itemLabel($itemDb[entry.type]) || fallbackNameFromUniqueName(entry.type)}</span
            ></span
          >
        </button>
      {/each}
    </div>
    <ThemedPanel className="flex flex-col gap-5 p-5">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 class="m-0 font-display text-xl text-text-heading">
            {itemLabel($itemDb[item.type]) || fallbackNameFromUniqueName(item.type)}
          </h4>
          {#if item.hiddenWhenHolstered !== undefined}<p
              class="mb-0 mt-1 text-xs text-text-secondary"
            >
              {item.hiddenWhenHolstered
                ? $t("profile.hiddenWhenHolstered")
                : $t("profile.shownWhenHolstered")}
            </p>{/if}
        </div>
        <div class="flex flex-wrap items-center gap-2">
          {#each item.configs as look, index}
            <button
              type="button"
              class="filter-tab"
              class:active={configIndex === index}
              data-profile-config={index}
              aria-pressed={configIndex === index}
              onclick={() => (selectedConfig = index)}
              >{look.name || $t("profile.config", { index: index + 1 })}{item.activeConfig === index
                ? ` · ${$t("profile.activeConfig")}`
                : ""}</button
            >
          {/each}
        </div>
      </div>
      {#if !config}
        <p class="m-0 text-sm text-text-muted">{$t("profile.noAppearanceConfig")}</p>
      {:else}
        <div class="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <div>
            <h5 class="mb-3 mt-0 text-xs font-semibold uppercase tracking-wide text-text-muted">
              {$t("profile.cosmetics")}
            </h5>
            {#if config.skins.length === 0}<p class="text-sm text-text-secondary">
                {$t("profile.noCosmetics")}
              </p>{/if}
            <div class="grid gap-2">
              {#each config.skins as skin}
                {@const key = slotKey(skin.slot, item.category)}
                <div
                  class="flex min-w-0 items-center gap-3 rounded-lg border border-border/50 px-3 py-2"
                  data-profile-cosmetic-slot={skin.slot}
                >
                  {#if $itemDb[skin.type]?.imageUrl}<img
                      src={$itemDb[skin.type].imageUrl ?? ""}
                      alt=""
                      class="h-10 w-10 shrink-0 object-contain"
                      loading="lazy"
                    />{/if}
                  <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span class="text-xs text-text-muted"
                      >{key ? $t(key) : $t("overlay.reward.slot", { index: skin.slot })}</span
                    ><span class="break-words text-sm text-text-primary"
                      >{itemLabel($itemDb[skin.type]) ||
                        fallbackNameFromUniqueName(skin.type)}</span
                    >
                  </div>
                </div>
              {/each}
            </div>
          </div>
          <div class="flex flex-col gap-5">
            {#if colors.length === 0}<p class="text-sm text-text-secondary">
                {$t("profile.noColors")}
              </p>{/if}
            {#each colors as group}
              <div>
                <h5 class="mb-3 mt-0 text-xs font-semibold uppercase tracking-wide text-text-muted">
                  {$t(GROUP_KEYS[group])}
                </h5>
                <div class="grid grid-cols-2 gap-2">
                  {#each PROFILE_COLOR_CHANNELS as channel}
                    {@const color = config.colors[group]?.[channel]}
                    {#if color}
                      <div
                        class="flex items-center gap-2.5 rounded-lg border border-border/50 p-2"
                        data-profile-color={`${group}-${channel}`}
                      >
                        <span
                          class="h-9 w-9 shrink-0 rounded border border-border"
                          style:background-color={color}
                          aria-hidden="true"
                        ></span>
                        <span class="flex min-w-0 flex-col gap-0.5"
                          ><span class="text-xs text-text-secondary"
                            >{group === "sigcol"
                              ? $t("profile.colorChannel", { channel })
                              : $t(COLOR_KEYS[channel])}</span
                          ><code class="text-xs uppercase text-text-primary">{color}</code></span
                        >
                      </div>
                    {/if}
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        </div>
      {/if}
    </ThemedPanel>
  {/if}
</div>
