import fs from "node:fs";
import { userDataPath } from "./userDataPath";
import { writeFileAtomicSync } from "./atomicFile";
import {
  advanceResourceHistory,
  observeResources,
  parseResourceHistory,
  resourceBalanceReport,
  type ResourceHistory,
  type ResourceObservation,
  type ResourceTrackingReport,
} from "../config/shared/resourceBalances";

let history: ResourceHistory | null | undefined;
const file = () => userDataPath("resource-tracking.json");

export function trackResourceSnapshot(
  payload: unknown,
  options: Pick<ResourceObservation, "bindingId" | "source" | "capturedAt">,
): ResourceTrackingReport {
  if (history === undefined) {
    history = null;
    try {
      if (fs.statSync(file()).size <= 16 * 1024 * 1024)
        history = parseResourceHistory(JSON.parse(fs.readFileSync(file(), "utf8")));
    } catch {
      /* First observation or unreadable history starts a baseline. */
    }
  }
  const next = advanceResourceHistory(history, observeResources(payload, options));
  if (next !== history) {
    history = next;
    try {
      writeFileAtomicSync(file(), JSON.stringify(history));
    } catch {
      /* A read-only profile still provides current balances in memory. */
    }
  }
  return resourceBalanceReport(history!);
}
