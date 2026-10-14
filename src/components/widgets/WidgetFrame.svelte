<script lang="ts">
  import type { Snippet } from "svelte";

  import { NAV_ICON_URLS } from "../../lib/assetUrls.js";
  import { tr, type MessageKey } from "../../lib/i18n.js";
  import { viewAccentStyle } from "../../lib/theme/derive.js";
  import { effectiveViewAccent } from "../../lib/theme/viewOverrides.js";
  import { VIEW_LABEL_KEYS } from "../../lib/viewRegistry.js";
  import {
    WIDGET_HOME_VIEWS,
    WIDGET_SETTING_LABEL_KEYS,
    WIDGET_SETTING_RANGES,
    widgetById,
  } from "../../lib/widgets/registry.js";
  import { currentView } from "../../stores/app.js";
  import { dashboardLayout, setWidgetSetting, widgetSettings } from "../../stores/dashboard.js";
  import { editMode } from "../../stores/layout.js";
  import { themeSettings } from "../../stores/theme.js";

  interface Props {
    widgetId: string;
    /** True when the widget has nothing to show; the body is replaced by emptyKey. */
    empty?: boolean;
    emptyKey?: MessageKey;
    /** Set when the widget's own data source failed; wins over the empty state. */
    errorKey?: MessageKey | null;
    /** Source is still fetching its first payload. A skeleton stands in for the
        empty text so a cold start never reads as "there is no data". */
    loading?: boolean;
    /** Rendered under the header even while empty, for state the body would hide. */
    subtitle?: Snippet;
    /** Rows the body left out because of the row limit; 0 hides the footer. */
    overflow?: number;
    children: Snippet;
  }

  const {
    widgetId,
    empty = false,
    emptyKey,
    errorKey = null,
    loading = false,
    subtitle,
    overflow = 0,
    children,
  }: Props = $props();

  const SKELETON_BARS = [0, 1, 2];

  const descriptor = $derived(widgetById(widgetId));
  const labelKey = $derived(descriptor?.labelKey ?? "common.unknown");
  const homeView = $derived(WIDGET_HOME_VIEWS[widgetId] ?? "inventory");
  const homeLabel = $derived($tr(VIEW_LABEL_KEYS[homeView]));
  const settingNames = $derived(Object.keys(descriptor?.settings ?? {}));
  const settings = $derived(widgetSettings($dashboardLayout, widgetId));
  const editing = $derived($editMode === "dashboard");
  // Scopes the panel to the home view's accent, so the open link and the edit
  // hover states read as that tab's colour rather than the dashboard's.
  const accentStyle = $derived(viewAccentStyle(effectiveViewAccent($themeSettings, homeView)));

  let showSettings = $state(false);

  function onNumberInput(name: string, event: Event): void {
    const value = Number((event.currentTarget as HTMLInputElement).value);
    if (Number.isFinite(value)) setWidgetSetting(widgetId, name, value);
  }
</script>

<section
  class="dashboard-widget relative flex min-w-0 flex-col overflow-hidden"
  style={accentStyle}
  data-widget={widgetId}
>
  <header class="widget-heading flex items-center gap-2.5">
    <span class="widget-icon"><img src={NAV_ICON_URLS[homeView]} alt="" /></span>
    <h3 class="m-0 min-w-0 font-display font-medium text-text-primary">
      {$tr(labelKey)}
    </h3>
    <div class="ml-auto flex items-center gap-1">
      {#if editing && settingNames.length > 0}
        <button
          type="button"
          class="cursor-pointer rounded border border-border px-1.5 py-0.5 text-xs text-text-secondary transition-colors hover:border-accent hover:text-accent"
          data-widget-gear={widgetId}
          aria-expanded={showSettings}
          title={$tr("dashboard.widgetSettings", { label: $tr(labelKey) })}
          aria-label={$tr("dashboard.widgetSettings", { label: $tr(labelKey) })}
          onclick={() => (showSettings = !showSettings)}
        >
          <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true">
            <path
              d="M8 5.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6zm0 4.3a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z"
            />
            <path
              d="M14 8c0-.4 0-.7-.1-1l1.2-.9-1.4-2.4-1.4.5a5 5 0 0 0-1.7-1L10.4 1.6H7.6L7.4 3.2a5 5 0 0 0-1.7 1l-1.4-.5-1.4 2.4 1.2.9a5.6 5.6 0 0 0 0 2l-1.2.9 1.4 2.4 1.4-.5c.5.4 1 .8 1.7 1l.2 1.6h2.8l.2-1.6c.6-.2 1.2-.6 1.7-1l1.4.5 1.4-2.4-1.2-.9c.1-.3.1-.6.1-1z"
              opacity="0.55"
            />
          </svg>
        </button>
      {/if}
      <button
        type="button"
        class="cursor-pointer rounded border border-border px-1.5 py-0.5 text-xs text-text-secondary transition-colors hover:border-accent hover:text-accent"
        data-widget-open={widgetId}
        title={$tr("dashboard.openTab", { label: homeLabel })}
        aria-label={$tr("dashboard.openTab", { label: homeLabel })}
        onclick={() => currentView.set(homeView)}
      >
        <svg
          viewBox="0 0 16 16"
          width="12"
          height="12"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M9.5 2.5h4v4" />
          <path d="M13.5 2.5 8 8" />
          <path d="M12.5 9.5V13H3V3.5h3.5" />
        </svg>
      </button>
    </div>
  </header>

  {#if subtitle}
    {@render subtitle()}
  {/if}

  {#if editing && showSettings && settingNames.length > 0}
    <div
      class="flex flex-col gap-1.5 rounded-[var(--radius-md)] border border-accent/40 bg-accent/5 px-2 py-1.5 text-xs"
      data-widget-settings={widgetId}
    >
      {#each settingNames as name (name)}
        {@const kind = descriptor?.settings?.[name]}
        {@const range = WIDGET_SETTING_RANGES[name]}
        {@const settingLabel = WIDGET_SETTING_LABEL_KEYS[name] ?? "common.unknown"}
        <label class="flex items-center justify-between gap-2">
          <span class="text-text-secondary">{$tr(settingLabel)}</span>
          {#if kind === "boolean"}
            <input
              type="checkbox"
              data-widget-setting={name}
              checked={settings[name] === true}
              onchange={(event) => setWidgetSetting(widgetId, name, event.currentTarget.checked)}
            />
          {:else if kind === "number"}
            <input
              type="number"
              class="w-16 rounded border border-border bg-bg-raised px-1.5 py-0.5 text-text-primary outline-none focus:border-accent"
              data-widget-setting={name}
              min={range?.min}
              max={range?.max}
              value={String(settings[name] ?? "")}
              onchange={(event) => onNumberInput(name, event)}
            />
          {:else}
            <input
              type="text"
              class="w-32 rounded border border-border bg-bg-raised px-1.5 py-0.5 text-text-primary outline-none focus:border-accent"
              data-widget-setting={name}
              value={String(settings[name] ?? "")}
              onchange={(event) => setWidgetSetting(widgetId, name, event.currentTarget.value)}
            />
          {/if}
        </label>
      {/each}
    </div>
  {/if}

  {#snippet placeholder(text: string, attribute: "error" | "empty")}
    <div
      class="widget-placeholder flex flex-1 flex-col items-start justify-center gap-3 text-text-secondary"
      data-widget-error={attribute === "error" ? widgetId : undefined}
      data-widget-empty={attribute === "empty" ? widgetId : undefined}
    >
      <p class="m-0">{text}</p>
      <button
        type="button"
        class="cursor-pointer border-0 bg-transparent p-0 text-[0.78rem] text-accent underline-offset-2 hover:underline"
        data-widget-open-empty={widgetId}
        onclick={() => currentView.set(homeView)}
      >
        {$tr("dashboard.openTab", { label: homeLabel })}
      </button>
    </div>
  {/snippet}

  {#if errorKey}
    {@render placeholder($tr(errorKey), "error")}
  {:else if loading}
    <div class="flex flex-col gap-2 py-2" data-widget-loading={widgetId}>
      {#each SKELETON_BARS as bar (bar)}
        <div class="h-3 animate-pulse rounded-[var(--radius-sm)] bg-text-muted/20"></div>
      {/each}
    </div>
  {:else if empty}
    {@render placeholder($tr(emptyKey ?? "world.noData"), "empty")}
  {:else}
    {@render children()}
    {#if overflow > 0}
      <button
        type="button"
        class="cursor-pointer self-end border-0 bg-transparent p-0 text-[0.68rem] text-text-muted underline-offset-2 hover:text-accent hover:underline"
        data-widget-more
        title={$tr("dashboard.openTab", { label: homeLabel })}
        onclick={() => currentView.set(homeView)}
      >
        {$tr("common.moreCount", { count: String(overflow) })}
      </button>
    {/if}
  {/if}
</section>

<style>
  .dashboard-widget {
    gap: 0.85rem;
    min-height: 150px;
    padding: 1.2rem 1.25rem;
    border: 1px solid var(--ui-panel-border);
    border-radius: var(--radius-xl);
    background: var(--ui-panel-bg);
  }
  .widget-heading {
    padding-bottom: 0.1rem;
  }
  .widget-heading h3 {
    font-size: 0.94rem;
    line-height: 1.35;
    letter-spacing: -0.015em;
  }
  .widget-icon {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 1.9rem;
    height: 1.9rem;
    border-radius: 0.55rem;
    background: color-mix(in srgb, var(--accent) 6%, transparent);
  }
  .widget-icon img {
    width: 1.1rem;
    height: 1.1rem;
    object-fit: contain;
    opacity: 0.85;
  }
  .widget-placeholder {
    min-height: 3.6rem;
    padding: 0.2rem 0;
    font-size: 0.83rem;
    line-height: 1.55;
  }
  .widget-heading :global(button) {
    display: grid;
    place-items: center;
    min-width: 1.65rem;
    min-height: 1.65rem;
    border-color: transparent;
    border-radius: 0.45rem;
  }
  .widget-heading :global(button:hover) {
    border-color: var(--border);
    background: var(--bg-raised);
  }
  @media (max-width: 600px) {
    .dashboard-widget {
      padding: 1rem;
    }
  }
</style>
