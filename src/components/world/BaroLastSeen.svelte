<script module lang="ts">
  import { clockStore } from "../../lib/timers.js";
  const clock = clockStore(30_000);
</script>

<script lang="ts">
  import { locale, tr as t } from "../../lib/i18n.js";
  import { activeWindow } from "../../lib/format.js";
  import { worldData } from "../../stores/world.js";
  import { baroLastSeen, baroHistoryError, baroHistoryLoading } from "../../stores/baro.js";

  let {
    uniqueName,
    available,
    lastRecorded = null,
  }: { uniqueName: string; available?: boolean; lastRecorded?: number | null } = $props();
  const current = $derived($worldData?.voidTrader);
  const currentAvailable = $derived(
    available ??
      (activeWindow(current?.activation, current?.expiry, $clock) &&
        current?.inventory?.some((entry) => entry.uniqueName === uniqueName) === true),
  );
  const lastSeen = $derived.by(() => {
    const saved = $baroLastSeen.get(uniqueName) ?? 0;
    const activation = Date.parse(current?.activation ?? "");
    const observed =
      current?.inventory?.some((entry) => entry.uniqueName === uniqueName) &&
      Number.isFinite(activation) &&
      activation > 0 &&
      activation <= $clock
        ? activation
        : 0;
    return Math.max(saved, observed, lastRecorded ?? 0) || null;
  });
  const date = $derived(lastSeen === null ? null : new Date(lastSeen).toLocaleDateString($locale));
</script>

<span
  class="text-xs {currentAvailable ? 'text-success' : 'text-text-muted'}"
  data-baro-last-seen={uniqueName}
>
  {#if currentAvailable}{$t("baro.availableNow")}
  {:else if date}{$t("baro.lastRecorded", { date })}
  {:else if $baroHistoryLoading}{$t("common.loading")}
  {:else if $baroHistoryError}{$t("baro.historyUnavailable")}
  {:else}{$t("baro.noRecordedHistory")}{/if}
</span>
