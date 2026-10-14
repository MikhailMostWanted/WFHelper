<script lang="ts">
  import { tick } from "svelte";
  import ModalShell from "./ModalShell.svelte";
  import { currentView, settingsTabRequest, type SettingsTab } from "../stores/app.js";
  import { launcherOpen, recentViews, rememberView } from "../stores/launcher.js";
  import { hiddenTabs, sidebarLabels, sidebarOrder } from "../stores/sidebarTabs.js";
  import { locale, tr } from "../lib/i18n.js";
  import { VIEW_LABEL_KEYS, type SidebarViewName } from "../lib/viewRegistry.js";
  import { NAV_ICON_URLS } from "../lib/assetUrls.js";

  interface Destination {
    id: string;
    view: SidebarViewName;
    tab?: SettingsTab;
    label: string;
    hint: string;
    keywords: string;
  }
  let query = "";
  let selected = 0;
  let input: HTMLInputElement;
  $: ru = $locale === "ru";
  $: routes = $sidebarOrder
    .filter((view) => !$hiddenTabs.has(view))
    .map(
      (view): Destination => ({
        id: view,
        view,
        label: $sidebarLabels[view] ?? $tr(VIEW_LABEL_KEYS[view]),
        hint:
          view === "market"
            ? ru
              ? "Цены, ордера, торговля"
              : "Prices, orders, trading"
            : view === "inventory"
              ? ru
                ? "Ресурсы, моды, снаряжение"
                : "Resources, mods, equipment"
              : view === "relics"
                ? ru
                  ? "Награды и планирование"
                  : "Rewards and planning"
                : "WantedFrame",
        keywords:
          view +
          " " +
          (view === "inventory"
            ? "ресурс resource мод mods weapon оружие"
            : view === "market"
              ? "цена price платина platinum ордер order торговля"
              : view === "rivens"
                ? "ролл roll riven разлом"
                : ""),
      }),
    );
  $: destinations = [
    {
      id: "chatgpt",
      view: "settings",
      tab: "chatgpt",
      label: ru ? "Мой аккаунт в ChatGPT" : "My account in ChatGPT",
      hint: ru ? "Данные и синхронизация" : "Data and synchronization",
      keywords: "чат chatgpt снимок snapshot экспорт export подключение connect",
    },
    {
      id: "overlays",
      view: "settings",
      tab: "overlay",
      label: ru ? "Игровые оверлеи" : "Game overlays",
      hint: ru ? "Награды, Разломы, горячие клавиши" : "Rewards, Rivens, shortcuts",
      keywords: "оверлей overlay f7 f6",
    },
    {
      id: "appearance",
      view: "settings",
      tab: "appearance",
      label: ru ? "Моё оформление" : "My appearance",
      hint: ru ? "Тема, шрифт, масштаб" : "Theme, font, scale",
      keywords: "theme шрифт font дизайн design",
    },
    ...routes,
  ] as Destination[];
  $: filtered = destinations.filter((item) =>
    `${item.label} ${item.keywords} ${item.hint}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  $: if (selected >= filtered.length) selected = Math.max(0, filtered.length - 1);
  $: recent = $recentViews
    .map((view) => routes.find((item) => item.view === view))
    .filter((item): item is Destination => !!item);
  function close(): void {
    launcherOpen.set(false);
  }
  function go(item: Destination): void {
    if (item.tab) settingsTabRequest.set(item.tab);
    rememberView(item.view);
    currentView.set(item.view);
    close();
  }
  async function onKey(e: KeyboardEvent): Promise<void> {
    if (e.isComposing) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      selected = filtered.length
        ? (selected + (e.key === "ArrowDown" ? 1 : -1) + filtered.length) % filtered.length
        : 0;
      await tick();
      document
        .querySelector('[data-command-selected="true"]')
        ?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter" && filtered[selected]) {
      e.preventDefault();
      go(filtered[selected]);
    }
  }
</script>

<ModalShell
  ariaLabel={ru ? "Быстрый переход" : "Quick launcher"}
  onClose={close}
  initialFocus={() => input}
  overlayClass="wanted-launcher-overlay"
>
  <section class="command-launcher" data-command-launcher>
    <header>
      <span>WANTED / {ru ? "БЫСТРЫЙ ПЕРЕХОД" : "QUICK LAUNCHER"}</span><button
        type="button"
        on:click={close}
        aria-label={ru ? "Закрыть" : "Close"}>Esc</button
      >
    </header>
    <input
      bind:this={input}
      bind:value={query}
      on:input={() => (selected = 0)}
      on:keydown={onKey}
      placeholder={ru
        ? "Раздел, ресурс, рынок или ChatGPT…"
        : "Section, resource, market or ChatGPT…"}
      aria-label={ru ? "Поиск раздела" : "Search sections"}
      autocomplete="off"
    />
    {#if !query && recent.length}
      <div class="command-recent">
        <span>{ru ? "Недавние" : "Recent"}</span>{#each recent as item}<button
            type="button"
            on:click={() => go(item)}>{item.label}</button
          >{/each}
      </div>
    {/if}
    <span class="sr-only" aria-live="polite" aria-atomic="true"
      >{filtered[selected]?.label ?? (ru ? "Ничего не найдено" : "No results")}</span
    >
    <div class="command-results">
      {#each filtered as item, index (item.id)}
        <button
          type="button"
          class="command-row"
          data-command-selected={index === selected}
          on:click={() => go(item)}
          on:mouseenter={() => (selected = index)}
        >
          <img src={NAV_ICON_URLS[item.view]} alt="" />
          <span><strong>{item.label}</strong><small>{item.hint}</small></span>
          <span class="command-enter">↵</span>
        </button>
      {:else}<p class="command-empty">
          {ru
            ? "Ничего не найдено. Попробуй «рынок», «ресурсы» или «оверлеи»."
            : "Nothing found. Try market, resources or overlays."}
        </p>{/each}
    </div>
    <footer>
      <span>↑ ↓ {ru ? "выбрать" : "select"} · Enter {ru ? "открыть" : "open"}</span><span
        >Ctrl K</span
      >
    </footer>
  </section>
</ModalShell>

<style>
  .command-launcher {
    width: min(39rem, calc(100vw - 3rem));
    overflow: hidden;
    background: var(--bg-surface);
    border: 1px solid var(--border-strong);
    border-radius: 1.1rem;
    box-shadow: 0 28px 100px #0008;
    color: var(--text-primary);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.2rem 0.5rem;
    font-size: 0.62rem;
    letter-spacing: 0.14em;
    color: var(--text-muted);
  }
  header button {
    border: 1px solid var(--border);
    background: var(--bg-raised);
    color: var(--text-muted);
    font-size: 0.65rem;
    padding: 0.2rem 0.45rem;
    border-radius: 0.3rem;
    cursor: pointer;
    letter-spacing: 0;
  }
  input {
    width: 100%;
    box-sizing: border-box;
    border: 0;
    border-bottom: 1px solid var(--border);
    background: none;
    color: var(--text-primary);
    font-size: 1.25rem;
    padding: 0.7rem 1.2rem 1.1rem;
    outline: none;
  }
  input::placeholder {
    color: var(--text-muted);
    font-size: 1.05rem;
  }
  .command-recent {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
    padding: 0.8rem 1.2rem 0;
    font-size: 0.68rem;
    color: var(--text-muted);
  }
  .command-recent > span {
    margin-right: 0.4rem;
  }
  .command-recent button {
    border: 1px solid var(--border);
    border-radius: 0.4rem;
    background: var(--bg-raised);
    color: var(--text-secondary);
    padding: 0.25rem 0.5rem;
    cursor: pointer;
    font-size: 0.67rem;
  }
  .command-results {
    padding: 0.6rem;
    max-height: min(27rem, 50vh);
    overflow: auto;
  }
  .command-row {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    width: 100%;
    text-align: left;
    background: none;
    border: 1px solid transparent;
    border-radius: 0.65rem;
    color: var(--text-primary);
    padding: 0.7rem;
    cursor: pointer;
  }
  .command-row[data-command-selected="true"],
  .command-row:focus-visible {
    background: var(--accent-glow);
    border-color: var(--border-strong);
  }
  .command-row img {
    width: 1.55rem;
    height: 1.55rem;
    object-fit: contain;
    opacity: 0.8;
  }
  .command-row strong,
  .command-row small {
    display: block;
  }
  .command-row strong {
    font-size: 0.88rem;
    font-weight: 550;
  }
  .command-row small {
    color: var(--text-muted);
    font-size: 0.7rem;
    margin-top: 0.17rem;
  }
  .command-enter {
    margin-left: auto;
    color: var(--accent);
    opacity: 0;
  }
  .command-row[data-command-selected="true"] .command-enter {
    opacity: 1;
  }
  footer {
    display: flex;
    justify-content: space-between;
    padding: 0.8rem 1.2rem;
    background: var(--bg-base);
    border-top: 1px solid var(--border);
    font-size: 0.65rem;
    color: var(--text-muted);
  }
  .command-empty {
    padding: 1.5rem;
    font-size: 0.85rem;
    color: var(--text-secondary);
  }
</style>
