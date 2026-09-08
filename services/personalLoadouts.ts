import { unwrapInventoryPayload } from "../config/shared/inventoryPayload";
import { asRecord } from "../config/shared/objectValidation";
import { toNonEmptyString } from "../config/shared/stringValidation";
import type { ProfileLoadoutItem, ProfileSavedLoadout } from "../config/shared/personalProfile";
import { MAX_CONFIGS, parseProfileAppearanceConfig } from "./personalProfileParser";

const CATEGORIES = ["Suits", "LongGuns", "Pistols", "Melee"] as const;
const OWNED_SKIN_ID = /^[0-9a-f]{24}$/i;
// DE presets abbreviate suit, long gun, pistol and melee slots.
const PRESET_KEYS = { Suits: "s", LongGuns: "l", Pistols: "p", Melee: "m" } as const;

function itemId(value: unknown): string | null {
  return toNonEmptyString(asRecord(value)?.$oid, 512);
}

function index(value: unknown, length: number): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < length
    ? value
    : null;
}

function itemType(value: unknown): string | null {
  const type = toNonEmptyString(value, 512);
  return type?.startsWith("/Lotus/") ? type : null;
}

function upgradeRank(value: unknown): number | null {
  if (typeof value !== "string" || value.length > 16_384) return null;
  try {
    const rank = asRecord(JSON.parse(value))?.lvl;
    return typeof rank === "number" && Number.isSafeInteger(rank) && rank >= 0 && rank <= 100
      ? rank
      : null;
  } catch {
    return null;
  }
}

export function parsePersonalLoadouts(payload: unknown): ProfileSavedLoadout[] {
  const inventory = asRecord(unwrapInventoryPayload(payload));
  const presets = asRecord(inventory?.LoadOutPresets)?.NORMAL;
  if (!inventory || !Array.isArray(presets)) return [];
  const upgrades = new Map<string, { type: string | null; rank: number | null }>();
  if (Array.isArray(inventory.Upgrades)) {
    for (const entry of inventory.Upgrades.slice(0, 100_000)) {
      const upgrade = asRecord(entry);
      const id = itemId(upgrade?.ItemId);
      if (id && upgrade) {
        upgrades.set(id, {
          type: itemType(upgrade.ItemType),
          rank: upgradeRank(upgrade.UpgradeFingerprint),
        });
      }
    }
  }
  // Configs reference owned cosmetics by their WeaponSkins id, not by type.
  const skins = new Map<string, string>();
  if (Array.isArray(inventory.WeaponSkins)) {
    for (const entry of inventory.WeaponSkins.slice(0, 50_000)) {
      const skin = asRecord(entry);
      const id = itemId(skin?.ItemId);
      const type = itemType(skin?.ItemType);
      if (id && type) skins.set(id, type);
    }
  }
  const resolveSkin = (type: string): string | null =>
    OWNED_SKIN_ID.test(type) ? (skins.get(type) ?? null) : type;
  const equipment = new Map<string, Record<string, unknown>>();
  for (const category of CATEGORIES) {
    const entries = inventory[category];
    if (!Array.isArray(entries)) continue;
    for (const entry of entries.slice(0, 10_000)) {
      const item = asRecord(entry);
      const id = itemId(item?.ItemId);
      if (id && item) equipment.set(`${category}:${id}`, item);
    }
  }
  const result: ProfileSavedLoadout[] = [];
  for (const entry of presets.slice(0, 128)) {
    const preset = asRecord(entry);
    if (!preset) continue;
    const loadout: ProfileSavedLoadout = { slots: [] };
    const name = toNonEmptyString(preset.n, 120);
    if (name) loadout.name = name;
    for (const category of CATEGORIES) {
      const selection = asRecord(preset[PRESET_KEYS[category]]);
      const id = itemId(selection?.ItemId);
      if (!id) continue;
      const raw = equipment.get(`${category}:${id}`);
      const type = itemType(raw?.ItemType);
      if (!raw || !type) {
        loadout.slots.push({ category, item: null });
        continue;
      }
      const configs = Array.isArray(raw.Configs) ? raw.Configs.slice(0, MAX_CONFIGS) : [];
      // cus and mod choose independent appearance/build configs; hide applies when holstered.
      const item: ProfileLoadoutItem = {
        category,
        type,
        activeConfig: index(selection?.cus, configs.length),
        configs: configs.map((config) => parseProfileAppearanceConfig(config, false, resolveSkin)),
        activeModConfig: index(selection?.mod, configs.length),
        modConfigs: configs.map((config) => {
          const source = asRecord(config);
          const name = toNonEmptyString(source?.Name, 120);
          const refs = source?.Upgrades;
          return {
            ...(name ? { name } : {}),
            upgrades: Array.isArray(refs)
              ? refs.slice(0, 32).flatMap((ref, slot) => {
                  if (ref === "") return [];
                  const resolved = typeof ref === "string" ? upgrades.get(ref) : undefined;
                  return [{ slot, ...(resolved ?? { type: itemType(ref), rank: null }) }];
                })
              : null,
          };
        }),
      };
      if (typeof selection?.hide === "boolean") item.hiddenWhenHolstered = selection.hide;
      loadout.slots.push({ category, item });
    }
    result.push(loadout);
  }
  return result;
}
