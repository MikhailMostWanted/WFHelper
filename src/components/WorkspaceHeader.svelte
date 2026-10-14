<script lang="ts">
  import { currentView, settingsTabRequest } from "../stores/app.js";
  import { launcherOpen } from "../stores/launcher.js";
  import { locale, tr } from "../lib/i18n.js";
  import { VIEW_LABEL_KEYS } from "../lib/viewRegistry.js";

  const purposes: Record<string, [string, string]> = {
    dashboard: ["Твой игровой пульт", "Your Warframe workspace"],
    inventory: ["Всё, чем ты владеешь", "Everything you own"],
    market: ["Торговля под твоим контролем", "Your trading desk"],
    relics: ["Выбери следующую награду", "Plan your next reward"],
    rivens: ["Моды, роллы и потенциал", "Mods, rolls and potential"],
    foundry: ["От ресурсов к готовому снаряжению", "From resources to equipment"],
    mastery: ["Следующий шаг твоей коллекции", "Your collection's next step"],
    world: ["Что происходит сейчас", "What's happening now"],
    settings: ["Сделай WantedFrame своим", "Make WantedFrame yours"],
    analytics: ["Результат твоей торговли", "Understand your trading"],
    stats: ["Прогресс и история", "Progress and history"],
    arbi: ["Разбор твоих забегов", "Understand your runs"],
    syndicates: ["Репутация и дневные лимиты", "Standing and daily limits"],
    wiki: ["Найди то, что нужно", "Find what you need"],
  };
  $: purpose = purposes[$currentView]?.[$locale === "ru" ? 0 : 1] ?? "WantedFrame";
  function openChatGPT(): void {
    settingsTabRequest.set("chatgpt");
    currentView.set("settings");
  }
</script>

<div class="workspace-header" data-workspace-header>
  <div class="workspace-location">
    <span class="workspace-eyebrow">WANTED / {$tr(VIEW_LABEL_KEYS[$currentView])}</span>
    <p>{purpose}</p>
  </div>
  <div class="workspace-tools">
    <button
      type="button"
      class="workspace-search"
      data-launcher-open
      aria-label={$locale === "ru"
        ? "Быстрый переход по разделам · Ctrl+K"
        : "Quick section launcher · Ctrl+K"}
      on:click={() => launcherOpen.set(true)}
    >
      <span>{$locale === "ru" ? "Куда отправимся?" : "Where to next?"}</span>
      <kbd>Ctrl K</kbd>
    </button>
    <button
      type="button"
      class="workspace-account"
      on:click={openChatGPT}
      title="ChatGPT"
      aria-label={$locale === "ru"
        ? "Аккаунт Михаила и данные для ChatGPT"
        : "Mikhail's account and ChatGPT data"}
    >
      <span class="workspace-avatar">М</span>
      <span><strong>{$locale === "ru" ? "Михаил" : "Mikhail"}</strong><small>ChatGPT ↗</small></span
      >
    </button>
  </div>
</div>

<style>
  .workspace-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1.5rem;
    padding: 1.1rem var(--content-gutter);
    border-bottom: 1px solid var(--border);
    background: var(--bg-deep);
    flex-shrink: 0;
    min-height: 5.25rem;
    box-sizing: border-box;
  }
  .workspace-eyebrow {
    font-size: 0.65rem;
    font-weight: 650;
    letter-spacing: 0.14em;
    color: var(--text-muted);
  }
  .workspace-location p {
    margin: 0.22rem 0 0;
    font-size: 0.92rem;
    font-weight: 500;
    color: var(--text-secondary);
  }
  .workspace-tools {
    display: flex;
    align-items: center;
    gap: 1.3rem;
    min-width: 0;
  }
  .workspace-search {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 2rem;
    min-width: 17rem;
    padding: 0.7rem 0.85rem;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 0.65rem;
    color: var(--text-secondary);
    font-size: 0.8rem;
    cursor: pointer;
    transition: border-color 0.15s;
  }
  .workspace-search:hover {
    border-color: var(--border-strong);
    color: var(--text-primary);
  }
  kbd {
    font-family: inherit;
    font-size: 0.63rem;
    color: var(--text-muted);
    border: 1px solid var(--border);
    padding: 0.12rem 0.35rem;
    border-radius: 0.25rem;
  }
  .workspace-account {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    background: none;
    border: 0;
    text-align: left;
    color: var(--text-primary);
    cursor: pointer;
  }
  .workspace-avatar {
    display: grid;
    place-items: center;
    width: 2.4rem;
    height: 2.4rem;
    border-radius: 50%;
    background: var(--accent-glow);
    border: 1px solid var(--border-strong);
    color: var(--accent);
    font-size: 0.9rem;
    font-weight: 600;
  }
  .workspace-account strong,
  .workspace-account small {
    display: block;
  }
  .workspace-account strong {
    font-size: 0.8rem;
    font-weight: 550;
  }
  .workspace-account small {
    font-size: 0.65rem;
    color: var(--text-muted);
    margin-top: 0.1rem;
  }
  @media (max-width: 1000px) {
    .workspace-search {
      min-width: 0;
      gap: 1rem;
    }
    .workspace-account > span:last-child {
      display: none;
    }
  }
  @media (max-width: 650px) {
    .workspace-header {
      padding: 0.75rem 1rem;
      gap: 0.7rem;
    }
    .workspace-tools {
      gap: 0.5rem;
    }
    .workspace-search span {
      display: none;
    }
    .workspace-search {
      padding: 0.6rem;
    }
    .workspace-location p {
      font-size: 0.8rem;
    }
    .workspace-eyebrow {
      font-size: 0.58rem;
    }
  }
</style>
