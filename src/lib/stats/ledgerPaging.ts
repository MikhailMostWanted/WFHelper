import {
  LEDGER_QUERY_MAX_LIMIT,
  type LedgerQuery,
} from "../../../config/shared/tradeLedgerTypes.js";
import { invoke } from "../ipc.js";
import type { TradeEvent } from "../../types/ipc.js";

/** Null means the caller's load is no longer current. */
export async function pageLedgerRange(
  query: LedgerQuery,
  maxRows: number,
  isCurrent: () => boolean = () => true,
): Promise<{ events: TradeEvent[]; total: number } | null> {
  const collected: TradeEvent[] = [];
  let before = query.before;
  let total = 0;
  while (collected.length < maxRows) {
    const limit = Math.min(LEDGER_QUERY_MAX_LIMIT, maxRows - collected.length);
    const page = await invoke("ledgerQuery", {
      ...query,
      offset: 0,
      ...(before ? { before } : {}),
      limit,
    });
    if (!isCurrent()) return null;
    total = page.total;
    collected.push(...page.events);
    if (page.events.length < limit) break;
    const last = page.events[page.events.length - 1];
    before = { date: last.date, id: last.id };
  }
  return { events: collected, total };
}
