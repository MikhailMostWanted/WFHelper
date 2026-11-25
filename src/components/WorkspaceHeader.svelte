<script lang="ts">
  import { APP_PRODUCT_NAME } from "../../config/shared/appMeta.js";
  import { currentView, settingsTabRequest } from "../stores/app.js";
  import { launcherOpen } from "../stores/launcher.js";
  import { tr } from "../lib/i18n.js";
  import { VIEW_LABEL_KEYS } from "../lib/viewRegistry.js";

  function openChatGPT(): void {
    settingsTabRequest.set("chatgpt");
    currentView.set("settings");
  }
</script>

<div class="workspace-header" data-workspace-header>
  <div class="workspace-location">
    {#if import.meta.env.VITE_WANTED_BRAND === "1"}
      <span class="workspace-mark" aria-hidden="true"></span>
    {/if}
    <div class="workspace-labels">
      <strong>{APP_PRODUCT_NAME}</strong>
      <span>{$tr(VIEW_LABEL_KEYS[$currentView])}</span>
    </div>
  </div>
  <div class="workspace-tools">
    <button
      type="button"
      data-launcher-open
      aria-label={$tr("workspace.openSections")}
      aria-keyshortcuts="Control+k Meta+k"
      on:click={() => launcherOpen.set(true)}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        aria-hidden="true"
      >
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 4.5 4.5" />
      </svg>
      <span class="workspace-tool-label">{$tr("workspace.sections")}</span>
      <kbd aria-hidden="true">Ctrl K</kbd>
    </button>
    <button type="button" on:click={openChatGPT} aria-label={$tr("workspace.chatgpt")}>
      ChatGPT
    </button>
  </div>
</div>

<style>
  .workspace-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px 16px;
    padding: 12px var(--content-gutter);
    border-bottom: 1px solid var(--wf-brand-border, var(--border));
    background: var(--wf-brand-background, var(--bg-deep));
    color: var(--wf-brand-text, var(--text-primary));
    flex-shrink: 0;
  }
  .workspace-location,
  .workspace-tools {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .workspace-location {
    gap: 12px;
  }
  .workspace-mark {
    width: 40px;
    height: 36px;
    flex: 0 0 auto;
    background: var(--wf-brand-mark) no-repeat center / contain;
  }
  .workspace-labels {
    display: grid;
    gap: 4px;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .workspace-labels strong {
    font-family: var(--wf-brand-display, var(--font-display));
    font-size: clamp(0.95rem, 1vw + 0.45rem, 1.2rem);
    line-height: 1.2;
  }
  .workspace-labels span {
    color: var(--wf-brand-muted, var(--text-secondary));
    font-size: 0.8rem;
  }
  .workspace-tools button {
    display: inline-flex;
    min-width: 44px;
    min-height: 44px;
    align-items: center;
    gap: 8px;
    padding-inline: 12px;
    border: 1px solid var(--wf-brand-control-border, var(--border-strong));
    border-radius: 8px;
    background: var(--wf-brand-background, var(--bg-deep));
    color: inherit;
    font-size: 0.875rem;
    cursor: pointer;
    transition: background-color var(--wf-brand-fast, 120ms);
  }
  .workspace-tools button:hover {
    background: var(--wf-brand-surface, var(--bg-surface));
  }
  .workspace-tools :focus-visible {
    outline: 2px solid var(--wf-brand-focus, var(--accent));
    outline-offset: 3px;
  }
  svg {
    width: 16px;
    height: 16px;
    flex: none;
  }
  kbd {
    font-family: inherit;
    font-size: 0.7rem;
    color: var(--wf-brand-muted, var(--text-secondary));
  }
  @media (max-width: 720px) {
    .workspace-header {
      padding-inline: 12px;
    }
    .workspace-tool-label,
    kbd {
      display: none;
    }
  }
</style>
