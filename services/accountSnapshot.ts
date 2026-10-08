import { unwrapInventoryPayload, hasInventoryShape } from "../config/shared/inventoryPayload";
import { asRecord } from "../config/shared/objectValidation";

const STACKS = ["MiscItems", "Recipes", "LevelKeys", "RawUpgrades", "Arcanes", "FusionBundles", "Gear"] as const;
const EQUIPMENT = ["Suits", "LongGuns", "Pistols", "Melee", "Sentinels", "SentinelWeapons", "SpaceSuits", "SpaceGuns", "SpaceMelee", "OperatorAmps", "MechSuits", "Hoverboards", "MoaPets", "KubrowPets", "DrifterMelee"] as const;
const LIMIT = 50_000;
const text = (v: unknown, max = 512): string | null => typeof v === "string" && v.length <= max ? v : null;
const num = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
const id = (v: unknown): string | null => text(asRecord(v)?.$oid);
const type = (v: unknown): string | null => typeof v === "string" && v.startsWith("/Lotus/") ? text(v) : null;
const list = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
function fingerprint(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string" || value.length > 16384) return null;
  try { return asRecord(JSON.parse(value)); } catch { return null; }
}
function date(value: unknown): number | null {
  const raw = asRecord(value)?.$date;
  const v = asRecord(raw)?.$numberLong ?? raw;
  const n = typeof v === "string" && /^\d{1,16}$/.test(v) ? Number(v) : num(v);
  return n != null && Number.isSafeInteger(n) && n <= 8.64e15 ? n : null;
}
export interface SnapshotItem {
  section: string; type: string; name: string | null; nameRu: string | null;
  instanceId: string | null; count: number | null; xp: number | null;
  rank: number | null; polarizationCount: number | null; featureFlags: number | null;
  modularParts: Array<string | null> | null;
  configs: Array<{ index: number; name: string | null; mods: Array<{ slot: number; reference: string | null; type: string | null; rank: number | null }> | null }> | null;
  polarities: Array<{ slot: number | null; value: string | null }> | null;
  shards: Array<{ slot: number; type: string | null; color: string | null }> | null;
  roll: { rank: number | null; rerolls: number | null; compatibility: string | null; buffs: Array<{ tag: string | null; rawValue: number | null }>; curses: Array<{ tag: string | null; rawValue: number | null }> } | null;
  completesAt: number | null;
}
export interface AccountSnapshot {
  schemaVersion: 1; generatedAt: number; inventoryUpdatedAt: number | null;
  source: string; appVersion: string;
  account: { masteryRank: number | null; masteryXp: number | null; credits: number | null; platinum: number | null; endo: number | null };
  coverage: Array<{ section: string; status: "present" | "absent" | "partial"; rows: number; rejected: number }>;
  items: SnapshotItem[];
  loadouts: Array<{ mode: string; index: number; name: string | null; slots: Array<{ slot: string; instanceId: string | null; modConfig: number | null; appearanceConfig: number | null }> }>;
  fieldCoverage: { scope: string; omittedValues: number };
}
export interface SnapshotOptions {
  source: string; inventoryUpdatedAt: number | null; appVersion: string; now?: number;
  lookup?: (itemType: string) => { name?: string | null; nameRu?: string | null } | null;
}
/** Only allowlisted gameplay fields; raw inventory/auth/session blobs never leave this boundary. */
export function buildAccountSnapshot(payload: unknown, options: SnapshotOptions): AccountSnapshot {
  const inventory = asRecord(unwrapInventoryPayload(payload));
  if (!inventory || !hasInventoryShape(inventory)) throw new Error("No valid inventory snapshot");
  const upgrades = new Map<string, { type: string | null; rank: number | null }>();
  for (const value of list(inventory.Upgrades).slice(0, LIMIT)) {
    const row = asRecord(value); const key = id(row?.ItemId);
    if (key) upgrades.set(key, { type: type(row?.ItemType), rank: num(fingerprint(row?.UpgradeFingerprint)?.lvl) });
  }
  const output: AccountSnapshot = {
    schemaVersion: 1, generatedAt: options.now ?? Date.now(), inventoryUpdatedAt: options.inventoryUpdatedAt,
    source: options.source, appVersion: options.appVersion,
    account: { masteryRank: num(inventory.PlayerLevel) ?? num(inventory.MasteryRank), masteryXp: num(inventory.MasteryXP) ?? num(inventory.PlayerXp), credits: num(inventory.RegularCredits), platinum: num(inventory.PremiumCredits), endo: num(inventory.FusionPoints) },
    coverage: [], items: [], loadouts: [], fieldCoverage: { scope: "allowlisted gameplay fields; unavailable fields remain null", omittedValues: 0 },
  };
  const presets = asRecord(inventory.LoadOutPresets);
  for (const mode of ["NORMAL", "ARCHWING", "OPERATOR", "DRIFTER", "RAILJACK"]) {
    const entries = presets?.[mode]; if (!Array.isArray(entries)) continue;
    output.fieldCoverage.omittedValues += Math.max(0, entries.length - 128);
    for (const [index, value] of entries.slice(0, 128).entries()) {
      const entry = asRecord(value); if (!entry) continue;
      output.loadouts.push({ mode, index, name: text(entry.n, 120), slots:
        ["s", "l", "p", "m", "c", "a", "k"].flatMap((slot) => {
          const selected = asRecord(entry[slot]); if (!selected) return [];
          return [{ slot, instanceId: id(selected.ItemId), modConfig: num(selected.mod), appearanceConfig: num(selected.cus) }];
        }) });
    }
  }
  for (const section of [...STACKS, ...EQUIPMENT, "Upgrades", "XPInfo", "PendingRecipes"]) {
    const source = inventory[section];
    if (!Array.isArray(source)) { output.coverage.push({ section, status: "absent", rows: 0, rejected: 0 }); continue; }
    let rejected = Math.max(0, source.length - LIMIT);
    const start = output.items.length;
    for (const value of source.slice(0, LIMIT)) {
      const row = asRecord(value); const itemType = type(row?.ItemType);
      if (!row || !itemType) { rejected++; continue; }
      const fp = fingerprint(row.UpgradeFingerprint);
      for (const [key, limit] of [["Configs", 12], ["Polarized", 32], ["ArchonCrystalUpgrades", 5], ["ModularParts", 16]] as const) {
        if (Array.isArray(row[key])) output.fieldCoverage.omittedValues += Math.max(0, row[key].length - limit);
      }
      for (const cfg of list(row.Configs)) {
        const refs = asRecord(cfg)?.Upgrades;
        if (Array.isArray(refs)) output.fieldCoverage.omittedValues += Math.max(0, refs.length - 32);
      }
      const label = options.lookup?.(itemType);
      const mapRoll = (v: unknown) => list(v).slice(0, 8).map((v) => {
        const stat = asRecord(v); return { tag: text(stat?.Tag), rawValue: num(stat?.Value) };
      });
      output.items.push({
        section, type: itemType, name: label?.name ?? null, nameRu: label?.nameRu ?? null,
        instanceId: id(row.ItemId), count: num(row.ItemCount) ?? (id(row.ItemId) ? 1 : null), xp: num(row.XP), rank: num(fp?.lvl),
        polarizationCount: num(row.Polarized), featureFlags: num(row.Features),
        modularParts: Array.isArray(row.ModularParts) ? row.ModularParts.slice(0, 16).map(type) : null,
        configs: Array.isArray(row.Configs) ? row.Configs.slice(0, 12).map((value, index) => {
          const cfg = asRecord(value);
          return { index, name: text(cfg?.Name, 120), mods: Array.isArray(cfg?.Upgrades) ? cfg.Upgrades.slice(0, 32).map((value, slot) => {
            const reference = text(value); const known = reference ? upgrades.get(reference) : undefined;
            return { slot, reference, type: known?.type ?? type(reference), rank: known?.rank ?? null };
          }) : null };
        }) : null,
        polarities: Array.isArray(row.Polarized) ? row.Polarized.slice(0, 32).map((value) => {
          const pol = asRecord(value); return { slot: num(pol?.Slot), value: text(pol?.Value, 64) };
        }) : null,
        shards: Array.isArray(row.ArchonCrystalUpgrades) ? row.ArchonCrystalUpgrades.slice(0, 5).map((value, slot) => {
          const shard = asRecord(value); return { slot, type: type(shard?.UpgradeType), color: text(shard?.Color, 64) };
        }) : null,
        roll: fp && (Array.isArray(fp.buffs) || Array.isArray(fp.curses)) ? { rank: num(fp.lvl), rerolls: num(fp.rerolls), compatibility: type(fp.compat), buffs: mapRoll(fp.buffs), curses: mapRoll(fp.curses) } : null,
        completesAt: date(row.CompletionDate),
      });
    }
    output.coverage.push({ section, status: rejected ? "partial" : "present", rows: output.items.length - start, rejected });
  }
  return output;
}
