<script module lang="ts">
  import { registerSections } from "../lib/layout/registry.js";
  import { dashboardSectionDescriptors } from "../lib/widgets/registry.js";

  // Module scope so the dashboard's sections exist for the layout store and the
  // edit bar the moment this view's module loads, before the component mounts.
  registerSections("dashboard", dashboardSectionDescriptors());
</script>

<script lang="ts">
  import { onMount } from "svelte";

  import EditLayoutBar from "../components/layout/EditLayoutBar.svelte";
  import LayoutGrid from "../components/layout/LayoutGrid.svelte";
  import BaroWidget from "../components/widgets/BaroWidget.svelte";
  import CyclesWidget from "../components/widgets/CyclesWidget.svelte";
  import FissuresWidget from "../components/widgets/FissuresWidget.svelte";
  import FoundryReadyWidget from "../components/widgets/FoundryReadyWidget.svelte";
  import GoalsWidget from "../components/widgets/GoalsWidget.svelte";
  import InventoryValueWidget from "../components/widgets/InventoryValueWidget.svelte";
  import MarketAlertsWidget from "../components/widgets/MarketAlertsWidget.svelte";
  import RecentRunsWidget from "../components/widgets/RecentRunsWidget.svelte";
  import TradeSummaryWidget from "../components/widgets/TradeSummaryWidget.svelte";
  import AccountPulse from "../components/widgets/AccountPulse.svelte";
  import { tr, locale } from "../lib/i18n.js";
  import { NAV_ICON_URLS } from "../lib/assetUrls.js";
  import { VIEW_LABEL_KEYS } from "../lib/viewRegistry.js";
  import { dashboardDesignCopy } from "../lib/dashboardDesignCopy.js";
  import { currentView } from "../stores/app.js";
  import { clockStore } from "../lib/timers.js";
  import { COARSE_CLOCK_MS, mountWorldPolling } from "../lib/world/useWorldView.js";

  // The view owns the clocks and hands the tick down, so no widget starts a
  // timer of its own and nine panels share two intervals.
  const nowClock = clockStore(1000);
  const coarseClock = clockStore(COARSE_CLOCK_MS);
  const quickRoutes = [
    { view: "inventory", hint: "inventoryHint" },
    { view: "relics", hint: "relicsHint" },
    { view: "foundry", hint: "foundryHint" },
    { view: "market", hint: "marketHint" },
  ] as const;
  $: copy = dashboardDesignCopy($locale);

  // The world widgets need world state without the World tab being opened; the
  // helper is refcounted.
  onMount(() => mountWorldPolling());
</script>

<section class="view active dashboard-home">
  <div class="dashboard-shell">
    <header class="home-heading">
      <span class="eyebrow">{copy.workspace}</span>
      <h2>{copy.dashboardTitle}</h2>
      <p>{copy.dashboardLead}</p>
    </header>

    <div class="launch-deck">
      <section class="main-launch" aria-label={copy.launchLabel}>
        <svg class="orbital-decoration" viewBox="0 0 200 200" fill="none" aria-hidden="true">
          <circle cx="100" cy="100" r="78" /><circle cx="100" cy="100" r="58" />
          <path d="M18 100h164M100 18v164M42 42l116 116M42 158 158 42" />
          <circle cx="100" cy="100" r="5" />
        </svg>
        <div class="launch-intro">
          <span class="eyebrow">{copy.launchLabel}</span>
          <h3>{copy.launchTitle}</h3>
          <p>{copy.launchLead}</p>
        </div>
        <div class="quick-routes">
          {#each quickRoutes as route (route.view)}
            <button
              type="button"
              class="quick-route"
              data-dashboard-quick={route.view}
              on:click={() => currentView.set(route.view)}
            >
              <span class="route-icon"><img src={NAV_ICON_URLS[route.view]} alt="" /></span>
              <span class="route-copy"
                ><strong>{$tr(VIEW_LABEL_KEYS[route.view])}</strong><span>{copy[route.hint]}</span
                ></span
              >
              <span class="route-arrow" aria-hidden="true">↗</span>
            </button>
          {/each}
        </div>
      </section>
      <AccountPulse />
    </div>

    <div class="feed-heading">
      <div>
        <span class="eyebrow">{copy.feedLabel}</span>
        <h3>{copy.feedTitle}</h3>
        <p>{copy.feedHint}</p>
      </div>
      <EditLayoutBar view="dashboard" />
    </div>

    <LayoutGrid
      view="dashboard"
      wideTemplate="minmax(0, 1.18fr) minmax(0, 0.82fr)"
      gapClass="gap-4"
      columnGapClass="gap-4"
      let:sectionId
    >
      {#if sectionId === "dashboard.cycles"}
        <CyclesWidget nowMs={$nowClock} nowCoarseMs={$coarseClock} />
      {:else if sectionId === "dashboard.fissures"}
        <FissuresWidget nowMs={$nowClock} nowCoarseMs={$coarseClock} />
      {:else if sectionId === "dashboard.foundryReady"}
        <FoundryReadyWidget nowCoarseMs={$coarseClock} />
      {:else if sectionId === "dashboard.marketAlerts"}
        <MarketAlertsWidget />
      {:else if sectionId === "dashboard.goals"}
        <GoalsWidget />
      {:else if sectionId === "dashboard.baro"}
        <BaroWidget nowMs={$nowClock} nowCoarseMs={$coarseClock} />
      {:else if sectionId === "dashboard.inventoryValue"}
        <InventoryValueWidget />
      {:else if sectionId === "dashboard.tradeSummary"}
        <TradeSummaryWidget />
      {:else if sectionId === "dashboard.recentRuns"}
        <RecentRunsWidget />
      {/if}
    </LayoutGrid>
  </div>
</section>

<style>
  .dashboard-shell {
    display: flex;
    flex-direction: column;
    gap: 1.6rem;
    width: 100%;
    max-width: 1440px;
    margin: 0 auto;
    padding: 0.3rem 0 1.5rem;
  }
  .home-heading h2 {
    margin: 0.25rem 0 0.35rem;
    color: var(--text-primary);
    font-family: var(--font-display);
    font-size: clamp(1.65rem, 3vw, 2.25rem);
    font-weight: 600;
    letter-spacing: -0.035em;
    line-height: 1.15;
  }
  .home-heading p,
  .feed-heading p {
    margin: 0;
    color: var(--text-secondary);
    font-size: 0.9rem;
    line-height: 1.5;
  }
  .eyebrow {
    color: var(--text-muted);
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.15em;
  }
  .launch-deck {
    display: grid;
    grid-template-columns: minmax(0, 1.3fr) minmax(300px, 0.8fr);
    gap: 1rem;
    align-items: stretch;
  }
  .main-launch {
    position: relative;
    overflow: hidden;
    min-width: 0;
    padding: 1.6rem;
    border: 1px solid var(--ui-panel-border);
    border-radius: var(--radius-xl);
    background: linear-gradient(
      135deg,
      color-mix(in srgb, var(--accent) 5%, var(--ui-panel-bg)),
      var(--ui-panel-bg) 66%
    );
  }
  .orbital-decoration {
    position: absolute;
    right: -1rem;
    top: -2rem;
    width: 15rem;
    height: 15rem;
    color: var(--accent);
    opacity: 0.08;
    stroke: currentColor;
    stroke-width: 0.7;
    pointer-events: none;
    transform: rotate(-20deg);
  }
  .launch-intro {
    position: relative;
    margin-bottom: 1.5rem;
  }
  .launch-intro .eyebrow {
    color: var(--accent);
  }
  .launch-intro h3 {
    margin: 0.5rem 0 0.6rem;
    color: var(--text-primary);
    font-family: var(--font-display);
    font-size: clamp(1.3rem, 2vw, 1.75rem);
    font-weight: 500;
    letter-spacing: -0.03em;
    line-height: 1.2;
  }
  .launch-intro p {
    margin: 0;
    max-width: 30rem;
    color: var(--text-secondary);
    font-size: 0.88rem;
    line-height: 1.55;
  }
  .quick-routes {
    position: relative;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.65rem;
  }
  .quick-route {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    min-width: 0;
    padding: 0.9rem 0.85rem;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    background: color-mix(in srgb, var(--bg-base) 46%, transparent);
    color: var(--text-primary);
    cursor: pointer;
    text-align: left;
    transition:
      border-color 150ms ease,
      background 150ms ease;
  }
  .quick-route:hover {
    border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
    background: color-mix(in srgb, var(--accent) 7%, var(--bg-base));
  }
  .quick-route:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
  }
  .route-icon {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 2rem;
    height: 2rem;
    border-radius: 0.6rem;
    background: color-mix(in srgb, var(--accent) 7%, transparent);
  }
  .route-icon img {
    width: 1.25rem;
    height: 1.25rem;
    object-fit: contain;
    opacity: 0.85;
  }
  .route-copy {
    min-width: 0;
  }
  .route-copy strong {
    display: block;
    margin-bottom: 0.2rem;
    font-size: 0.9rem;
    font-weight: 600;
  }
  .route-copy > span {
    display: block;
    color: var(--text-muted);
    font-size: 0.73rem;
    line-height: 1.4;
  }
  .route-arrow {
    margin-left: auto;
    color: var(--text-muted);
    font-size: 1rem;
  }
  .feed-heading {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    justify-content: space-between;
    gap: 1rem;
    padding-top: 0.4rem;
  }
  .feed-heading h3 {
    margin: 0.25rem 0 0.3rem;
    color: var(--text-primary);
    font-size: 1.2rem;
    font-weight: 500;
    letter-spacing: -0.02em;
  }
  .feed-heading p {
    font-size: 0.8rem;
    color: var(--text-muted);
  }
  @media (max-width: 1050px) {
    .launch-deck {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  @media (max-width: 600px) {
    .main-launch {
      padding: 1.15rem;
    }
    .quick-routes {
      grid-template-columns: minmax(0, 1fr);
    }
    .dashboard-shell {
      gap: 1.25rem;
    }
  }
</style>
