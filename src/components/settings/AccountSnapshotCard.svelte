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
  import { dashboardDesignCopy } from "../../lib/dashboardDesignCopy.js";
  import ThemedSelect from "../ThemedSelect.svelte";

  let status = $state<AccountBridgeStatus | null>(null);
  let message = $state("");
  let messageError = $state(false);
  let refreshing = $state(false);
  let activeAction = $state<AccountBridgeAction | null>(null);
  let legacyOnly = $state(false);
  let query = $state("");
  let filter = $state<"all" | "gaps" | "received">("all");
  let copiedQuestion = $state<string | null>(null);
  let copyMessage = $state("");
  let copyTimer: ReturnType<typeof setTimeout> | null = null;
  const copy = $derived(dashboardDesignCopy($locale));

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
  async function copyQuestion(id: string, prompt: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(prompt);
      copiedQuestion = id;
      copyMessage = "";
      if (copyTimer) clearTimeout(copyTimer);
      copyTimer = setTimeout(() => {
        copiedQuestion = null;
      }, 2500);
    } catch {
      copyMessage = copy.copyFailed;
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
      if (copyTimer) clearTimeout(copyTimer);
    };
  });
</script>

<div class="account-workspace" data-chatgpt-panel>
  <header class="account-intro">
    <span class="eyebrow">{copy.accountPageLabel}</span>
    <h3>{copy.accountPageTitle}</h3>
    <p>{copy.accountPageLead}</p>
  </header>

  <section class="account-command">
    <div class="command-top">
      <div class="command-identity">
        <span class="account-mark" aria-hidden="true">W<span>↗</span></span>
        <div>
          <span class="connection-state" class:connected={bridge?.connected}>
            <i aria-hidden="true"></i>{bridge?.connected ? copy.serverReady : copy.serverOff}
          </span>
          <h4>{bridge?.connected && snapshot ? copy.readyTitle : copy.offTitle}</h4>
        </div>
      </div>
      <span class="mode-tag">{bridge?.automatic ? copy.automaticMode : copy.manualMode}</span>
    </div>

    {#if snapshot}
      <dl class="snapshot-passport">
        <div>
          <dt>{copy.snapshotDate}</dt>
          <dd>{date(snapshot.inventoryUpdatedAt, $locale)}</dd>
          <span>{$tr(describeInventorySource(snapshot.source, null).labelKey)}</span>
        </div>
        <div>
          <dt>{copy.syncDate}</dt>
          <dd>{bridge?.lastSentAt != null ? date(bridge.lastSentAt, $locale) : copy.notSent}</dd>
          <span>{$tr("chatgpt.localTime")}</span>
        </div>
        <div>
          <dt>{copy.bundleLabel}</dt>
          <dd>{snapshot.rows.toLocaleString($locale)} <span>{copy.bundleRecords}</span></dd>
          <span>{size(snapshot.bytes, $locale)}</span>
        </div>
      </dl>
    {:else}
      <p class="snapshot-waiting">{$tr(refreshing ? "chatgpt.loading" : "chatgpt.noSnapshot")}</p>
    {/if}

    <div class="command-bottom">
      <div class="account-actions">
        {#if legacyOnly}
          <button class="btn-primary" disabled={busy} onclick={legacyMenu}
            >{$tr("chatgpt.legacy")}</button
          >
        {:else}
          <button
            class="btn-primary send-action"
            data-chatgpt-action="send"
            disabled={busy || !snapshot || !bridge?.connected}
            onclick={() => void perform("send")}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              aria-hidden="true"><path d="m3 3 14 7-14 7 2-7-2-7Zm2 7h12" /></svg
            >
            {activeAction === "send" || bridge?.busy ? copy.sending : copy.primarySend}
          </button>
          <button
            class="btn-secondary"
            data-chatgpt-action="export"
            disabled={busy || !snapshot}
            onclick={() => void perform("export")}
            >{activeAction === "export" ? copy.exporting : $tr("chatgpt.export")}</button
          >
          {#if !bridge?.connected}
            <button
              class="text-action"
              data-chatgpt-action="connect"
              disabled={busy}
              onclick={() => void perform("connect")}
              >{$tr("chatgpt.connect")} <span aria-hidden="true">↗</span></button
            >
          {/if}
        {/if}
      </div>
      <p>{copy.exportedHint}</p>
    </div>
    <div class="action-feedback" aria-live="polite">
      {#if message}<p class:error={messageError}>{message}</p>{/if}
      {#if status?.error}<p class="error">{status.error}</p>{/if}
      {#if bridge?.error}<p class="error">{bridge.error}</p>{/if}
    </div>
  </section>

  {#if !legacyOnly}
    <details class="connection-details">
      <summary>
        <span
          ><strong>{copy.connectionTitle}</strong><span
            >{bridge?.connected ? bridge.server : copy.connectionHint}</span
          ></span
        >
        <span class="details-chevron" aria-hidden="true">⌄</span>
      </summary>
      <div class="connection-body">
        <p>
          {$tr(snapshot?.bindingConfirmed ? "chatgpt.bindingConfirmed" : "chatgpt.bindingManual")}
        </p>
        <label class="auto-control">
          <input
            type="checkbox"
            data-chatgpt-automatic
            checked={bridge?.automatic ?? false}
            disabled={busy || !bridge?.connected || (!bridge.automatic && !canAuto)}
            onchange={(event) => {
              const enabled = event.currentTarget.checked;
              event.currentTarget.checked = bridge?.automatic ?? false;
              void perform("automatic", enabled);
            }}
          />
          <span><strong>{$tr("chatgpt.automatic")}</strong><span>{$tr(autoHint())}</span></span>
        </label>
        {#if bridge?.connected && bridge.server}
          <div class="connection-address">
            <span>{copy.connectionEndpoint}</span><code>{bridge.server}/mcp</code>
          </div>
        {:else}
          <p>{copy.noConnectionHint}</p>
          <p>{$tr("chatgpt.serverHint")}</p>
        {/if}
        <div class="connection-actions">
          {#if bridge?.connected}
            <button
              class="btn-secondary btn-sm"
              data-chatgpt-action="connect"
              disabled={busy}
              onclick={() => void perform("connect")}>{copy.reconnection}</button
            >
            <button
              class="btn-secondary btn-sm"
              data-chatgpt-action="disconnect"
              disabled={busy}
              onclick={() => void perform("disconnect")}>{$tr("chatgpt.disconnect")}</button
            >
          {:else}
            <button
              class="btn-secondary btn-sm"
              disabled={busy}
              onclick={() => void perform("connect")}>{$tr("chatgpt.connect")}</button
            >
          {/if}
          <button class="text-action" disabled={busy} onclick={() => void refresh()}
            >{$tr("chatgpt.refresh")}</button
          >
        </div>
      </div>
    </details>
  {/if}

  <section class="account-queries">
    <header class="block-heading">
      <span class="eyebrow">{copy.queryLabel}</span>
      <h4>{copy.queryTitle}</h4>
      <p>{copy.queryLead}</p>
    </header>
    <div class="question-grid">
      {#each copy.questions as question (question.id)}
        <article class="question-card">
          <span class="question-label">{question.label}</span>
          <h5>{question.title}</h5>
          <p>{question.prompt}</p>
          <button
            type="button"
            class="question-copy"
            data-chatgpt-copy={question.id}
            onclick={() => void copyQuestion(question.id, question.prompt)}
          >
            {copiedQuestion === question.id ? copy.copied : copy.copy}<span aria-hidden="true"
              >{copiedQuestion === question.id ? "✓" : "↗"}</span
            >
          </button>
        </article>
      {/each}
    </div>
    {#if copyMessage}<p class="copy-feedback" role="status">{copyMessage}</p>{/if}
  </section>

  {#if snapshot}
    <section class="account-coverage">
      <header class="block-heading">
        <span class="eyebrow">{copy.dataMapLabel}</span>
        <h4>{copy.dataMapTitle}</h4>
        <p>{copy.dataMapLead}</p>
      </header>
      <div class="coverage-overview" data-chatgpt-coverage>
        <div class="coverage-metric received">
          <strong>{counts.available}</strong><span>{copy.received}</span>
        </div>
        <div class="coverage-metric">
          <strong>{counts.partial}</strong><span>{copy.partial}</span>
        </div>
        <div class="coverage-metric">
          <strong>{counts.missing}</strong><span>{copy.missing}</span>
        </div>
        <p>{copy.metadata}</p>
      </div>
      <details class="data-map" data-chatgpt-map>
        <summary
          ><span>{copy.dataMapOpen}</span><span class="details-chevron" aria-hidden="true">⌄</span
          ></summary
        >
        <div class="section-filters">
          <input
            class="section-search"
            type="search"
            bind:value={query}
            placeholder={$tr("chatgpt.search")}
            aria-label={$tr("chatgpt.search")}
          />
          <label
            ><span class="sr-only">{$tr("chatgpt.coverage")}</span>
            <ThemedSelect bind:value={filter}>
              <option value="all">{$tr("chatgpt.allSections")}</option>
              <option value="gaps">{$tr("chatgpt.gapSections")}</option>
              <option value="received">{$tr("chatgpt.receivedSections")}</option>
            </ThemedSelect>
          </label>
        </div>
        <div class="section-list">
          {#each visibleSections as section (section.id)}
            <details class="section-detail" data-chatgpt-section={section.id}>
              <summary class="section-summary">
                <span class="section-name">{section.title}</span>
                <span class="section-state" class:received={section.status === "available"}>
                  {$tr(sectionKey(section))}
                  {#if section.status !== "missing"}<span
                      >{$tr("chatgpt.rows", { count: section.rows })}</span
                    >{/if}
                </span>
                <span class="section-date">{date(section.capturedAt, $locale)}</span>
                <span class="details-chevron" aria-hidden="true">⌄</span>
              </summary>
              <div class="section-metadata">
                <code>{section.id}</code>
                <span>{$tr("chatgpt.sectionSource", { source: section.source })}</span>
                <span
                  >{$tr("chatgpt.sectionDate", { date: date(section.capturedAt, $locale) })}</span
                >
                {#if section.status !== "missing"}
                  <span>{$tr("chatgpt.originalRows", { count: section.originalRows })}</span>
                  <span>{$tr("chatgpt.omittedRows", { count: section.omittedRows })}</span>
                  <span>{$tr("chatgpt.omittedFields", { count: section.omittedFields })}</span>
                {/if}
                {#if section.note}<p>{section.note}</p>{/if}
              </div>
            </details>
          {:else}<p class="no-sections">{$tr("chatgpt.noSections")}</p>{/each}
        </div>
      </details>

      <details class="snapshot-details">
        <summary
          ><span>{copy.technicalDetails}</span><span class="details-chevron" aria-hidden="true"
            >⌄</span
          ></summary
        >
        <div class="snapshot-metadata">
          <strong>{$tr("chatgpt.unmapped")} · {snapshot.unmappedCollections.length}</strong>
          <p>{$tr("chatgpt.unmappedHint")}</p>
          {#if snapshot.unmappedCollections.length}
            <div class="unmapped-names">
              {#each snapshot.unmappedCollections as name}<code>{name}</code>{/each}
            </div>
          {:else}<p>{$tr("chatgpt.unmappedNone")}</p>{/if}
          <span>{$tr("chatgpt.revision")}</span><code class="revision">{snapshot.revision}</code>
          <p>{$tr("chatgpt.createdAt", { date: date(snapshot.createdAt, $locale) })}</p>
        </div>
      </details>
    </section>
  {/if}
  <p class="privacy-note">{$tr("chatgpt.privacy")}</p>
</div>

<style>
  .account-workspace {
    display: flex;
    flex-direction: column;
    gap: 1.45rem;
    min-width: 0;
    padding: 1rem 0 2rem;
  }
  .eyebrow {
    color: var(--accent);
    font-size: 0.7rem;
    letter-spacing: 0.15em;
    font-weight: 600;
  }
  .account-intro h3 {
    margin: 0.5rem 0 0.55rem;
    color: var(--text-primary);
    font-family: var(--font-display);
    font-size: clamp(1.6rem, 3vw, 2.1rem);
    font-weight: 500;
    letter-spacing: -0.035em;
    line-height: 1.2;
  }
  .account-intro p,
  .block-heading p {
    margin: 0;
    max-width: 50rem;
    color: var(--text-secondary);
    font-size: 0.9rem;
    line-height: 1.6;
  }
  .account-command {
    padding: 1.5rem;
    border: 1px solid var(--ui-panel-border);
    border-radius: var(--radius-xl);
    background: linear-gradient(
      135deg,
      color-mix(in srgb, var(--accent) 4%, var(--ui-panel-bg)),
      var(--ui-panel-bg) 65%
    );
  }
  .command-top {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }
  .command-identity {
    display: flex;
    gap: 0.85rem;
    align-items: center;
  }
  .account-mark {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.1rem;
    flex-shrink: 0;
    width: 3rem;
    height: 3rem;
    border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--border));
    border-radius: 0.9rem;
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 8%, var(--bg-base));
    font-family: var(--font-display);
    font-size: 1.35rem;
    font-weight: 700;
  }
  .account-mark span {
    align-self: flex-start;
    margin-top: 0.45rem;
    font-size: 0.85rem;
  }
  .connection-state {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    color: var(--text-muted);
    font-size: 0.74rem;
  }
  .connection-state i {
    width: 0.4rem;
    height: 0.4rem;
    border-radius: 50%;
    background: var(--text-muted);
  }
  .connection-state.connected i {
    background: var(--accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 10%, transparent);
  }
  .command-identity h4 {
    margin: 0.25rem 0 0;
    color: var(--text-primary);
    font-size: 1.16rem;
    font-weight: 500;
    letter-spacing: -0.02em;
  }
  .mode-tag {
    color: var(--text-secondary);
    font-size: 0.76rem;
    padding: 0.4rem 0.65rem;
    background: var(--bg-base);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
  }
  .snapshot-passport {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 210px), 1fr));
    gap: 1.3rem;
    margin: 1.6rem 0 1.35rem;
    padding: 1.3rem 0;
    border-top: 1px solid var(--border-subtle);
    border-bottom: 1px solid var(--border-subtle);
  }
  .snapshot-passport > div {
    min-width: 0;
  }
  .snapshot-passport dt {
    color: var(--text-muted);
    font-size: 0.74rem;
    margin-bottom: 0.5rem;
  }
  .snapshot-passport dd {
    margin: 0 0 0.4rem;
    color: var(--text-primary);
    font-size: 0.99rem;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }
  .snapshot-passport dd span {
    font-size: 0.76rem;
    font-weight: 400;
    color: var(--text-secondary);
  }
  .snapshot-passport div > span {
    display: block;
    color: var(--text-muted);
    font-size: 0.73rem;
    line-height: 1.45;
  }
  .snapshot-waiting {
    padding: 1.4rem 0;
    color: var(--text-secondary);
    font-size: 0.9rem;
  }
  .command-bottom {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }
  .account-actions,
  .connection-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.65rem;
  }
  .account-actions :global(button) {
    font-size: 0.84rem;
    min-height: 2.6rem;
    gap: 0.55rem;
  }
  .command-bottom > p {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.74rem;
  }
  .text-action {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    border: 0;
    padding: 0.35rem 0;
    background: transparent;
    color: var(--text-secondary);
    font-size: 0.8rem;
    cursor: pointer;
  }
  .text-action:hover {
    color: var(--accent);
  }
  .text-action:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .text-action:focus-visible,
  .question-copy:focus-visible,
  summary:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 4px;
    border-radius: var(--radius-sm);
  }
  .action-feedback:empty {
    display: none;
  }
  .action-feedback p {
    margin: 0.9rem 0 0;
    font-size: 0.84rem;
    color: var(--text-secondary);
  }
  .action-feedback p.error {
    color: var(--danger);
  }
  .connection-details {
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    background: color-mix(in srgb, var(--bg-raised) 30%, transparent);
  }
  .connection-details > summary {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    padding: 0.95rem 1.2rem;
    cursor: pointer;
  }
  .connection-details summary strong {
    display: block;
    font-size: 0.84rem;
    font-weight: 500;
    color: var(--text-secondary);
  }
  .connection-details summary span > span {
    display: block;
    margin-top: 0.3rem;
    font-size: 0.73rem;
    color: var(--text-muted);
    overflow-wrap: anywhere;
  }
  .details-chevron {
    color: var(--text-muted);
    flex-shrink: 0;
    transition: transform 150ms ease;
  }
  details[open] > summary > .details-chevron {
    transform: rotate(180deg);
  }
  .connection-body {
    display: grid;
    gap: 1rem;
    padding: 0 1.2rem 1.2rem;
    font-size: 0.79rem;
    color: var(--text-secondary);
  }
  .connection-body p {
    margin: 0;
    line-height: 1.6;
  }
  .auto-control {
    display: flex;
    align-items: flex-start;
    gap: 0.65rem;
    padding: 1rem;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
  }
  .auto-control input {
    margin-top: 0.15rem;
  }
  .auto-control strong {
    display: block;
    font-size: 0.84rem;
    font-weight: 500;
    color: var(--text-primary);
  }
  .auto-control span > span {
    display: block;
    margin-top: 0.35rem;
    font-size: 0.75rem;
    color: var(--text-muted);
    line-height: 1.5;
  }
  .connection-address span {
    display: block;
    margin-bottom: 0.4rem;
    color: var(--text-muted);
  }
  .connection-address code {
    overflow-wrap: anywhere;
    color: var(--text-secondary);
    font-size: 0.75rem;
  }
  .block-heading h4 {
    margin: 0.45rem 0 0.45rem;
    color: var(--text-primary);
    font-size: 1.22rem;
    font-weight: 500;
    letter-spacing: -0.025em;
    line-height: 1.3;
  }
  .block-heading p {
    font-size: 0.83rem;
  }
  .question-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.85rem;
    margin-top: 1.05rem;
  }
  .question-card {
    display: flex;
    flex-direction: column;
    align-items: start;
    gap: 0.55rem;
    padding: 1.15rem 1.25rem;
    border: 1px solid var(--ui-panel-border);
    border-radius: var(--radius-lg);
    background: var(--ui-panel-bg);
    min-width: 0;
  }
  .question-label {
    color: var(--text-muted);
    font-size: 0.66rem;
    font-weight: 600;
    letter-spacing: 0.12em;
  }
  .question-card h5 {
    margin: 0.1rem 0;
    color: var(--text-primary);
    font-size: 0.95rem;
    font-weight: 500;
    letter-spacing: -0.015em;
  }
  .question-card p {
    margin: 0;
    color: var(--text-secondary);
    font-size: 0.83rem;
    line-height: 1.65;
  }
  .question-copy {
    display: flex;
    gap: 0.6rem;
    align-items: center;
    justify-content: space-between;
    margin-top: auto;
    padding: 0.5rem 0 0;
    background: transparent;
    border: 0;
    color: var(--accent);
    font-size: 0.75rem;
    font-weight: 500;
    cursor: pointer;
  }
  .question-copy:hover {
    color: var(--text-primary);
  }
  .copy-feedback {
    font-size: 0.8rem;
    color: var(--text-muted);
  }
  .account-coverage {
    padding-top: 0.55rem;
  }
  .coverage-overview {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 1.6rem;
    margin-top: 1.1rem;
    padding: 1rem 0 1.25rem;
    border-bottom: 1px solid var(--border-subtle);
  }
  .coverage-metric {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .coverage-metric strong {
    font-family: var(--font-display);
    font-size: 1.65rem;
    font-weight: 500;
    line-height: 1;
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
  }
  .coverage-metric.received strong {
    color: var(--accent);
  }
  .coverage-metric span {
    font-size: 0.73rem;
    color: var(--text-muted);
  }
  .coverage-overview > p {
    max-width: 23rem;
    margin: 0 0 0 auto;
    color: var(--text-muted);
    font-size: 0.75rem;
    line-height: 1.6;
  }
  .data-map > summary,
  .snapshot-details > summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 1.05rem 0;
    color: var(--text-secondary);
    font-size: 0.84rem;
    cursor: pointer;
  }
  .data-map > summary:hover,
  .snapshot-details > summary:hover {
    color: var(--accent);
  }
  .section-filters {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.65rem;
    margin: 0.2rem 0 1rem;
  }
  .section-search {
    flex: 1;
    min-width: 0;
    padding: 0.6rem 0.8rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--bg-base);
    color: var(--text-primary);
    font-size: 0.82rem;
  }
  .section-search:focus-visible {
    outline: 2px solid var(--accent-dim);
    outline-offset: 2px;
  }
  .section-list {
    max-height: 32rem;
    overflow-y: auto;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
  }
  .section-detail {
    border-bottom: 1px solid var(--border-subtle);
    padding: 0.85rem 1rem;
  }
  .section-detail:last-child {
    border-bottom: 0;
  }
  .section-summary {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(8rem, 0.5fr) auto auto;
    gap: 0.85rem;
    align-items: center;
    cursor: pointer;
  }
  .section-name {
    min-width: 0;
    color: var(--text-primary);
    font-size: 0.83rem;
    font-weight: 500;
  }
  .section-state {
    color: var(--text-muted);
    font-size: 0.73rem;
  }
  .section-state.received {
    color: var(--text-secondary);
  }
  .section-state > span {
    display: block;
    margin-top: 0.3rem;
    color: var(--text-muted);
    font-size: 0.7rem;
  }
  .section-date {
    color: var(--text-muted);
    font-size: 0.72rem;
    font-variant-numeric: tabular-nums;
  }
  .section-metadata {
    display: grid;
    gap: 0.4rem;
    margin-top: 1rem;
    padding-top: 0.8rem;
    border-top: 1px solid var(--border-subtle);
    color: var(--text-secondary);
    font-size: 0.75rem;
    line-height: 1.5;
    overflow-wrap: anywhere;
  }
  .section-metadata code {
    color: var(--text-muted);
    font-size: 0.7rem;
  }
  .section-metadata p {
    margin: 0.2rem 0 0;
  }
  .no-sections {
    padding: 1rem;
    font-size: 0.8rem;
    color: var(--text-muted);
  }
  .snapshot-details {
    border-top: 1px solid var(--border-subtle);
  }
  .snapshot-metadata {
    display: grid;
    gap: 0.6rem;
    padding-bottom: 1rem;
    color: var(--text-secondary);
    font-size: 0.76rem;
    overflow-wrap: anywhere;
  }
  .snapshot-metadata strong {
    font-weight: 500;
  }
  .snapshot-metadata p {
    margin: 0;
    line-height: 1.6;
  }
  .unmapped-names {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem 0.7rem;
    padding: 0.6rem 0;
  }
  .snapshot-metadata code {
    color: var(--text-muted);
    font-size: 0.7rem;
  }
  .privacy-note {
    margin: -0.3rem 0 0;
    color: var(--text-muted);
    font-size: 0.73rem;
    line-height: 1.6;
  }
  @media (max-width: 700px) {
    .account-command {
      padding: 1.15rem;
    }
    .question-grid {
      grid-template-columns: minmax(0, 1fr);
    }
    .section-summary {
      grid-template-columns: minmax(0, 1fr) auto auto;
      gap: 0.6rem;
    }
    .section-date {
      grid-column: 1 / 3;
      grid-row: 2;
    }
    .section-summary .details-chevron {
      grid-column: 3;
      grid-row: 1 / 3;
    }
    .coverage-overview > p {
      margin-left: 0;
    }
  }
</style>
