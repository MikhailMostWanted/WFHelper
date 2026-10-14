<script lang="ts">
  import { themeSettings } from "../../stores/theme.js";
  import { locale } from "../../lib/i18n.js";
  import { sidebarWidth, SIDEBAR_RAIL_WIDTH } from "../../stores/sidebarTabs.js";
  import { rivenCardSize } from "../../stores/rivenCardSize.js";
  let saved = false;
  $: ru = $locale === "ru";
  $: active = $themeSettings.activePreset === "wantedMikhail";
  function apply(): void {
    if (active) return;
    if (
      !saved &&
      !$themeSettings.customThemes.some((theme) => theme.label === "До Wanted · Михаил")
    ) {
      themeSettings.saveCustomTheme("До Wanted · Михаил");
      saved = true;
    }
    themeSettings.applyPreset("wantedMikhail");
    sidebarWidth.set(SIDEBAR_RAIL_WIDTH);
    rivenCardSize.set("compact");
  }
</script>

<article class="wanted-appearance" data-wanted-appearance>
  <div>
    <span>WANTED / PERSONAL</span>
    <h3>{ru ? "Твоё оформление, Михаил" : "Your workspace, Mikhail"}</h3>
    <p>
      {ru
        ? "Графит, тёплое золото и Onest. Читаемые данные и свободное пространство."
        : "Graphite, warm gold and Onest. Clear data with room to breathe."}
    </p>
    <small
      >{ru
        ? "Текущую тему сохраним в списке тем — сможешь вернуться к ней."
        : "Your current theme stays in the theme list, ready to restore."}</small
    >
  </div>
  <button
    class="btn-primary"
    type="button"
    data-apply-wanted-appearance
    on:click={apply}
    disabled={active}
    >{active
      ? ru
        ? "Твоё оформление активно"
        : "Your appearance is active"
      : ru
        ? "Применить оформление"
        : "Apply appearance"}</button
  >
</article>

<style>
  .wanted-appearance {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 2rem;
    padding: 1.6rem;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-xl);
    background: linear-gradient(120deg, var(--accent-glow), var(--bg-surface) 70%);
  }
  span {
    font-size: 0.63rem;
    color: var(--accent);
    letter-spacing: 0.15em;
    font-weight: 650;
  }
  h3 {
    font-size: 1.4rem;
    font-weight: 550;
    margin: 0.6rem 0;
  }
  p {
    font-size: 0.9rem;
    color: var(--text-secondary);
    margin: 0.4rem 0;
  }
  small {
    display: block;
    font-size: 0.72rem;
    color: var(--text-muted);
    margin-top: 0.65rem;
  }
  button {
    flex-shrink: 0;
  }
  @media (max-width: 1000px) {
    .wanted-appearance {
      align-items: flex-start;
      flex-direction: column;
      gap: 1rem;
    }
  }
</style>
