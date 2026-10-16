import { describe, expect, it } from "vitest";
import {
  observeResources,
  advanceResourceHistory,
  parseResourceHistory,
  resourceBalanceReport,
} from "../../config/shared/resourceBalances";
import { buildAccountSnapshot } from "../../services/accountSnapshot";
import { buildAccountBridge } from "../../services/accountBridge";
import { parseResources } from "../../src/lib/inventory/foundryResources";

const moon = "/Lotus/Types/Gameplay/Events/RoadToTauEvent/RoadToTauEventResource";
const future = "/Lotus/Types/Gameplay/Events/FutureOperation/NewToken";
const options = { bindingId: "a".repeat(64), source: "helper", capturedAt: 1000.25 };
const data = <T>(count: T, type = moon) => ({
  MiscItems: [{ ItemType: type, ItemCount: count }],
  sessionToken: "never-export",
});
const observe = (count: unknown, capturedAt = 1000.25) =>
  observeResources(data(count), { ...options, capturedAt });

describe("resource balances and events", () => {
  it("finds current and unknown future events without relying on a stale item database", () => {
    expect(parseResources(data(111), {}).find((r) => r.internalName === moon)).toMatchObject({
      name: "Moonflesh",
      count: 111,
    });
    expect(parseResources(data(27, future), {}).find((r) => r.internalName === future)?.count).toBe(
      27,
    );
    const report = resourceBalanceReport({ version: 1, previous: null, current: observe(111) });
    expect(report.rows.find((r) => r.type === moon)).toMatchObject({
      nameRu: "Лунная плоть",
      count: 111,
      delta: null,
      event: true,
      missionGain: null,
    });
    expect(JSON.stringify(report)).not.toContain("never-export");
  });
  it("keeps spending and balance increases separate from unproven mission loot", () => {
    const baseline = advanceResourceHistory(null, observe(111));
    const raised = advanceResourceHistory(baseline, observe(151, 2000.25));
    const row = resourceBalanceReport(raised).rows.find((r) => r.type === moon);
    expect(row).toMatchObject({
      previousCount: 111,
      count: 151,
      delta: 40,
      missionGain: null,
      previousCapturedAt: 1000.25,
    });
    const spent = advanceResourceHistory(raised, observe(31, 3000));
    expect(resourceBalanceReport(spent).rows.find((r) => r.type === moon)?.delta).toBe(-120);
    expect(
      advanceResourceHistory(
        parseResourceHistory(JSON.parse(JSON.stringify(spent))),
        observe(31, 3000),
      ),
    ).toEqual(spent);
  });
  it("only treats a missing stack as zero when the whole collection is trustworthy", () => {
    const baseline = advanceResourceHistory(null, observe(111));
    const empty = advanceResourceHistory(
      baseline,
      observeResources({ MiscItems: [] }, { ...options, capturedAt: 2000 }),
    );
    expect(resourceBalanceReport(empty).rows.find((r) => r.type === moon)).toMatchObject({
      count: 0,
      delta: -111,
    });
    const stillEmpty = advanceResourceHistory(
      empty,
      observeResources({ MiscItems: [] }, { ...options, capturedAt: 3000 }),
    );
    expect(resourceBalanceReport(stillEmpty).rows.find((r) => r.type === moon)).toMatchObject({
      count: 0,
      delta: 0,
    });
    const partial = advanceResourceHistory(
      baseline,
      observeResources({ Suits: [] }, { ...options, capturedAt: 2000 }),
    );
    expect(resourceBalanceReport(partial).rows.find((r) => r.type === moon)).toMatchObject({
      count: null,
      delta: null,
    });
    for (const count of [-1, NaN, Infinity, "5", Number.MAX_SAFE_INTEGER + 1])
      expect(observe(count).amounts[moon]).toBeNull();
    const duplicate = observeResources(
      { MiscItems: [...data(5).MiscItems, ...data(8).MiscItems] },
      options,
    );
    expect(duplicate.amounts[moon]).toBeNull();
    expect(duplicate.fullMisc).toBe(false);
  });
  it("rebaselines manual/unbound, cross-account, source and non-increasing time changes", () => {
    const baseline = advanceResourceHistory(null, observe(111));
    for (const overrides of [
      { bindingId: "manual" },
      { bindingId: "b".repeat(64) },
      { source: "file" },
      { capturedAt: null },
      { capturedAt: 1000.25 },
      { capturedAt: 500 },
    ]) {
      const next = { ...observe(222, 2000), ...overrides };
      expect(
        resourceBalanceReport(advanceResourceHistory(baseline, next)).rows.find(
          (r) => r.type === moon,
        )?.delta,
      ).toBeNull();
    }
    expect(
      parseResourceHistory({
        version: 1,
        current: { ...observe(1), amounts: { token: 3 } },
        previous: null,
      }),
    ).toBeNull();
  });
  it("exports allowed counts and provenance through the existing v1 bundle", () => {
    const payload = data(111);
    const snapshot = buildAccountSnapshot(payload, {
      source: "helper",
      inventoryUpdatedAt: 1000,
      appVersion: "test",
    });
    const bridge = buildAccountBridge(payload, snapshot, { bindingId: options.bindingId });
    expect(bridge.format).toBe("wantedframe.account.v1");
    expect(snapshot.items[0]).toMatchObject({
      name: "Moonflesh",
      nameRu: "Лунная плоть",
      count: 111,
    });
    expect(bridge.sections.find((s) => s.id === "resources.balances")?.rows).toContainEqual(
      expect.objectContaining({ type: moon, count: 111, delta: null, missionGain: null }),
    );
    expect(JSON.stringify(bridge)).not.toContain("never-export");
  });
});
