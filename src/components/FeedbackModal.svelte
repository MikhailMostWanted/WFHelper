<script lang="ts">
  import { onMount } from "svelte";
  import { FEEDBACK_LIMITS, type FeedbackReport } from "../../config/shared/feedback.js";
  import { invoke } from "../lib/ipc.js";
  import { locale, tr, type MessageKey } from "../lib/i18n.js";
  import { currentView } from "../stores/app.js";
  import { overlaySettings } from "../stores/overlaySettings.js";
  import ModalShell from "./ModalShell.svelte";

  let { onClose }: { onClose: () => void } = $props();
  let kind = $state<FeedbackReport["kind"]>("bug");
  let title = $state("");
  let description = $state("");
  let contact = $state("");
  let includeDiagnostics = $state(false);
  let context = $state<Awaited<ReturnType<typeof loadContext>> | undefined>(undefined);
  let loading = $state(true);
  let sending = $state(false);
  let sent = $state(false);
  let errorKey = $state<MessageKey | null>(null);
  let screenshotError = $state<MessageKey | null>(null);
  let screenshot = $state<FeedbackReport["screenshot"]>(undefined);
  let screenshotName = $state("");
  let readingScreenshot = $state(false);
  let screenshotInput = $state<HTMLInputElement>();
  let imageRequest = 0;
  const logKb = Math.round(FEEDBACK_LIMITS.logChars / 1024);

  const inputClass =
    "w-full rounded-md border border-border bg-bg-deep px-3 py-2 text-sm text-text-primary outline-none focus:border-accent disabled:opacity-60";

  const diagnostics = $derived(
    context
      ? {
          ...context.diagnostics,
          locale: $locale,
          view: $currentView,
          uiScale: $overlaySettings.uiScale,
        }
      : undefined,
  );
  const canSend = $derived(
    !!context && !!title.trim() && !!description.trim() && !sending && !readingScreenshot,
  );

  async function loadContext() {
    return invoke("getFeedbackContext");
  }

  onMount(() => {
    let alive = true;
    void loadContext()
      .then((value) => {
        if (!alive) return;
        context = value;
        if (!value) errorKey = "feedback.errorUnavailable";
      })
      .catch(() => {
        if (alive) errorKey = "feedback.errorUnavailable";
      })
      .finally(() => {
        if (alive) loading = false;
      });
    return () => {
      alive = false;
      imageRequest++;
    };
  });

  function close(): void {
    if (!sending) onClose();
  }

  function removeScreenshot(): void {
    imageRequest++;
    screenshot = undefined;
    screenshotName = "";
    screenshotError = null;
    readingScreenshot = false;
    if (screenshotInput) screenshotInput.value = "";
  }

  async function selectScreenshot(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    removeScreenshot();
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
      file.size === 0 ||
      file.size > FEEDBACK_LIMITS.screenshotBytes
    ) {
      screenshotError = "feedback.screenshotInvalid";
      return;
    }
    const request = ++imageRequest;
    readingScreenshot = true;
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () =>
          typeof reader.result === "string" ? resolve(reader.result) : reject(new Error());
        reader.onerror = () => reject(new Error());
        reader.onabort = () => reject(new Error());
        reader.readAsDataURL(file);
      });
      const image = new Image();
      image.src = dataUrl;
      await image.decode();
      if (request !== imageRequest) return;
      // Send only the reviewed pixels, without the original file's hidden metadata.
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const drawing = canvas.getContext("2d");
      if (!drawing) throw new Error();
      drawing.drawImage(image, 0, 0);
      const prepared = canvas.toDataURL(file.type, 0.92);
      const data = prepared.slice(prepared.indexOf(",") + 1);
      if (atob(data).length > FEEDBACK_LIMITS.screenshotBytes) throw new Error();
      screenshot = {
        mediaType: prepared.slice(5, prepared.indexOf(";")) as NonNullable<
          FeedbackReport["screenshot"]
        >["mediaType"],
        data,
      };
      screenshotName = file.name;
    } catch {
      if (request === imageRequest) screenshotError = "feedback.screenshotInvalid";
    } finally {
      if (request === imageRequest) readingScreenshot = false;
    }
  }

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!canSend || !context) return;
    sending = true;
    errorKey = null;
    const report: FeedbackReport = {
      kind,
      title: title.trim(),
      description: description.trim(),
      appVersion: context.appVersion,
      platform: context.platform,
      ...(contact.trim() ? { contact: contact.trim() } : {}),
      ...(includeDiagnostics && diagnostics ? { diagnostics: { ...diagnostics } } : {}),
      ...(screenshot ? { screenshot: { ...screenshot } } : {}),
    };
    try {
      const result = await invoke("submitFeedback", report);
      if (result?.ok) sent = true;
      else if (result?.error === "unavailable") errorKey = "feedback.errorUnavailable";
      else if (result?.error === "rate_limited") errorKey = "feedback.errorRateLimited";
      else if (result?.error === "invalid") errorKey = "feedback.errorInvalid";
      else errorKey = "feedback.errorFailed";
    } catch {
      errorKey = "feedback.errorFailed";
    } finally {
      sending = false;
    }
  }
</script>

<ModalShell ariaLabel={$tr("feedback.title")} onClose={close}>
  <section
    data-feedback-modal
    class="relative z-[1] flex max-h-[90vh] w-[640px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-border-strong bg-bg-surface"
  >
    <header class="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
      <h2 class="m-0 font-display text-lg font-semibold text-text-primary">
        {$tr("feedback.title")}
      </h2>
      <button
        type="button"
        class="btn-secondary btn-sm"
        data-feedback-close
        disabled={sending}
        onclick={close}>{$tr("common.close")}</button
      >
    </header>
    {#if sent}
      <div class="p-6" data-feedback-success role="status">
        <h3 class="m-0 text-base font-semibold text-accent">{$tr("feedback.sentTitle")}</h3>
        <p class="mb-0 mt-2 text-sm text-text-secondary">{$tr("feedback.sentHint")}</p>
      </div>
    {:else}
      <form class="flex min-h-0 flex-col" onsubmit={submit} data-feedback-form>
        <div data-feedback-scroll class="min-h-0 overflow-y-auto">
          <fieldset disabled={sending} class="m-0 grid min-w-0 gap-4 border-0 p-5">
            <p class="m-0 text-sm text-text-secondary">{$tr("feedback.destination")}</p>
            <div class="grid gap-1.5">
              <label for="feedback-kind" class="text-sm text-text-secondary">
                {$tr("common.type")}
              </label>
              <select id="feedback-kind" data-feedback-kind bind:value={kind} class={inputClass}>
                <option value="bug">{$tr("feedback.bug")}</option>
                <option value="feature">{$tr("feedback.feature")}</option>
              </select>
            </div>
            <div class="grid gap-1.5">
              <label for="feedback-subject" class="text-sm text-text-secondary">
                {$tr("feedback.subject")}
              </label>
              <input
                id="feedback-subject"
                data-feedback-title
                class={inputClass}
                bind:value={title}
                maxlength={FEEDBACK_LIMITS.title}
                required
              />
            </div>
            <div class="grid gap-1.5">
              <label for="feedback-description" class="text-sm text-text-secondary">
                {$tr("feedback.description")}
              </label>
              <textarea
                id="feedback-description"
                data-feedback-description
                class="{inputClass} min-h-28 resize-y"
                bind:value={description}
                rows="4"
                maxlength={FEEDBACK_LIMITS.description}
                placeholder={kind === "bug" ? $tr("feedback.bugHint") : $tr("feedback.featureHint")}
                required></textarea>
            </div>
            <div class="grid gap-1.5">
              <label for="feedback-contact" class="text-sm text-text-secondary">
                {$tr("feedback.contact")}
              </label>
              <input
                id="feedback-contact"
                data-feedback-contact
                class={inputClass}
                bind:value={contact}
                maxlength={FEEDBACK_LIMITS.contact}
              />
            </div>
            <div class="grid gap-2 rounded-lg border border-border bg-bg-deep p-3">
              <h3 class="m-0 text-sm font-medium text-text-primary">
                {$tr("feedback.includedDetails")}
              </h3>
              {#if loading}
                <p class="m-0 text-xs text-text-muted">{$tr("common.loading")}</p>
              {:else if context}
                <dl
                  data-feedback-metadata
                  class="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs"
                >
                  <dt class="text-text-muted">{$tr("statusbar.appVersionTitle")}</dt>
                  <dd class="m-0 text-text-secondary">{context.appVersion}</dd>
                  <dt class="text-text-muted">{$tr("feedback.platform")}</dt>
                  <dd class="m-0 text-text-secondary">{context.platform}</dd>
                </dl>
                <label class="mt-1 flex items-center gap-2 text-sm text-text-secondary">
                  <input
                    type="checkbox"
                    data-feedback-diagnostics
                    bind:checked={includeDiagnostics}
                  />
                  {$tr("feedback.includeDiagnostics")}
                </label>
                {#if includeDiagnostics && diagnostics}
                  <dl
                    data-feedback-diagnostics-preview
                    class="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs"
                  >
                    <dt class="text-text-muted">{$tr("feedback.osVersion")}</dt>
                    <dd class="m-0 break-all text-text-secondary">{diagnostics.osVersion}</dd>
                    <dt class="text-text-muted">{$tr("feedback.architecture")}</dt>
                    <dd class="m-0 text-text-secondary">{diagnostics.arch}</dd>
                    <dt class="text-text-muted">{$tr("settings.languageTitle")}</dt>
                    <dd class="m-0 text-text-secondary">{diagnostics.locale}</dd>
                    <dt class="text-text-muted">{$tr("feedback.currentView")}</dt>
                    <dd class="m-0 text-text-secondary">{diagnostics.view}</dd>
                    <dt class="text-text-muted">{$tr("appearance.appScaleRow")}</dt>
                    <dd class="m-0 text-text-secondary">{diagnostics.uiScale}</dd>
                    <dt class="text-text-muted">{$tr("feedback.logFile")}</dt>
                    <dd class="m-0 text-text-secondary">
                      {$tr("feedback.logTail", { kb: logKb })}
                    </dd>
                  </dl>
                {/if}
              {/if}
              <p class="m-0 text-xs text-text-muted">
                {$tr("feedback.diagnosticsHint", { kb: logKb })}
              </p>
            </div>
            <div class="grid gap-2">
              <label for="feedback-screenshot" class="text-sm text-text-secondary">
                {$tr("feedback.screenshot")}
              </label>
              <input
                id="feedback-screenshot"
                data-feedback-screenshot
                bind:this={screenshotInput}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                class="w-full text-xs text-text-secondary file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-border file:bg-bg-hover file:px-3 file:py-2 file:text-text-primary"
                onchange={(event) => void selectScreenshot(event)}
              />
              <p class="m-0 text-xs text-text-muted">{$tr("feedback.screenshotHint")}</p>
              {#if readingScreenshot}
                <p class="m-0 text-xs text-text-muted">{$tr("common.loading")}</p>
              {/if}
              {#if screenshotError}
                <p role="alert" data-feedback-screenshot-error class="m-0 text-sm text-danger">
                  {$tr(screenshotError)}
                </p>
              {/if}
              {#if screenshot}
                <figure class="m-0 grid gap-2 rounded-lg border border-border p-2">
                  <img
                    data-feedback-screenshot-preview
                    src="data:{screenshot.mediaType};base64,{screenshot.data}"
                    alt={$tr("feedback.screenshotPreview")}
                    class="max-h-52 w-full rounded object-contain"
                  />
                  <figcaption class="flex items-center justify-between gap-3">
                    <span class="truncate text-xs text-text-muted">{screenshotName}</span>
                    <button
                      type="button"
                      data-feedback-screenshot-remove
                      class="btn-secondary btn-sm"
                      onclick={removeScreenshot}>{$tr("market.riven.removeListing")}</button
                    >
                  </figcaption>
                </figure>
              {/if}
            </div>
          </fieldset>
        </div>
        <footer class="grid gap-3 border-t border-border px-5 py-4">
          {#if errorKey}
            <p role="alert" data-feedback-error class="m-0 text-sm text-danger">{$tr(errorKey)}</p>
          {/if}
          <div class="flex justify-end gap-2">
            <button
              type="button"
              class="btn-secondary btn-sm"
              data-feedback-cancel
              disabled={sending}
              onclick={close}>{$tr("common.cancel")}</button
            >
            <button
              type="submit"
              class="btn-primary btn-sm"
              data-feedback-send
              disabled={!canSend}
              aria-busy={sending}>{sending ? $tr("feedback.sending") : $tr("feedback.send")}</button
            >
          </div>
        </footer>
      </form>
    {/if}
  </section>
</ModalShell>
