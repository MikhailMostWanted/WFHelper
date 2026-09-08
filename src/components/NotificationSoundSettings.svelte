<script lang="ts">
  import { onMount } from "svelte";
  import {
    normalizeNotificationVolume,
    type NotificationSoundAsset,
  } from "../../config/shared/notificationSound.js";
  import { tr, type MessageKey } from "../lib/i18n.js";
  import { invoke } from "../lib/ipc.js";
  import { previewNotificationSound, stopNotificationSound } from "../lib/notificationSound.js";
  import { prepareNotificationSound } from "../lib/notificationSoundFile.js";

  let {
    enabled,
    system,
    volume,
    onVolumeChange,
  }: {
    enabled: boolean;
    system: boolean;
    volume: number;
    onVolumeChange: (volume: number) => void;
  } = $props();

  let sound = $state<NotificationSoundAsset | null>(null);
  let loading = $state(true);
  let pending = $state(false);
  let previewing = $state(false);
  let errorKey = $state<MessageKey | null>(null);
  let loadFailed = $state(false);
  let sliderPercent = $state<number | null>(null);
  let fileInput = $state<HTMLInputElement>();
  let alive = true;
  let previewRequest = 0;
  const disabled = $derived(!enabled || system || loading || pending);
  const percent = $derived(sliderPercent ?? Math.round(normalizeNotificationVolume(volume) * 100));

  function stopPreview(): void {
    previewRequest++;
    previewing = false;
    stopNotificationSound();
  }

  onMount(() => {
    void invoke("getNotificationSound")
      .then((value) => {
        if (alive) sound = value;
      })
      .catch(() => {
        if (alive) {
          loadFailed = true;
          errorKey = "settings.notificationSoundLoadFailed";
        }
      })
      .finally(() => {
        if (alive) loading = false;
      });
    return () => {
      alive = false;
      stopPreview();
    };
  });

  $effect(() => {
    if (!enabled || system) stopPreview();
  });

  async function chooseSound(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file || disabled) return;
    stopPreview();
    pending = true;
    errorKey = null;
    let prepared: Awaited<ReturnType<typeof prepareNotificationSound>>;
    try {
      prepared = await prepareNotificationSound(file);
    } catch {
      if (alive) {
        errorKey = "settings.notificationSoundInvalid";
        pending = false;
      }
      return;
    }
    if (!alive) return;
    try {
      const saved = await invoke("saveNotificationSound", prepared);
      if (alive) sound = saved;
    } catch {
      if (alive) errorKey = "settings.notificationSoundSaveFailed";
    } finally {
      if (alive) pending = false;
    }
  }

  async function reset(): Promise<void> {
    if (loading || pending || (!sound && !loadFailed)) return;
    stopPreview();
    pending = true;
    errorKey = null;
    try {
      await invoke("resetNotificationSound");
      if (alive) {
        sound = null;
        loadFailed = false;
      }
    } catch {
      if (alive) errorKey = "settings.notificationSoundSaveFailed";
    } finally {
      if (alive) pending = false;
    }
  }

  async function preview(): Promise<void> {
    if (disabled || previewing) return;
    const request = ++previewRequest;
    previewing = true;
    errorKey = null;
    try {
      await previewNotificationSound(sound, volume);
    } catch {
      if (alive && request === previewRequest) {
        errorKey = "settings.notificationSoundPreviewFailed";
      }
    } finally {
      if (alive && request === previewRequest) previewing = false;
    }
  }

  function slideVolume(event: Event): void {
    sliderPercent = Number((event.currentTarget as HTMLInputElement).value);
  }

  // The slider only persists on change; every input event would be an atomic write.
  function changeVolume(event: Event): void {
    sliderPercent = null;
    if (disabled) return;
    stopPreview();
    onVolumeChange(Number((event.currentTarget as HTMLInputElement).value) / 100);
  }
</script>

<div class="flex flex-col gap-3 py-3" data-notification-sound-settings>
  <div class="flex flex-wrap items-center justify-between gap-3">
    <div class="min-w-0 flex-1">
      <div class="text-sm text-text-primary">{$tr("settings.notificationCustomSound")}</div>
      <div
        class="mt-1 truncate text-xs text-text-muted"
        title={sound?.name}
        data-notification-sound-name
      >
        {loading ? $tr("common.loading") : (sound?.name ?? $tr("common.default"))}
      </div>
    </div>
    <div class="flex items-center gap-2">
      <input
        bind:this={fileInput}
        class="hidden"
        type="file"
        accept=".wav,.mp3,.ogg,audio/wav,audio/mpeg,audio/ogg"
        aria-label={$tr("settings.notificationSoundChoose")}
        data-setting="notification-sound-file"
        {disabled}
        onchange={chooseSound}
      />
      <button
        type="button"
        class="btn-secondary btn-sm"
        data-setting="notification-sound-choose"
        {disabled}
        onclick={() => fileInput?.click()}>{$tr("settings.notificationSoundChoose")}</button
      >
      <button
        type="button"
        class="btn-secondary btn-sm"
        data-setting="notification-sound-reset"
        disabled={loading || pending || (!sound && !loadFailed)}
        onclick={reset}>{$tr("common.reset")}</button
      >
    </div>
  </div>
  <p class="text-xs text-text-muted">{$tr("settings.notificationSoundFileHint")}</p>
  <div class="flex flex-wrap items-center gap-3">
    <label for="notification-sound-volume" class="text-sm text-text-primary">
      {$tr("settings.notificationSoundVolume")}
    </label>
    <input
      id="notification-sound-volume"
      type="range"
      min="0"
      max="100"
      step="1"
      value={percent}
      oninput={slideVolume}
      onchange={changeVolume}
      {disabled}
      data-setting="notification-sound-volume"
      class="min-w-24 flex-1 accent-accent disabled:opacity-50"
    />
    <output for="notification-sound-volume" class="w-10 text-right text-xs text-text-muted">
      {percent}%
    </output>
    <button
      type="button"
      class="btn-secondary btn-sm"
      data-setting="notification-sound-preview"
      disabled={disabled || previewing}
      onclick={preview}>{$tr("settings.notificationSoundPreview")}</button
    >
  </div>
  {#if errorKey}
    <p role="alert" class="text-xs text-danger" data-notification-sound-error>{$tr(errorKey)}</p>
  {/if}
</div>
