import { asRecord as record } from "../config/shared/objectValidation";
import { toNonEmptyString as text } from "../config/shared/stringValidation";
import {
  PROFILE_CAREER_KEYS,
  PROFILE_COLOR_CHANNELS,
  PROFILE_COLOR_GROUPS,
  type PersonalProfile,
  type ProfileAppearanceConfig,
  type ProfileAppearanceItem,
} from "../config/shared/personalProfile";

const MAX_ROWS = 10_000;
export const MAX_CONFIGS = 12;
const MAX_SKINS = 128;
const EQUIPMENT_FIELDS = ["equipTime", "kills", "headshots", "assists", "xp"] as const;
const ENEMY_FIELDS = ["kills", "headshots", "assists", "finishers", "deaths", "scans"] as const;
const APPEARANCE_CATEGORIES = ["Suits", "LongGuns", "Pistols", "Melee"] as const;
const PRESET_KEYS = { Suits: "s", LongGuns: "l", Pistols: "p", Melee: "m" } as const;

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function numericFields<K extends string>(
  source: Record<string, unknown>,
  keys: readonly K[],
): Partial<Record<K, number>> {
  const result: Partial<Record<K, number>> = {};
  for (const key of keys) {
    const value = number(source[key]);
    if (value !== undefined) result[key] = value;
  }
  return result;
}

function table<K extends string>(
  value: unknown,
  keys: readonly K[],
  withNames = false,
): Array<{ type: string; name?: string } & Partial<Record<K, number>>> | null {
  if (!Array.isArray(value)) return null;
  const rows = new Map<string, { type: string; name?: string } & Partial<Record<K, number>>>();
  for (const entry of value.slice(0, MAX_ROWS)) {
    const source = record(entry);
    const type = text(source?.type, 512);
    if (!source || !type) continue;
    const row: { type: string; name?: string } & Partial<Record<K, number>> = {
      type,
      ...numericFields(source, keys),
    };
    const name = withNames ? text(source.name, 240) : undefined;
    if (name) row.name = name;
    const previous = rows.get(type);
    // Duplicate cumulative counters overlap, so keep each maximum rather than summing.
    if (previous) {
      for (const key of keys) {
        const oldValue = previous[key];
        const newValue = row[key];
        if (oldValue !== undefined && (newValue === undefined || oldValue > newValue))
          row[key] = oldValue;
      }
      if (!row.name && previous.name) row.name = previous.name;
    }
    rows.set(type, row);
  }
  return [...rows.values()];
}

function color(value: unknown): string | undefined {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < -0x80000000 ||
    value > 0xffffffff
  ) {
    return undefined;
  }
  const packed = (value >>> 0).toString(16).padStart(8, "0");
  return `#${packed.slice(2)}${packed.slice(0, 2)}`;
}

export function parseProfileAppearanceConfig(
  value: unknown,
  normalized: boolean,
  resolveSkin?: (type: string) => string | null,
): ProfileAppearanceConfig {
  const source = record(value) ?? {};
  const result: ProfileAppearanceConfig = { skins: [], colors: {} };
  const name = text(source[normalized ? "name" : "Name"], 120);
  if (name) result.name = name;
  const skins: unknown = source[normalized ? "skins" : "Skins"];
  if (Array.isArray(skins)) {
    for (let index = 0; index < Math.min(skins.length, MAX_SKINS); index++) {
      const entry = record(skins[index]);
      const raw = text(normalized ? entry?.type : skins[index], 512);
      const type = raw && resolveSkin ? resolveSkin(raw) : raw;
      const slot = normalized ? entry?.slot : index;
      if (
        type &&
        type !== "EmptyCustomization" &&
        !type.endsWith("/EmptyCustomization") &&
        typeof slot === "number" &&
        Number.isInteger(slot) &&
        slot >= 0 &&
        slot < MAX_SKINS
      ) {
        result.skins.push({ slot, type });
      }
    }
  }
  const colors = normalized ? record(source.colors) : source;
  for (const group of PROFILE_COLOR_GROUPS) {
    const input = record(colors?.[group]);
    if (!input) continue;
    const channels: ProfileAppearanceConfig["colors"][typeof group] = {};
    for (const channel of PROFILE_COLOR_CHANNELS) {
      const value = input[channel];
      const parsed = normalized
        ? typeof value === "string" && /^#[0-9a-f]{8}$/i.test(value)
          ? value.toLowerCase()
          : undefined
        : color(value);
      if (parsed !== undefined) channels[channel] = parsed;
    }
    if (Object.keys(channels).length) result.colors[group] = channels;
  }
  return result;
}

function appearance(source: Record<string, unknown>): ProfileAppearanceItem[] {
  const inventory = record(source.LoadOutInventory);
  const preset = record(source.LoadOutPreset);
  const result: ProfileAppearanceItem[] = [];
  for (const category of APPEARANCE_CATEGORIES) {
    const entries = inventory?.[category];
    if (!Array.isArray(entries)) continue;
    const selection = record(preset?.[PRESET_KEYS[category]]);
    const selectedId = text(record(selection?.ItemId)?.$oid, 512);
    for (const entry of entries.slice(0, 16)) {
      const item = record(entry);
      const type = text(item?.ItemType, 512);
      if (!item || !type) continue;
      const configs = Array.isArray(item.Configs)
        ? item.Configs.slice(0, MAX_CONFIGS).map((config) =>
            parseProfileAppearanceConfig(config, false),
          )
        : [];
      const selected = selectedId
        ? text(record(item.ItemId)?.$oid, 512) === selectedId
        : entries.length === 1;
      const index = number(selection?.cus);
      const activeConfig =
        selected && index !== undefined && Number.isInteger(index) && index < configs.length
          ? index
          : null;
      const parsed: ProfileAppearanceItem = { category, type, configs, activeConfig };
      if (selected && typeof selection?.hide === "boolean") {
        parsed.hiddenWhenHolstered = selection.hide;
      }
      result.push(parsed);
    }
  }
  return result;
}

function createdAt(value: unknown): number | undefined {
  const date = record(value)?.$date;
  const raw = record(date)?.$numberLong ?? date;
  const parsed = typeof raw === "string" && /^\d{1,16}$/.test(raw) ? Number(raw) : number(raw);
  return parsed !== undefined && Number.isSafeInteger(parsed) && parsed <= 8.64e15
    ? parsed
    : undefined;
}

export function parsePersonalProfile(payload: unknown): PersonalProfile | null {
  const root = record(payload);
  if (!root) return null;
  const player = record(Array.isArray(root.Results) ? root.Results[0] : undefined) ?? {};
  const rootStats = record(root.Stats);
  const playerStats = record(player.Stats);
  if (!rootStats && !playerStats) return null;
  const stats = { ...playerStats, ...rootStats };
  const enemies = table(stats.Enemies, ENEMY_FIELDS);
  const scans = new Map(table(stats.Scans, ["scans"])?.map((row) => [row.type, row.scans]));
  for (const enemy of enemies ?? []) {
    const count = scans.get(enemy.type);
    if (enemy.scans === undefined && count !== undefined) enemy.scans = count;
  }
  const result: PersonalProfile = {
    career: numericFields(stats, PROFILE_CAREER_KEYS),
    equipment: table(stats.Weapons, EQUIPMENT_FIELDS),
    enemies,
    abilities: table(stats.Abilities, ["used"]),
    missions: table(stats.Missions, ["highScore"]),
    appearance: appearance(player),
  };
  const displayName = text(player.displayName, 120) ?? text(player.DisplayName, 120);
  const masteryRank = number(player.PlayerLevel);
  const registeredAt = createdAt(player.Created);
  if (displayName) result.displayName = displayName;
  if (masteryRank !== undefined && Number.isInteger(masteryRank)) result.masteryRank = masteryRank;
  if (registeredAt !== undefined) result.registeredAt = registeredAt;
  return result;
}

function validNumbers(source: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.every((key) => !(key in source) || number(source[key]) !== undefined);
}

function validTable(value: unknown, keys: readonly string[], withNames = false): boolean {
  if (value === null) return true;
  if (!Array.isArray(value) || value.length > MAX_ROWS) return false;
  const types = new Set<string>();
  return value.every((entry) => {
    const source = record(entry);
    const type = text(source?.type, 512);
    if (
      !source ||
      !type ||
      types.has(type) ||
      !validNumbers(source, keys) ||
      (withNames && "name" in source && !text(source.name, 240))
    )
      return false;
    types.add(type);
    return true;
  });
}

function validConfig(value: unknown): boolean {
  const source = record(value);
  if (!source || ("name" in source && !text(source.name, 120))) return false;
  if (!Array.isArray(source.skins) || source.skins.length > MAX_SKINS) return false;
  const slots = new Set<number>();
  for (const entry of source.skins) {
    const skin = record(entry);
    const slot = skin?.slot;
    if (
      !text(skin?.type, 512) ||
      typeof slot !== "number" ||
      !Number.isInteger(slot) ||
      slot < 0 ||
      slot >= MAX_SKINS ||
      slots.has(slot)
    ) {
      return false;
    }
    slots.add(slot);
  }
  const colors = record(source.colors);
  if (!colors) return false;
  for (const group of PROFILE_COLOR_GROUPS) {
    if (!(group in colors)) continue;
    const channels = record(colors[group]);
    if (!channels) return false;
    for (const channel of PROFILE_COLOR_CHANNELS) {
      if (
        channel in channels &&
        (typeof channels[channel] !== "string" || !/^#[0-9a-f]{8}$/i.test(channels[channel]))
      ) {
        return false;
      }
    }
  }
  return true;
}

export function revivePersonalProfile(value: unknown): PersonalProfile | null {
  const source = record(value);
  const career = record(source?.career);
  if (!source || !career || !validNumbers(career, PROFILE_CAREER_KEYS)) return null;
  if (
    !validTable(source.equipment, EQUIPMENT_FIELDS) ||
    !validTable(source.enemies, ENEMY_FIELDS) ||
    !validTable(source.abilities, ["used"], true) ||
    !validTable(source.missions, ["highScore"], true) ||
    !Array.isArray(source.appearance) ||
    source.appearance.length > 64
  ) {
    return null;
  }
  const result: PersonalProfile = {
    career: numericFields(career, PROFILE_CAREER_KEYS),
    equipment: table(source.equipment, EQUIPMENT_FIELDS),
    enemies: table(source.enemies, ENEMY_FIELDS),
    abilities: table(source.abilities, ["used"], true),
    missions: table(source.missions, ["highScore"], true),
    appearance: [],
  };
  const counts = new Map<string, number>();
  for (const entry of source.appearance) {
    const item = record(entry);
    const category = APPEARANCE_CATEGORIES.find((candidate) => candidate === item?.category);
    const type = text(item?.type, 512);
    if (!item || !category || !type || !Array.isArray(item.configs)) return null;
    const count = (counts.get(category) ?? 0) + 1;
    if (count > 16 || item.configs.length > MAX_CONFIGS || !item.configs.every(validConfig))
      return null;
    counts.set(category, count);
    const index = item.activeConfig;
    if (
      index !== null &&
      (typeof index !== "number" ||
        !Number.isInteger(index) ||
        index < 0 ||
        index >= item.configs.length)
    ) {
      return null;
    }
    const parsed: ProfileAppearanceItem = {
      category,
      type,
      activeConfig: index,
      configs: item.configs.map((config) => parseProfileAppearanceConfig(config, true)),
    };
    if ("hiddenWhenHolstered" in item) {
      if (typeof item.hiddenWhenHolstered !== "boolean") return null;
      parsed.hiddenWhenHolstered = item.hiddenWhenHolstered;
    }
    result.appearance.push(parsed);
  }
  if ("displayName" in source) {
    const name = text(source.displayName, 120);
    if (!name) return null;
    result.displayName = name;
  }
  if ("masteryRank" in source) {
    const rank = number(source.masteryRank);
    if (rank === undefined || !Number.isInteger(rank)) return null;
    result.masteryRank = rank;
  }
  if ("registeredAt" in source) {
    const date = number(source.registeredAt);
    if (date === undefined || !Number.isSafeInteger(date) || date > 8.64e15) return null;
    result.registeredAt = date;
  }
  return result;
}

export function enrichPersonalProfileNames(
  profile: PersonalProfile,
  source: {
    abilities: unknown;
    warframes: unknown;
    resolveName: (value: unknown) => string | null;
    missionName: (type: string) => string | null;
  },
): PersonalProfile {
  const abilityNames = new Map<string, unknown>();
  for (const [type, value] of Object.entries(record(source.abilities) ?? {})) {
    const name = record(value)?.name;
    if (name) abilityNames.set(type, name);
  }
  for (const value of Object.values(record(source.warframes) ?? {})) {
    const abilities = record(value)?.abilities;
    if (!Array.isArray(abilities)) continue;
    for (const ability of abilities) {
      const entry = record(ability);
      const type = text(entry?.uniqueName, 512);
      if (type && entry?.name && !abilityNames.has(type)) abilityNames.set(type, entry.name);
    }
  }
  return {
    ...profile,
    abilities:
      profile.abilities?.map(({ name: _previousName, ...row }) => {
        const name = text(source.resolveName(abilityNames.get(row.type)), 240);
        return name ? { ...row, name } : row;
      }) ?? null,
    missions:
      profile.missions?.map(({ name: _previousName, ...row }) => {
        const name = text(source.missionName(row.type), 240);
        return name && name !== row.type ? { ...row, name } : row;
      }) ?? null,
  };
}
