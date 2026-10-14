<script lang="ts">
  import { onMount } from "svelte";
  import { currentView, settingsTabRequest } from "../stores/app.js";
  import { launcherOpen } from "../stores/launcher.js";
  import { locale, tr } from "../lib/i18n.js";
  import { NAV_ICON_URLS, APP_LOGO_URL } from "../lib/assetUrls.js";
  import {
    hiddenTabs,
    sidebarCollapsed,
    sidebarLabels,
    sidebarOrder,
    sidebarWidth,
    toggleSidebarCollapsed,
    nudgeSidebarWidth,
    resetSidebarWidth,
    snapSidebarWidth,
    SIDEBAR_EXPAND_MIN,
    SIDEBAR_RAIL_WIDTH,
    SIDEBAR_WIDTH_MAX,
  } from "../stores/sidebarTabs.js";
  import { VIEW_LABEL_KEYS } from "../lib/viewRegistry.js";
  import FeedbackModal from "./FeedbackModal.svelte";
  import { invoke } from "../lib/ipc.js";

  let feedbackOpen = false;
  let devMode = false;
  let dragWidth: number | null = null;
  let resizing = false;
  let dragStartX = 0;
  let dragStartWidth = 0;
  $: effectiveWidth = dragWidth ?? $sidebarWidth;
  $: collapsed = dragWidth != null ? dragWidth < SIDEBAR_EXPAND_MIN : $sidebarCollapsed;
  $: visible = $sidebarOrder.filter((view) => !$hiddenTabs.has(view) && view !== "settings");
  $: if ($hiddenTabs.has($currentView)) currentView.set("inventory");
  $: if (typeof document !== "undefined")
    document.documentElement.style.setProperty(
      "--sidebar-width",
      `${collapsed ? SIDEBAR_RAIL_WIDTH : effectiveWidth}px`,
    );

  function startResize(e: PointerEvent): void {
    if (e.button !== 0) return;
    resizing = true;
    dragStartX = e.clientX;
    dragStartWidth = $sidebarWidth;
    dragWidth = dragStartWidth;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }
  function resize(e: PointerEvent): void {
    if (resizing) dragWidth = snapSidebarWidth(dragStartWidth + e.clientX - dragStartX);
  }
  function endResize(e: PointerEvent): void {
    if (!resizing) return;
    resizing = false;
    const el = e.currentTarget as HTMLElement;
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    if (dragWidth != null) sidebarWidth.set(dragWidth);
    dragWidth = null;
  }
  function gripKey(e: KeyboardEvent): void {
    const step = e.shiftKey ? 48 : 16;
    if (e.key === "ArrowLeft") nudgeSidebarWidth(-step);
    else if (e.key === "ArrowRight") nudgeSidebarWidth(step);
    else if (e.key === "Home") sidebarWidth.set(SIDEBAR_RAIL_WIDTH);
    else if (e.key === "End") sidebarWidth.set(SIDEBAR_WIDTH_MAX);
    else if (e.key === "Enter" || e.key === " ") resetSidebarWidth();
    else return;
    e.preventDefault();
  }
  function chatGPT(): void {
    settingsTabRequest.set("chatgpt");
    currentView.set("settings");
  }
  onMount(() => {
    let mounted = true;
    void invoke("getAppRuntimeInfo").then((info) => {
      if (mounted) devMode = !info.isPackaged;
    });
    return () => {
      mounted = false;
      document.documentElement.style.removeProperty("--sidebar-width");
    };
  });
</script>

<nav
  id="sidebar"
  class="wanted-sidebar"
  class:sidebar-collapsed={collapsed}
  aria-label={$locale === "ru" ? "Разделы WantedFrame" : "WantedFrame sections"}
>
  <button
    type="button"
    class="wanted-brand"
    title="WantedFrame"
    on:click={() => currentView.set("dashboard")}
  >
    <img src={APP_LOGO_URL} alt="" /><span
      ><strong>WANTED</strong><small>FRAME / МИХАИЛ</small></span
    >
  </button>
  <button
    type="button"
    class="rail-launcher"
    data-launcher-sidebar
    title={$locale === "ru" ? "Быстрый переход · Ctrl+K" : "Quick launcher · Ctrl+K"}
    on:click={() => launcherOpen.set(true)}
    ><kbd>K</kbd><span>{$locale === "ru" ? "Быстрый переход" : "Quick launcher"}</span></button
  >
  <div class="wanted-navigation">
    {#each visible as view (view)}
      <button
        type="button"
        class="wanted-nav"
        class:active={$currentView === view}
        data-view={view}
        aria-current={$currentView === view ? "page" : undefined}
        title={$sidebarLabels[view] ?? $tr(VIEW_LABEL_KEYS[view])}
        on:click={() => currentView.set(view)}
      >
        <img src={NAV_ICON_URLS[view]} alt="" /><span
          >{$sidebarLabels[view] ?? $tr(VIEW_LABEL_KEYS[view])}</span
        >
      </button>
    {/each}
  </div>
  <div class="wanted-sidebar-bottom">
    <button
      type="button"
      class="wanted-nav wanted-chat"
      data-sidebar-chatgpt
      title={$locale === "ru" ? "Мой аккаунт в ChatGPT" : "My account in ChatGPT"}
      on:click={chatGPT}><span class="chat-glyph">AI</span><span>ChatGPT</span></button
    >
    <button
      type="button"
      class="wanted-nav"
      class:active={$currentView === "settings"}
      data-view="settings"
      title={$tr("common.settings")}
      on:click={() => currentView.set("settings")}
      ><img src={NAV_ICON_URLS.settings} alt="" /><span>{$tr("common.settings")}</span></button
    >
    <div class="rail-utility">
      {#if devMode}
        <button
          type="button"
          data-test-notification
          title={$tr("nav.testNotificationTitle")}
          aria-label={$tr("nav.testNotificationTitle")}
          on:click={() => void invoke("sendTestNotification")}>♧</button
        >
      {/if}
      <button
        type="button"
        data-sidebar-collapse
        on:click={toggleSidebarCollapsed}
        title={$tr(collapsed ? "nav.expandSidebar" : "nav.collapseSidebar")}
        aria-label={$tr(collapsed ? "nav.expandSidebar" : "nav.collapseSidebar")}
        >{collapsed ? "›" : "‹"}</button
      >
      <button
        type="button"
        data-feedback-open
        on:click={() => (feedbackOpen = true)}
        title={$tr("feedback.title")}
        aria-label={$tr("feedback.title")}>?</button
      >
    </div>
  </div>
</nav>
<div
  class="sidebar-grip"
  class:resizing
  role="slider"
  aria-label={$tr("nav.resizeSidebar")}
  aria-orientation="horizontal"
  aria-valuenow={effectiveWidth}
  aria-valuemin={SIDEBAR_RAIL_WIDTH}
  aria-valuemax={SIDEBAR_WIDTH_MAX}
  tabindex="0"
  data-sidebar-grip
  on:pointerdown={startResize}
  on:pointermove={resize}
  on:pointerup={endResize}
  on:pointercancel={endResize}
  on:lostpointercapture={endResize}
  on:keydown={gripKey}
  on:dblclick={resetSidebarWidth}
></div>
{#if feedbackOpen}<FeedbackModal onClose={() => (feedbackOpen = false)} />{/if}

<style>
  .wanted-sidebar {
    width: var(--sidebar-width);
    flex-shrink: 0;
    background: var(--bg-deep);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
    padding: 0.9rem 0.65rem;
    gap: 0.8rem;
    box-sizing: border-box;
  }
  .wanted-brand {
    display: flex;
    align-items: center;
    gap: 0.9rem;
    text-align: left;
    background: none;
    border: 0;
    color: var(--text-primary);
    padding: 0.4rem 0.5rem;
    cursor: pointer;
    flex-shrink: 0;
  }
  .wanted-brand img {
    width: 2.3rem;
    height: 2.3rem;
    object-fit: contain;
  }
  .wanted-brand strong,
  .wanted-brand small {
    display: block;
  }
  .wanted-brand strong {
    font-size: 1.02rem;
    letter-spacing: 0.14em;
    font-weight: 650;
  }
  .wanted-brand small {
    color: var(--text-muted);
    font-size: 0.52rem;
    letter-spacing: 0.16em;
    margin-top: 0.25rem;
    white-space: nowrap;
  }
  .rail-launcher {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    padding: 0.55rem 0.75rem;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 0.6rem;
    color: var(--text-muted);
    cursor: pointer;
    flex-shrink: 0;
    font-size: 0.77rem;
    text-align: left;
  }
  .rail-launcher:hover {
    border-color: var(--border-strong);
    color: var(--text-primary);
  }
  kbd {
    font-family: inherit;
    font-size: 0.67rem;
    font-weight: 600;
    color: var(--accent);
    background: var(--accent-glow);
    width: 1.3rem;
    height: 1.3rem;
    display: grid;
    place-items: center;
    border-radius: 0.3rem;
  }
  .wanted-navigation {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    flex: 1;
    scrollbar-width: thin;
    scrollbar-color: var(--bg-hover) transparent;
  }
  .wanted-nav {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    padding: 0.7rem 0.8rem;
    min-height: 2.7rem;
    box-sizing: border-box;
    text-align: left;
    background: none;
    border: 1px solid transparent;
    border-radius: 0.7rem;
    color: var(--text-secondary);
    font-size: 0.84rem;
    font-weight: 480;
    cursor: pointer;
    transition:
      background-color 0.15s,
      color 0.15s,
      border-color 0.15s;
    flex-shrink: 0;
  }
  .wanted-nav img {
    width: 1.35rem;
    height: 1.35rem;
    object-fit: contain;
    opacity: 0.62;
    flex-shrink: 0;
  }
  .wanted-nav:hover {
    background: var(--bg-surface);
    color: var(--text-primary);
  }
  .wanted-nav:hover img,
  .wanted-nav.active img {
    opacity: 1;
  }
  .wanted-nav.active {
    background: var(--accent-glow);
    border-color: var(--border-strong);
    color: var(--accent);
  }
  .wanted-sidebar-bottom {
    padding-top: 0.6rem;
    border-top: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    flex-shrink: 0;
  }
  .wanted-chat {
    color: var(--accent);
  }
  .chat-glyph {
    display: grid;
    place-items: center;
    width: 1.35rem;
    height: 1.35rem;
    font-size: 0.6rem;
    font-weight: 700;
    border: 1px solid var(--border-strong);
    border-radius: 0.35rem;
    background: var(--accent-glow);
    flex-shrink: 0;
  }
  .rail-utility {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    margin-top: 0.3rem;
  }
  .rail-utility button {
    background: none;
    border: 0;
    border-radius: 0.35rem;
    color: var(--text-muted);
    width: 1.6rem;
    height: 1.6rem;
    cursor: pointer;
    font-size: 1rem;
  }
  .rail-utility button:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .sidebar-collapsed {
    width: 84px;
    gap: 0.65rem;
    padding: 0.8rem 0.55rem;
  }
  .sidebar-collapsed .wanted-brand {
    justify-content: center;
    padding: 0;
  }
  .sidebar-collapsed .wanted-brand span,
  .sidebar-collapsed .rail-launcher span {
    display: none;
  }
  .sidebar-collapsed .rail-launcher {
    justify-content: center;
    padding: 0.6rem;
  }
  .sidebar-collapsed .wanted-nav {
    justify-content: center;
    flex-direction: column;
    gap: 0.3rem;
    padding: 0.55rem 0.15rem;
    min-height: 3.15rem;
    font-size: 0.56rem;
    text-align: center;
    line-height: 1.15;
  }
  .sidebar-collapsed .wanted-nav span {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sidebar-collapsed .wanted-nav img {
    width: 1.2rem;
    height: 1.2rem;
  }
  .sidebar-grip {
    width: 4px;
    flex-shrink: 0;
    cursor: col-resize;
    background: var(--bg-deep);
  }
  .sidebar-grip:hover,
  .sidebar-grip:focus-visible,
  .sidebar-grip.resizing {
    background: var(--accent);
  }
  @media (max-width: 800px) {
    .wanted-sidebar {
      width: 70px;
      padding: 0.65rem 0.4rem;
      gap: 0.5rem;
    }
    .wanted-brand {
      justify-content: center;
      padding: 0;
    }
    .wanted-brand span,
    .rail-launcher span {
      display: none;
    }
    .rail-launcher {
      justify-content: center;
    }
    .wanted-nav {
      flex-direction: column;
      gap: 0.25rem;
      padding: 0.5rem 0.1rem;
      font-size: 0.55rem;
      min-height: 3rem;
      text-align: center;
    }
    .wanted-nav span {
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .wanted-nav img {
      width: 1.2rem;
      height: 1.2rem;
    }
    .sidebar-grip {
      display: none;
    }
  }
</style>
