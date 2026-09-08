<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { REWARD_OVERLAY_CANVAS } from "../../config/shared/rewardOverlayLayout.js";
  import type {
    RewardOverlayEditCommand,
    RewardOverlayEditState,
  } from "../../config/shared/rewardOverlayLayout.js";
  import type { IpcInvokeMap } from "../types/ipc.js";
  import { invoke } from "../lib/ipc.js";
  import { locale, tr } from "../lib/i18n.js";

  let {
    state: editState,
    onCommand,
    onCancel,
  }: {
    state: RewardOverlayEditState;
    onCommand: (command: RewardOverlayEditCommand) => Promise<RewardOverlayEditState | undefined>;
    onCancel: () => void;
  } = $props();
  let frame = $state<HTMLIFrameElement>();
  let context = $state<IpcInvokeMap["getRewardOverlayPreview"]["return"]>();
  let width = $state(900);
  let failed = $state(false);
  let flushId = 0;
  let pendingFlush: {
    id: number;
    resolve: () => void;
    reject: () => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  export function flush(): Promise<void> {
    if (!frame?.contentWindow) return Promise.resolve();
    if (pendingFlush) return Promise.reject(new Error("Preview flush already pending"));
    const id = ++flushId;
    return new Promise((resolve, reject) => {
      const fail = () => reject(new Error("Could not finish preview updates"));
      const timer = setTimeout(() => {
        pendingFlush = null;
        fail();
      }, 7000);
      pendingFlush = { id, resolve, reject: fail, timer };
      frame?.contentWindow?.postMessage({ type: "reward-preview-flush", id }, "*");
    });
  }
  // Fit the whole overlay into the canvas at any reward size; it only grows past the fit
  // when the panel is wide enough, so the preview never needs the horizontal scrollbar.
  const scale = $derived(
    Math.max(0.25, Math.min(1, (width - 48) / (REWARD_OVERLAY_CANVAS.width * editState.scale))) *
      editState.scale,
  );
  const previewWidth = $derived(REWARD_OVERLAY_CANVAS.width * scale);
  const previewHeight = $derived(REWARD_OVERLAY_CANVAS.height * scale);

  function configure(): void {
    if (!frame?.contentWindow || !context) return;
    frame.contentWindow.postMessage(
      {
        type: "reward-preview-config",
        ...$state.snapshot(context),
        state: $state.snapshot(editState),
      },
      "*",
    );
  }
  $effect(() => {
    const language = $locale;
    let disposed = false;
    void invoke("getRewardOverlayPreview")
      .then((next) => {
        if (!disposed && language === $locale) {
          context = next;
          failed = false;
        }
      })
      .catch(() => {
        if (!disposed) failed = true;
      });
    return () => {
      disposed = true;
    };
  });
  $effect(() => {
    if (context && frame) untrack(configure);
  });
  $effect(() => {
    frame?.contentWindow?.postMessage(
      { type: "reward-preview-state", state: $state.snapshot(editState) },
      "*",
    );
  });
  onMount(() => {
    const receive = async (event: MessageEvent): Promise<void> => {
      if (event.source !== frame?.contentWindow || !event.data || typeof event.data !== "object")
        return;
      const message = event.data;
      if (message.type === "reward-preview-flushed") {
        const pending = pendingFlush;
        if (pending && pending.id === message.id) {
          clearTimeout(pending.timer);
          pendingFlush = null;
          if (message.error) pending.reject();
          else pending.resolve();
        }
        return;
      }
      if (message.type === "reward-preview-ready") configure();
      else if (message.type === "reward-preview-cancel") onCancel();
      else if (message.type === "reward-preview-command" && Number.isSafeInteger(message.id)) {
        const destination = frame.contentWindow;
        if (!message.command || typeof message.command !== "object") return;
        const next = await onCommand(message.command as RewardOverlayEditCommand);
        destination?.postMessage(
          {
            type: "reward-preview-result",
            id: message.id,
            ...(next ? { state: $state.snapshot(next) } : { error: "Preview update failed" }),
          },
          "*",
        );
      }
    };
    const listener = (event: MessageEvent) => {
      void receive(event);
    };
    window.addEventListener("message", listener);
    return () => {
      window.removeEventListener("message", listener);
      if (pendingFlush) {
        clearTimeout(pendingFlush.timer);
        pendingFlush.reject();
        pendingFlush = null;
      }
    };
  });
</script>

<div
  bind:clientWidth={width}
  data-reward-editor-canvas
  class="min-h-[340px] w-full overflow-auto bg-bg-deep"
>
  {#if failed}
    <p role="alert" class="p-4 text-sm text-danger">{$tr("rewardEditor.openFailed")}</p>
  {:else if context}
    <div
      class="flex items-center justify-center"
      style:min-width={`${previewWidth + 48}px`}
      style:height={`${Math.max(340, previewHeight + 64)}px`}
    >
      <div
        class="relative shrink-0"
        style:width={`${previewWidth}px`}
        style:height={`${previewHeight}px`}
      >
        <iframe
          bind:this={frame}
          data-reward-editor-frame
          title={$tr("rewardEditor.title")}
          src={context.url}
          sandbox="allow-scripts allow-same-origin"
          onload={configure}
          class="absolute left-0 top-0 origin-top-left border-0"
          style:width={`${REWARD_OVERLAY_CANVAS.width}px`}
          style:height={`${REWARD_OVERLAY_CANVAS.height}px`}
          style:transform={`scale(${scale})`}
        ></iframe>
      </div>
    </div>
  {:else}
    <p class="p-4 text-sm text-text-secondary">{$tr("common.loading")}</p>
  {/if}
</div>
