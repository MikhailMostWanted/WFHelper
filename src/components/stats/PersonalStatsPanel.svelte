<script lang="ts">
  import { onMount } from "svelte";
  import {
    PROFILE_CAREER_KEYS,
    type PersonalProfileResult,
    type ProfileCareerKey,
  } from "../../../config/shared/personalProfile.js";
  import { fallbackNameFromUniqueName } from "../../../config/shared/displayName.js";
  import { invoke, on } from "../../lib/ipc.js";
  import { locale, tr as t, type MessageKey, type Translator } from "../../lib/i18n.js";
  import { itemLabel } from "../../lib/itemLabel.js";
  import { loadEnemyInfo } from "../../lib/enemies/enemyInfoLazy.js";
  import { itemDb } from "../../stores/data.js";
  import SearchBox from "../SearchBox.svelte";
  import SummaryStrip from "../SummaryStrip.svelte";
  import ThemedPanel from "../ThemedPanel.svelte";
  import ProfileAppearance from "./ProfileAppearance.svelte";

  type Section = "career" | "equipment" | "enemies" | "abilities" | "missions" | "appearance";
  type Metric =
    | "equipTime"
    | "kills"
    | "headshots"
    | "assists"
    | "xp"
    | "finishers"
    | "deaths"
    | "scans"
    | "used"
    | "highScore";
  interface TableRow {
    type: string;
    name: string;
    image: string | null;
    values: Partial<Record<Metric, number>>;
  }
  const PAGE_SIZE = 50;
  const SECTION_KEYS: Record<Section, MessageKey> = {
    career: "profile.career",
    equipment: "inventory.tab.equipment",
    enemies: "profile.enemies",
    abilities: "profile.abilities",
    missions: "enemy.missions",
    appearance: "common.appearance",
  };
  const CAREER_KEYS: Record<ProfileCareerKey, MessageKey> = {
    TimePlayedSec: "profile.timePlayed",
    Income: "profile.creditsEarned",
    ReviveCount: "profile.revives",
    HealCount: "profile.healed",
    Deaths: "profile.deaths",
    MeleeKills: "profile.meleeKills",
    MissionsCompleted: "profile.missionsCompleted",
    MissionsFailed: "profile.missionsFailed",
    MissionsQuit: "profile.missionsQuit",
    MissionsInterrupted: "profile.missionsInterrupted",
    MissionsDumped: "profile.missionsDumped",
    CiphersSolved: "profile.ciphersSolved",
    CiphersFailed: "profile.ciphersFailed",
    CipherTime: "profile.cipherTime",
    PickupCount: "profile.pickups",
    DestroyCount: "profile.objectsDestroyed",
    FishCount: "profile.fishCaught",
  };
  const METRIC_KEYS: Record<Metric, MessageKey> = {
    equipTime: "profile.equippedTime",
    kills: "profile.kills",
    headshots: "profile.headshots",
    assists: "profile.assists",
    xp: "profile.affinity",
    finishers: "profile.finishers",
    deaths: "profile.deaths",
    scans: "common.scans",
    used: "profile.timesUsed",
    highScore: "profile.highScore",
  };
  const SECTION_METRICS: Record<Section, Metric[]> = {
    career: [],
    equipment: ["equipTime", "kills", "headshots", "assists", "xp"],
    enemies: ["kills", "headshots", "assists", "finishers", "deaths", "scans"],
    abilities: ["used"],
    missions: ["highScore"],
    appearance: [],
  };
  let result = $state<PersonalProfileResult | null>(null);
  let busy = $state(false);
  let failed = $state(false);
  let section = $state<Section>("career");
  let search = $state("");
  let sort = $state<"name" | Metric>("name");
  let descending = $state(false);
  let page = $state(0);
  let now = $state(Date.now());
  let enemyInfo = $state<Awaited<ReturnType<typeof loadEnemyInfo>> | null>(null);
  let disposed = false;
  let requestGeneration = 0;
  let cacheReloadPending = false;

  async function refresh(force = false): Promise<void> {
    if (busy) return;
    const generation = ++requestGeneration;
    busy = true;
    failed = false;
    try {
      const next = await invoke("getPersonalProfile", force);
      if (!disposed && generation === requestGeneration) result = next;
    } catch {
      if (!disposed && generation === requestGeneration) failed = true;
    } finally {
      if (!disposed) {
        busy = false;
        if (cacheReloadPending) {
          cacheReloadPending = false;
          void refresh();
        }
      }
    }
  }

  function reloadCachedProfile(): void {
    requestGeneration += 1;
    if (busy) cacheReloadPending = true;
    else void refresh();
  }

  onMount(() => {
    void refresh();
    const unsubscribe = on("inventory-updated", reloadCachedProfile);
    const unsubscribeSource = on("inventory-status-updated", reloadCachedProfile);
    const unsubscribeAccount = on("profile-account-changed", () => {
      result = null;
      reloadCachedProfile();
    });
    return () => {
      disposed = true;
      unsubscribe();
      unsubscribeSource();
      unsubscribeAccount();
    };
  });
  $effect(() => {
    const deadline = result?.nextRefreshAt ?? 0;
    now = Date.now();
    if (deadline <= Date.now()) return;
    const timer = setInterval(() => {
      now = Date.now();
      if (Date.now() >= deadline) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  });

  function selectSection(next: Section): void {
    section = next;
    search = "";
    sort = "name";
    descending = false;
    page = 0;
    if (next === "enemies" && !enemyInfo) {
      void loadEnemyInfo()
        .then((info) => {
          if (!disposed) enemyInfo = info;
        })
        .catch(() => {});
    }
  }

  function selectSort(next: "name" | Metric): void {
    descending = sort === next ? !descending : next !== "name";
    sort = next;
    page = 0;
  }

  function formatValue(
    value: number | undefined,
    seconds: boolean,
    translate: Translator,
    loc: string,
  ): string {
    if (value === undefined) return translate("profile.unavailable");
    return seconds
      ? translate("profile.hours", {
          count: (value / 3600).toLocaleString(loc, { maximumFractionDigits: 1 }),
        })
      : value.toLocaleString(loc, { maximumFractionDigits: 1 });
  }

  const profile = $derived(result?.profile ?? null);
  const waitSeconds = $derived(Math.max(0, Math.ceil(((result?.nextRefreshAt ?? 0) - now) / 1000)));
  const unavailableKey = $derived(
    result?.status === "no-account"
      ? "profile.noAccount"
      : result?.status === "account-changed"
        ? "profile.accountChanged"
        : "profile.noData",
  );
  const hasError = $derived(failed || result?.status === "fetch-failed");
  const updated = $derived(
    result?.fetchedAt ? new Date(result.fetchedAt).toLocaleString($locale) : null,
  );
  const registered = $derived(
    profile?.registeredAt ? new Date(profile.registeredAt).toLocaleDateString($locale) : null,
  );
  const summary = $derived([
    {
      key: "time",
      label: $t("profile.timePlayed"),
      value: formatValue(profile?.career.TimePlayedSec, true, $t, $locale),
    },
    {
      key: "missions",
      label: $t("profile.missionsCompleted"),
      value: formatValue(profile?.career.MissionsCompleted, false, $t, $locale),
    },
    {
      key: "credits",
      label: $t("profile.creditsEarned"),
      value: formatValue(profile?.career.Income, false, $t, $locale),
    },
    {
      key: "revives",
      label: $t("profile.revives"),
      value: formatValue(profile?.career.ReviveCount, false, $t, $locale),
    },
  ]);
  const metrics = $derived(SECTION_METRICS[section]);
  const source = $derived(
    section === "equipment"
      ? profile?.equipment
      : section === "enemies"
        ? profile?.enemies
        : section === "abilities"
          ? profile?.abilities
          : section === "missions"
            ? profile?.missions
            : null,
  );
  const rows = $derived.by((): TableRow[] => {
    const query = search.trim().toLocaleLowerCase($locale);
    const mapped = (source ?? [])
      .map((entry): TableRow => {
        const db = $itemDb[entry.type];
        const enemy = section === "enemies" ? enemyInfo?.findEnemyByType(entry.type) : null;
        const suppliedName = "name" in entry && typeof entry.name === "string" ? entry.name : "";
        const name =
          suppliedName || itemLabel(db) || enemy?.name || fallbackNameFromUniqueName(entry.type);
        return { type: entry.type, name, image: db?.imageUrl ?? null, values: entry };
      })
      .filter((row) => !query || row.name.toLocaleLowerCase($locale).includes(query));
    return mapped.sort((a, b) => {
      if (sort === "name") return (descending ? -1 : 1) * a.name.localeCompare(b.name, $locale);
      const av = a.values[sort];
      const bv = b.values[sort];
      if (av === undefined) return bv === undefined ? a.name.localeCompare(b.name, $locale) : 1;
      if (bv === undefined) return -1;
      return (descending ? -1 : 1) * (av - bv) || a.name.localeCompare(b.name, $locale);
    });
  });
  const lastPage = $derived(Math.max(0, Math.ceil(rows.length / PAGE_SIZE) - 1));
  const currentPage = $derived(Math.min(page, lastPage));
  const shown = $derived(rows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE));
</script>

<div
  class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 @container"
  data-personal-profile
>
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div>
      <h3 class="m-0 font-body text-2xl font-semibold text-text-heading" data-profile-name>
        {profile?.displayName || $t("profile.personal")}
      </h3>
      <div class="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-text-secondary">
        {#if profile?.masteryRank !== undefined}<span
            >{$t("marketAlerts.masteryRank")}: {profile.masteryRank.toLocaleString($locale)}</span
          >{/if}
        {#if registered}<span>{$t("profile.registered", { date: registered })}</span>{/if}
      </div>
      <p class="mb-0 mt-2 text-xs text-text-muted">{$t("profile.source")}</p>
    </div>
    <div class="flex flex-col items-end gap-1.5">
      <button
        type="button"
        class="btn-secondary"
        data-profile-refresh
        disabled={busy || waitSeconds > 0}
        onclick={() => void refresh(true)}
        >{busy ? $t("common.loading") : $t("common.refresh")}</button
      >
      {#if updated}<span class="text-xs text-text-muted"
          >{$t("profile.updated", { date: updated })}</span
        >{/if}
      {#if waitSeconds > 0}<span class="text-xs text-text-muted"
          >{$t("profile.refreshWait", { seconds: waitSeconds })}</span
        >{/if}
    </div>
  </div>
  {#if hasError}<p
      class="m-0 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-warning"
      role="status"
      data-profile-status
    >
      {profile ? $t("profile.stale") : $t("profile.fetchFailed")}
    </p>{/if}
  {#if result?.inventorySource && result.inventorySource !== "helper"}<p
      class="m-0 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-warning"
      role="status"
      data-profile-source-warning
    >
      {$t("profile.importSourceWarning")}
    </p>{/if}
  {#if busy && !profile}
    <div class="empty-state"><p>{$t("common.loading")}</p></div>
  {:else if !profile}
    {#if !hasError}<div class="empty-state"><p>{$t(unavailableKey)}</p></div>{/if}
  {:else}
    <SummaryStrip items={summary} variant="grid" />
    <div class="filter-tabs flex-wrap" data-profile-sections>
      {#each Object.entries(SECTION_KEYS) as [key, label]}
        <button
          type="button"
          class="filter-tab"
          class:active={section === key}
          data-profile-section={key}
          onclick={() => selectSection(key as Section)}>{$t(label)}</button
        >
      {/each}
    </div>
    {#if section === "career"}
      <ThemedPanel className="grid grid-cols-1 gap-x-8 px-5 py-2 @md:grid-cols-2">
        {#each PROFILE_CAREER_KEYS as key}
          <div
            class="flex items-center justify-between gap-4 border-b border-border/40 py-3"
            data-profile-career={key}
          >
            <span class="text-sm text-text-secondary">{$t(CAREER_KEYS[key])}</span>
            <span class="text-right font-medium tabular-nums text-text-primary"
              >{key === "CipherTime"
                ? profile.career[key] === undefined
                  ? $t("profile.unavailable")
                  : $t("profile.seconds", {
                      count: profile.career[key].toLocaleString($locale, {
                        maximumFractionDigits: 1,
                      }),
                    })
                : formatValue(profile.career[key], key === "TimePlayedSec", $t, $locale)}</span
            >
          </div>
        {/each}
        {#if profile.career.CipherTime !== undefined && profile.career.CiphersSolved !== undefined && profile.career.CiphersSolved > 0}
          <div class="flex items-center justify-between gap-4 py-3">
            <span class="text-sm text-text-secondary">{$t("profile.averageCipherTime")}</span><span
              class="font-medium tabular-nums text-text-primary"
              >{$t("profile.seconds", {
                count: (profile.career.CipherTime / profile.career.CiphersSolved).toLocaleString(
                  $locale,
                  { maximumFractionDigits: 1 },
                ),
              })}</span
            >
          </div>
        {/if}
      </ThemedPanel>
    {:else if section === "appearance"}
      <ProfileAppearance items={profile.appearance} />
    {:else}
      <ThemedPanel className="flex min-w-0 flex-col gap-3 p-3">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <SearchBox
            value={search}
            onValueChange={(value) => {
              search = value;
              page = 0;
            }}
            class="w-72 max-w-full"
          />
          <span class="text-xs text-text-muted"
            >{$t("profile.rowCount", { count: rows.length.toLocaleString($locale) })}</span
          >
        </div>
        {#if source === null || source === undefined}
          <div class="empty-state"><p>{$t("profile.tableUnavailable")}</p></div>
        {:else if rows.length === 0}
          <div class="empty-state">
            <p>{search ? $t("profile.noMatches") : $t("profile.noEntries")}</p>
          </div>
        {:else}
          <div class="overflow-x-auto">
            <table class="w-full border-collapse text-sm" data-profile-table={section}>
              <thead
                ><tr class="border-b border-border text-xs uppercase text-text-muted">
                  <th
                    class="px-3 py-3 text-left"
                    aria-sort={sort === "name" ? (descending ? "descending" : "ascending") : "none"}
                    ><button
                      class="cursor-pointer bg-transparent text-inherit"
                      onclick={() => selectSort("name")}
                      >{$t("common.name")} {sort === "name" ? (descending ? "↓" : "↑") : ""}</button
                    ></th
                  >
                  {#each metrics as metric}<th
                      class="whitespace-nowrap px-3 py-3 text-right"
                      aria-sort={sort === metric
                        ? descending
                          ? "descending"
                          : "ascending"
                        : "none"}
                      ><button
                        class="cursor-pointer bg-transparent text-inherit"
                        data-profile-sort={metric}
                        onclick={() => selectSort(metric)}
                        >{$t(METRIC_KEYS[metric])}
                        {sort === metric ? (descending ? "↓" : "↑") : ""}</button
                      ></th
                    >{/each}
                </tr></thead
              >
              <tbody
                >{#each shown as row, index (`${row.type}-${index}`)}<tr
                    class="border-b border-border/30 hover:bg-bg-hover"
                    data-profile-row={row.type}
                  >
                    <td class="px-3 py-2.5"
                      ><div class="flex min-w-48 items-center gap-3">
                        {#if row.image}<img
                            src={row.image}
                            alt=""
                            class="h-9 w-9 shrink-0 object-contain"
                            loading="lazy"
                          />{/if}<span class="text-text-primary">{row.name}</span>
                      </div></td
                    >
                    {#each metrics as metric}<td
                        class="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-text-secondary"
                        >{formatValue(row.values[metric], metric === "equipTime", $t, $locale)}</td
                      >{/each}
                  </tr>{/each}</tbody
              >
            </table>
          </div>
          <div class="flex items-center justify-end gap-3 text-xs text-text-secondary">
            <button
              class="btn-secondary btn-sm"
              data-profile-previous
              disabled={currentPage === 0}
              onclick={() => (page = currentPage - 1)}>{$t("profile.previousPage")}</button
            >
            <span>{$t("profile.page", { current: currentPage + 1, total: lastPage + 1 })}</span>
            <button
              class="btn-secondary btn-sm"
              data-profile-next
              disabled={currentPage === lastPage}
              onclick={() => (page = currentPage + 1)}>{$t("profile.nextPage")}</button
            >
          </div>
        {/if}
      </ThemedPanel>
    {/if}
  {/if}
</div>
