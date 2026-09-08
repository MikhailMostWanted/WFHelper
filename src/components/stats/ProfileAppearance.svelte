<script lang="ts">
  import { onMount } from "svelte";
  import {
    PROFILE_COLOR_GROUPS,
    PROFILE_COLOR_CHANNELS,
    type ProfileAppearanceItem,
    type ProfileColorGroup,
    type ProfileColorChannel,
    type ProfileSavedLoadout,
  } from "../../../config/shared/personalProfile.js";
  import { fallbackNameFromUniqueName } from "../../../config/shared/displayName.js";
  import { itemDb } from "../../stores/data.js";
  import { itemLabel } from "../../lib/itemLabel.js";
  import { tr as t, type MessageKey } from "../../lib/i18n.js";
  import { on } from "../../lib/ipc.js";
  import ThemedPanel from "../ThemedPanel.svelte";

  let {
    items,
    loadouts = [],
  }: { items: ProfileAppearanceItem[]; loadouts?: ProfileSavedLoadout[] } = $props();
  const CATEGORY_KEYS: Record<ProfileAppearanceItem["category"], MessageKey> = {
    Suits: "profile.warframe",
    LongGuns: "profile.primaryWeapon",
    Pistols: "profile.secondaryWeapon",
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
  let selectedLoadout = $state<number | null>(null);
  let selectedModConfig = $state<number | null>(null);
  const loadoutIndex = $derived(selectedLoadout ?? (loadouts.length ? 0 : -1));
  const loadout = $derived(loadouts[loadoutIndex] ?? null);
  const shownItems = $derived(
    loadout ? loadout.slots.flatMap((slot) => (slot.item ? [slot.item] : [])) : items,
  );
  const item = $derived(shownItems[Math.min(selected, Math.max(0, shownItems.length - 1))] ?? null);
  const loadoutItem = $derived(
    loadout ? (loadout.slots.find((slot) => slot.item === item)?.item ?? null) : null,
  );
  const modIndex = $derived(selectedModConfig ?? loadoutItem?.activeModConfig ?? null);
  const modConfig = $derived(
    modIndex === null ? null : (loadoutItem?.modConfigs[modIndex] ?? null),
  );
  const selectionScope = $derived(
    JSON.stringify([
      items.map((entry) => [entry.category, entry.type]),
      loadouts.map((preset) => [
        preset.name,
        preset.slots.map((slot) => [slot.category, slot.item?.type]),
      ]),
    ]),
  );
  function resetSelection(): void {
    selected = 0;
    selectedConfig = null;
    selectedLoadout = null;
    selectedModConfig = null;
  }
  $effect(() => {
    // Inventory polls replace arrays even when the available gear has not changed.
    void selectionScope;
    resetSelection();
  });
  onMount(() => on("profile-account-changed", resetSelection));
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
  {#if loadouts.length}
    <label class="flex flex-wrap items-center gap-3 text-sm text-text-secondary">
      <span>{$t("profile.savedLoadouts")}</span>
      <select
        class="min-w-0 max-w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-text-primary [&_option]:bg-bg-surface [&_option]:text-text-primary"
        data-profile-loadout
        value={loadoutIndex}
        onchange={(event) => {
          selectedLoadout = Number(event.currentTarget.value);
          selected = 0;
          selectedConfig = null;
          selectedModConfig = null;
        }}
      >
        {#each loadouts as preset, index}
          <option value={index}
            >{preset.name || $t("profile.loadoutNumber", { index: index + 1 })}</option
          >
        {/each}
        {#if items.length}<option value={-1}>{$t("profile.publicLoadout")}</option>{/if}
      </select>
    </label>
  {/if}
  <p class="m-0 text-sm text-text-secondary">
    {$t(loadout ? "profile.savedLoadoutsSource" : "profile.appearanceSource")}
  </p>
  {#if !loadouts.length}<p class="m-0 text-sm text-text-muted" data-profile-loadouts-unavailable>
      {$t("profile.savedLoadoutsUnavailable")}
    </p>{/if}
  {#if loadout}
    {#each loadout.slots.filter((slot) => !slot.item) as slot}
      <p class="m-0 text-sm text-text-muted" data-profile-slot-unavailable={slot.category}>
        {$t(CATEGORY_KEYS[slot.category])}: {$t("profile.unavailable")}
      </p>
    {/each}
  {/if}
  {#if !item}
    <div class="empty-state"><p>{$t("profile.noAppearance")}</p></div>
  {:else}
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {#each shownItems as entry, index}
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
            selectedModConfig = null;
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
                ? ` · ${$t(loadout ? "profile.savedConfig" : "profile.activeConfig")}`
                : ""}</button
            >
          {/each}
        </div>
      </div>
      {#if loadout}<section class="flex flex-col gap-3" data-profile-mods>
          <h5 class="m-0 text-xs font-semibold uppercase tracking-wide text-text-muted">
            {$t("profile.equippedUpgrades")}
          </h5>
          {#if loadoutItem}
            <div class="flex flex-wrap gap-2">
              {#each loadoutItem.modConfigs as entry, index}
                <button
                  type="button"
                  class="filter-tab"
                  class:active={modIndex === index}
                  data-profile-mod-config={index}
                  aria-pressed={modIndex === index}
                  onclick={() => (selectedModConfig = index)}
                  >{entry.name ||
                    $t("profile.modConfig", { index: index + 1 })}{loadoutItem.activeModConfig ===
                  index
                    ? ` · ${$t("profile.savedConfig")}`
                    : ""}</button
                >
              {/each}
            </div>
          {/if}
          {#if !modConfig || modConfig.upgrades === null}
            <p class="m-0 text-sm text-text-muted" data-profile-mods-unavailable>
              {$t("profile.modsUnavailable")}
            </p>
          {:else if !modConfig.upgrades.length}
            <p class="m-0 text-sm text-text-muted">{$t("profile.noEquippedUpgrades")}</p>
          {:else}
            <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {#each modConfig.upgrades as upgrade}
                <div
                  class="flex min-w-0 items-center gap-3 rounded-lg border border-border/50 p-3"
                  data-profile-mod-slot={upgrade.slot}
                >
                  {#if upgrade.type && $itemDb[upgrade.type]?.imageUrl}<img
                      src={$itemDb[upgrade.type].imageUrl ?? ""}
                      alt=""
                      class="h-14 w-12 shrink-0 object-contain"
                      loading="lazy"
                    />{/if}
                  <div class="flex min-w-0 flex-col gap-1">
                    <span class="text-xs text-text-muted"
                      >{$t("overlay.reward.slot", { index: upgrade.slot + 1 })}</span
                    >
                    <span class="break-words text-sm text-text-primary"
                      >{upgrade.type
                        ? itemLabel($itemDb[upgrade.type]) ||
                          fallbackNameFromUniqueName(upgrade.type)
                        : $t("profile.unresolvedMod")}</span
                    >
                    <span class="text-xs text-text-secondary"
                      >{upgrade.rank === null
                        ? $t("profile.rankUnavailable")
                        : $t("browse.rankValue", { value: upgrade.rank })}</span
                    >
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </section>{/if}
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
