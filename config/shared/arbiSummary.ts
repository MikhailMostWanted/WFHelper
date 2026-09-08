import type { ArbiMissionType, ArbiRunEndReason, ArbiRunRecord } from "./arbiTypes";

/** Compact payload for the post-run summary overlay. */
interface ArbiSummaryPayload {
  id: string;
  node: string;
  missionType: ArbiMissionType;
  missionTypeRaw: string | null;
  durationSec: number;
  rotations: number;
  drones: number;
  totalEnemies: number;
  expectedVitusMean: number;
  expectedVitusStd: number;
  vitusActual: number | null;
  expectedVitusPerMin: number | null;
  killsPerMin: number | null;
  killsPerDrone: number | null;
  avgDroneIntervalSec: number | null;
  players: string[];
  squadSize: number | null;
  endReason: ArbiRunEndReason;
  /** Percent of sampled combat time with 15+ enemies alive (0-100). */
  pctTimeAt15Plus: number;
}

const HIGH_SATURATION_MIN_COUNT = 15;

function finiteNonnegative(value: number | null): number | null {
  return value !== null && Number.isFinite(value) && value >= 0 ? value : null;
}

/** Returns an overlay payload only for eligible completed live runs. */
export function buildArbiSummaryPayload(run: ArbiRunRecord): ArbiSummaryPayload | null {
  if (run.source !== "live") return null;
  if (run.rotations < 2) return null;
  if (run.endReason !== "mission-end" && run.endReason !== "aborted") return null;
  const stats = run.stats;
  if (!stats) return null;

  const pct = stats.saturationBuckets
    .filter((bucket) => bucket.minCount >= HIGH_SATURATION_MIN_COUNT)
    .reduce((sum, bucket) => sum + bucket.pct, 0);
  const duration = finiteNonnegative(run.durationSec);
  const perMinute = (value: number): number | null =>
    duration && finiteNonnegative(value) !== null
      ? finiteNonnegative((value / duration) * 60)
      : null;
  const players = [...new Set((run.players ?? []).map((name) => name.trim()).filter(Boolean))]
    .slice(0, 4)
    .map((name) => name.slice(0, 64));

  return {
    id: run.id,
    node: run.node,
    missionType: run.missionType,
    missionTypeRaw: run.missionTypeRaw ?? null,
    durationSec: run.durationSec,
    rotations: run.rotations,
    drones: run.drones,
    totalEnemies: run.totalEnemies,
    expectedVitusMean: stats.expectedVitusMean,
    expectedVitusStd: stats.expectedVitusStd,
    vitusActual: finiteNonnegative(run.vitusActual),
    expectedVitusPerMin: perMinute(stats.expectedVitusMean),
    killsPerMin: perMinute(run.totalEnemies),
    killsPerDrone:
      run.drones > 0 && finiteNonnegative(run.drones) !== null
        ? finiteNonnegative(run.totalEnemies / run.drones)
        : null,
    avgDroneIntervalSec: finiteNonnegative(stats.avgDroneIntervalSec),
    players,
    squadSize: players.length || null,
    endReason: run.endReason,
    pctTimeAt15Plus: Math.round(pct * 10) / 10,
  };
}
