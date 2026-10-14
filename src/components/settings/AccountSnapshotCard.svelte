<script lang="ts">
  import { onMount } from "svelte";
  import { invoke, on } from "../../lib/ipc.js";
  import { locale, tr, type MessageKey } from "../../lib/i18n.js";
  import { describeInventorySource } from "../../lib/inventorySourceLabel.js";
  import type {
    AccountBridgeAction,
    AccountBridgeSectionStatus,
    AccountBridgeStatus,
  } from "../../types/ipc.js";
  import SettingsSection from "./SettingsSection.svelte";
  import ThemedSelect from "../ThemedSelect.svelte";

  let status = $state<AccountBridgeStatus | null>(null);
  let message = $state("");
  let messageError = $state(false);
  let refreshing = $state(false);
  let activeAction = $state<AccountBridgeAction | null>(null);
  let legacyOnly = $state(false);
  let query = $state("");
  let filter = $state<"all" | "gaps" | "received">("all");

  const completedKeys: Record<AccountBridgeAction, MessageKey> = {
    send: "chatgpt.sent",
    export: "chatgpt.exported",
    connect: "chatgpt.connectedDone",
    disconnect: "chatgpt.disconnectedDone",
    automatic: "chatgpt.automaticDone",
  };
  const snapshot = $derived(status?.snapshot ?? null);
  const bridge = $derived(status?.bridge ?? null);
  const busy = $derived(refreshing || activeAction !== null || bridge?.busy === true);
  const canAuto = $derived(snapshot?.bindingConfirmed === true && bridge?.lastSentAt != null);
  const counts = $derived({
    available: snapshot?.sections.filter((section) => section.status === "available").length ?? 0,
    partial: snapshot?.sections.filter((section) => section.status === "partial").length ?? 0,
    missing: snapshot?.sections.filter((section) => section.status === "missing").length ?? 0,
  });
  const visibleSections = $derived(
    (snapshot?.sections ?? []).filter((section) => {
      if (filter === "gaps" && section.status === "available") return false;
      if (filter === "received" && section.status === "missing") return false;
      const needle = query.trim().toLocaleLowerCase();
      return !needle || `${section.title} ${section.id}`.toLocaleLowerCase().includes(needle);
    }),
  );

  function date(value: number | null | undefined, language: string): string {
    if (value == null || !Number.isFinite(value) || !Number.isFinite(new Date(value).getTime()))
      return $tr("chatgpt.unknownDate");
    return new Date(value).toLocaleString(language, { dateStyle: "short", timeStyle: "short" });
  }
  function size(bytes: number, language: string): string {
    const mib = bytes / (1024 * 1024);
    return `${new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(mib >= 1 ? mib : bytes / 1024)} ${mib >= 1 ? "MiB" : "KiB"}`;
  }
  function sectionKey(section: AccountBridgeSectionStatus): MessageKey {
    if (section.status === "missing") return "chatgpt.missing";
    if (section.status === "partial") return "chatgpt.partial";
    return section.rows === 0 ? "chatgpt.empty" : "chatgpt.available";
  }
  function autoHint(): MessageKey {
    if (!bridge?.connected) return "chatgpt.autoRequiresConnection";
    if (!snapshot?.bindingConfirmed) return "chatgpt.autoRequiresBinding";
    if (bridge.lastSentAt == null) return "chatgpt.autoRequiresSend";
    return "chatgpt.autoHint";
  }
  async function refresh(): Promise<void> {
    if (refreshing) return;
    legacyOnly = typeof window.api?.getAccountBridgeStatus !== "function";
    if (legacyOnly) return;
    refreshing = true;
    try {
      status = await invoke("getAccountBridgeStatus");
    } catch {
      message = $tr("chatgpt.readFailed");
      messageError = true;
    } finally {
      refreshing = false;
    }
  }
  async function perform(action: AccountBridgeAction, automatic?: boolean): Promise<void> {
    if (busy) return;
    activeAction = action;
    message = "";
    messageError = false;
    try {
      const result = await invoke("accountBridgeAction", action, automatic);
      messageError = result.outcome === "error";
      message =
        result.message ||
        $tr(
          result.outcome === "completed"
            ? completedKeys[action]
            : result.outcome === "cancelled"
              ? "chatgpt.cancelled"
              : "chatgpt.actionFailed",
        );
    } catch {
      message = $tr("chatgpt.actionFailed");
      messageError = true;
    } finally {
      activeAction = null;
      await refresh();
    }
  }
  async function legacyMenu(): Promise<void> {
    if (busy) return;
    activeAction = "export";
    try {
      const result = await invoke("exportAccountSnapshot");
      message = $tr(result.saved ? "chatgpt.completed" : "chatgpt.cancelled");
      messageError = false;
    } catch {
      message = $tr("chatgpt.actionFailed");
      messageError = true;
    } finally {
      activeAction = null;
    }
  }
  onMount(() => {
    void refresh();
    const removeInventory = on("inventory-updated", () => void refresh());
    const removeAccount = on("profile-account-changed", () => void refresh());
    const timer = setInterval(() => {
      if (bridge?.automatic || bridge?.busy) void refresh();
    }, 30_000);
    return () => {
      removeInventory();
      removeAccount();
      clearInterval(timer);
    };
  });
</script>

<div class="chatgpt-panel grid gap-3 py-3" data-chatgpt-panel>
  <SettingsSection title={$tr("chatgpt.personal")} description={$tr("chatgpt.description")}>
    <div class="mt-3 flex flex-wrap items-center gap-2 text-xs">
      <span class="chatgpt-badge" class:connected={bridge?.connected}>
        {$tr(bridge?.connected ? "chatgpt.connected" : "chatgpt.disconnected")}
      </span>
      {#if bridge?.connected}
        <span class="text-text-secondary"
          >{$tr(bridge.automatic ? "chatgpt.automatic" : "chatgpt.manual")}</span
        >
      {/if}
    </div>
    {#if snapshot}
      <div class="snapshot-summary mt-3 grid gap-3 text-sm">
        <div>
          <span class="block text-xs text-text-muted">{$tr("chatgpt.inventoryDate")}</span>
          <strong class="mt-1 block font-medium text-text-primary"
            >{date(snapshot.inventoryUpdatedAt, $locale)}</strong
          >
        </div>
        <div>
          <span class="block text-xs text-text-muted">{$tr("chatgpt.sentDate")}</span>
          <strong class="mt-1 block font-medium text-text-primary">
            {bridge?.lastSentAt != null
              ? date(bridge.lastSentAt, $locale)
              : $tr("chatgpt.neverSent")}
          </strong>
        </div>
        <div>
          <span class="block text-xs text-text-muted">{$tr("chatgpt.source")}</span>
          <strong class="mt-1 block font-medium text-text-primary"
            >{$tr(describeInventorySource(snapshot.source, null).labelKey)}</strong
          >
          <span class="mt-0.5 block text-xs text-text-secondary">
            {$tr("chatgpt.rowsSize", { count: snapshot.rows, size: size(snapshot.bytes, $locale) })}
          </span>
        </div>
      </div>
      <p class="mt-2 mb-0 text-xs text-text-muted">{$tr("chatgpt.localTime")}</p>
      <p class="mt-2 mb-0 text-xs text-text-secondary">
        {$tr(snapshot.bindingConfirmed ? "chatgpt.bindingConfirmed" : "chatgpt.bindingManual")}
      </p>
    {:else}
      <p class="mt-3 mb-0 text-sm text-text-secondary">
        {$tr(refreshing ? "chatgpt.loading" : "chatgpt.noSnapshot")}
      </p>
    {/if}

    <div class="mt-4 flex flex-wrap gap-2">
      {#if legacyOnly}
        <button class="btn-primary btn-sm" disabled={busy} onclick={legacyMenu}
          >{$tr("chatgpt.legacy")}</button
        >
      {:else}
        <button
          class="btn-primary btn-sm"
          data-chatgpt-action="send"
          disabled={busy || !snapshot || !bridge?.connected}
          onclick={() => void perform("send")}
        >
          {$tr(activeAction === "send" || bridge?.busy ? "chatgpt.sending" : "chatgpt.send")}
        </button>
        <button
          class="btn-secondary btn-sm"
          data-chatgpt-action="export"
          disabled={busy || !snapshot}
          onclick={() => void perform("export")}>{$tr("chatgpt.export")}</button
        >
        <button
          class="btn-secondary btn-sm"
          data-chatgpt-action="connect"
          disabled={busy}
          onclick={() => void perform("connect")}>{$tr("chatgpt.connect")}</button
        >
        {#if bridge?.connected}
          <button
            class="btn-secondary btn-sm"
            data-chatgpt-action="disconnect"
            disabled={busy}
            onclick={() => void perform("disconnect")}>{$tr("chatgpt.disconnect")}</button
          >
        {/if}
        <button class="btn-secondary btn-sm" disabled={busy} onclick={() => void refresh()}
          >{$tr("chatgpt.refresh")}</button
        >
      {/if}
    </div>

    {#if legacyOnly}
      <p class="mt-2 mb-0 text-xs text-text-muted">{$tr("chatgpt.legacyHint")}</p>
    {:else}
      <label class="mt-4 flex items-start gap-2.5 text-sm text-text-primary">
        <input
          type="checkbox"
          class="mt-0.5"
          data-chatgpt-automatic
          checked={bridge?.automatic ?? false}
          disabled={busy || !bridge?.connected || (!bridge.automatic && !canAuto)}
          onchange={(event) => {
            const enabled = event.currentTarget.checked;
            event.currentTarget.checked = bridge?.automatic ?? false;
            void perform("automatic", enabled);
          }}
        />
        <span
          >{$tr("chatgpt.automatic")}<span class="mt-1 block text-xs text-text-muted"
            >{$tr(autoHint())}</span
          ></span
        >
      </label>
      {#if bridge?.connected && bridge.server}
        <p class="mt-3 mb-1 text-xs text-text-secondary">{$tr("chatgpt.chatgptHint")}</p>
        <code class="block break-all text-xs text-text-primary">{bridge.server}/mcp</code>
      {:else}
        <p class="mt-3 mb-0 text-xs text-text-secondary">{$tr("chatgpt.offHint")}</p>
        <p class="mt-1 mb-0 text-xs text-text-muted">{$tr("chatgpt.serverHint")}</p>
      {/if}
    {/if}

    <div aria-live="polite" class="mt-2 text-sm">
      {#if message}
        <p class="m-0" class:text-danger={messageError} class:text-text-secondary={!messageError}>
          {message}
        </p>
      {/if}
      {#if status?.error}<p class="mb-0 text-danger">{status.error}</p>{/if}
      {#if bridge?.error}<p class="mb-0 text-danger">{bridge.error}</p>{/if}
    </div>
  </SettingsSection>

  <SettingsSection title={$tr("chatgpt.questions")} description={$tr("chatgpt.questionsHint")}>
    <ul class="query-examples mt-3 mb-0 grid gap-2 pl-4 text-sm text-text-primary">
      <li>{$tr("chatgpt.questionResources")}</li>
      <li>{$tr("chatgpt.questionBuild")}</li>
      <li>{$tr("chatgpt.questionProgress")}</li>
      <li>{$tr("chatgpt.questionGaps")}</li>
    </ul>
    <p class="mt-3 mb-0 text-xs text-text-muted">{$tr("chatgpt.privacy")}</p>
  </SettingsSection>

  {#if snapshot}
    <SettingsSection title={$tr("chatgpt.coverage")} description={$tr("chatgpt.coverageHint")}>
      <div class="mt-3 flex flex-wrap gap-2 text-xs" data-chatgpt-coverage>
        <span class="chatgpt-badge connected"
          >{$tr("chatgpt.availableCount", { count: counts.available })}</span
        >
        <span class="chatgpt-badge">{$tr("chatgpt.partialCount", { count: counts.partial })}</span>
        <span class="chatgpt-badge">{$tr("chatgpt.missingCount", { count: counts.missing })}</span>
      </div>
      <div class="mt-3 flex flex-wrap items-center gap-2">
        <input
          class="section-search min-w-0 grow"
          type="search"
          bind:value={query}
          placeholder={$tr("chatgpt.search")}
          aria-label={$tr("chatgpt.search")}
        />
        <label>
          <span class="sr-only">{$tr("chatgpt.coverage")}</span>
          <ThemedSelect bind:value={filter}>
            <option value="all">{$tr("chatgpt.allSections")}</option>
            <option value="gaps">{$tr("chatgpt.gapSections")}</option>
            <option value="received">{$tr("chatgpt.receivedSections")}</option>
          </ThemedSelect>
        </label>
      </div>
      <div class="mt-3 grid gap-1.5">
        {#each visibleSections as section (section.id)}
          <details class="section-detail" data-chatgpt-section={section.id}>
            <summary class="section-summary">
              <span class="section-chevron text-text-muted" aria-hidden="true">›</span>
              <span class="min-w-0 font-medium text-text-primary">{section.title}</span>
              <span class="text-xs text-text-secondary"
                >{$tr(sectionKey(section))}
                {#if section.status !== "missing"}<span class="block text-text-muted"
                    >{$tr("chatgpt.rows", { count: section.rows })}</span
                  >{/if}
              </span>
              <span class="text-xs text-text-muted">{date(section.capturedAt, $locale)}</span>
            </summary>
            <div class="mt-2 grid gap-1 text-xs text-text-secondary">
              <code class="break-all text-text-muted">{section.id}</code>
              <span>{$tr("chatgpt.sectionSource", { source: section.source })}</span>
              <span>{$tr("chatgpt.sectionDate", { date: date(section.capturedAt, $locale) })}</span>
              <span>{$tr("chatgpt.originalRows", { count: section.originalRows })}</span>
              <span>{$tr("chatgpt.omittedRows", { count: section.omittedRows })}</span>
              <span>{$tr("chatgpt.omittedFields", { count: section.omittedFields })}</span>
              {#if section.note}<p class="mt-1 mb-0 leading-relaxed">{section.note}</p>{/if}
            </div>
          </details>
        {:else}<p class="text-sm text-text-muted">{$tr("chatgpt.noSections")}</p>{/each}
      </div>
      <details class="mt-3 text-xs text-text-secondary">
        <summary>{$tr("chatgpt.unmapped")} · {snapshot.unmappedCollections.length}</summary>
        <p class="mt-2 mb-1">{$tr("chatgpt.unmappedHint")}</p>
        {#if snapshot.unmappedCollections.length}
          <div class="flex flex-wrap gap-x-3 gap-y-1">
            {#each snapshot.unmappedCollections as name}<code class="break-all">{name}</code>{/each}
          </div>
        {:else}<p class="m-0">{$tr("chatgpt.unmappedNone")}</p>{/if}
      </details>
      <details class="mt-3 text-xs text-text-muted">
        <summary>{$tr("chatgpt.revision")}</summary>
        <code class="mt-2 block break-all">{snapshot.revision}</code>
        <p class="mt-1 mb-0">
          {$tr("chatgpt.createdAt", { date: date(snapshot.createdAt, $locale) })}
        </p>
      </details>
    </SettingsSection>
  {/if}
</div>

<style>
  .snapshot-summary {
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
  }
  .query-examples {
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));
  }
  .chatgpt-badge {
    padding: 0.3rem 0.55rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--bg-raised);
    color: var(--text-secondary);
  }
  .chatgpt-badge.connected {
    color: var(--accent);
    border-color: var(--accent-dim);
  }
  .section-search {
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--bg-base);
    color: var(--text-primary);
    padding: 0.4rem 0.6rem;
    font-size: 0.82rem;
  }
  .section-search:focus-visible {
    outline: 2px solid var(--accent-dim);
    outline-offset: 2px;
  }
  .section-detail {
    padding: 0.6rem 0.7rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }
  .section-summary {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) minmax(8rem, 0.5fr) auto;
    gap: 0.75rem;
    cursor: pointer;
  }
  summary:focus-visible {
    outline: 2px solid var(--accent-dim);
    outline-offset: 3px;
  }
  .section-chevron {
    transition: transform 120ms ease;
  }
  details[open] > .section-summary .section-chevron {
    transform: rotate(90deg);
  }
  @media (max-width: 700px) {
    .section-summary {
      grid-template-columns: auto minmax(0, 1fr) auto;
      gap: 0.35rem 0.6rem;
    }
    .section-summary > :last-child {
      grid-column: 2 / -1;
    }
  }
</style>
