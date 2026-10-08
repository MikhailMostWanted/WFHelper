<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "../../lib/ipc.js";
  import type { IpcInvokeMap } from "../../types/ipc.js";
  let status = $state<IpcInvokeMap["getAccountSnapshotStatus"]["return"] | null>(null);
  let message = $state("");
  let busy = $state(false);
  async function refresh() {
    try { status = await invoke("getAccountSnapshotStatus"); }
    catch { message = "Не удалось прочитать состояние снимка"; }
  }
  onMount(() => { void refresh(); });
  async function exportSnapshot() {
    busy = true;
    try {
      const result = await invoke("exportAccountSnapshot");
      message = result.saved ? "Снимок сохранён. Его можно передать в ChatGPT." : "Сохранение не выполнено";
    } catch { message = "Не удалось сохранить снимок"; }
    finally { busy = false; }
  }
</script>
<section class="snapshot-card">
  <h3>Аккаунт · WantedFrame</h3>
  <p>Инвентарь, количества, конфигурации снаряжения, моды, осколки и прогресс из последнего доступного снимка. Неизвестное не заменяется нулём.</p>
  {#if status?.updatedAt}
    <p>Данные от {new Date(status.updatedAt).toLocaleString("ru-RU")} · записей: {status.rows}</p>
  {:else}<p>Ожидается снимок от выбранного источника инвентаря.</p>{/if}
  {#if status?.error}<p role="status">{status.error}</p>{/if}
  <div class="snapshot-actions">
    <button class="btn-secondary btn-sm" onclick={refresh}>Обновить состояние</button>
    <button class="btn-primary btn-sm" disabled={busy || status?.rows == null} onclick={exportSnapshot}>Экспорт для ChatGPT</button>
  </div>
  {#if message}<p role="status">{message}</p>{/if}
  <details><summary>Что удалось получить</summary>
    {#each status?.coverage ?? [] as section}
      <p>{section.section}: {section.status === "absent" ? "источник не предоставил данные" : `${section.rows} записей`}{section.status === "partial" ? " (неполные данные)" : ""}</p>
    {/each}
  </details>
  <p>Снимок хранится локально. Автоматической отправки на сервер в этой версии нет. Игровые пароли и данные входа не экспортируются.</p>
</section>
<style>
  .snapshot-card { padding: 18px; border: 1px solid var(--border); border-radius: 12px; }
  h3 { margin: 0 0 10px; font-weight: 600; }
  p { margin: 8px 0; color: var(--text-secondary); line-height: 1.45; }
  .snapshot-actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0; }
  summary { cursor: pointer; }
</style>
