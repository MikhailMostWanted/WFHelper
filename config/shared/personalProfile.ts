import type { InventorySource } from "./inventorySource";

export const PROFILE_CAREER_KEYS = [
  "TimePlayedSec",
  "Income",
  "ReviveCount",
  "HealCount",
  "Deaths",
  "MeleeKills",
  "MissionsCompleted",
  "MissionsFailed",
  "MissionsQuit",
  "MissionsInterrupted",
  "MissionsDumped",
  "CiphersSolved",
  "CiphersFailed",
  "CipherTime",
  "PickupCount",
  "DestroyCount",
  "FishCount",
] as const;
export type ProfileCareerKey = (typeof PROFILE_CAREER_KEYS)[number];

interface ProfileEquipmentStat {
  type: string;
  equipTime?: number;
  kills?: number;
  headshots?: number;
  assists?: number;
  xp?: number;
}

interface ProfileEnemyStat {
  type: string;
  kills?: number;
  headshots?: number;
  assists?: number;
  finishers?: number;
  deaths?: number;
  scans?: number;
}

export const PROFILE_COLOR_GROUPS = ["pricol", "attcol", "syancol", "sigcol"] as const;
export const PROFILE_COLOR_CHANNELS = ["t0", "t1", "t2", "t3", "m0", "m1", "en", "e1"] as const;
export type ProfileColorGroup = (typeof PROFILE_COLOR_GROUPS)[number];
export type ProfileColorChannel = (typeof PROFILE_COLOR_CHANNELS)[number];

export interface ProfileAppearanceConfig {
  name?: string;
  skins: Array<{ slot: number; type: string }>;
  colors: Partial<Record<ProfileColorGroup, Partial<Record<ProfileColorChannel, string>>>>;
}

export interface ProfileAppearanceItem {
  category: "Suits" | "LongGuns" | "Pistols" | "Melee";
  type: string;
  activeConfig: number | null;
  hiddenWhenHolstered?: boolean;
  configs: ProfileAppearanceConfig[];
}

export interface PersonalProfile {
  displayName?: string;
  masteryRank?: number;
  registeredAt?: number;
  career: Partial<Record<ProfileCareerKey, number>>;
  equipment: ProfileEquipmentStat[] | null;
  enemies: ProfileEnemyStat[] | null;
  abilities: Array<{ type: string; name?: string; used?: number }> | null;
  missions: Array<{ type: string; name?: string; highScore?: number }> | null;
  appearance: ProfileAppearanceItem[];
}

export interface PersonalProfileResult {
  inventorySource?: InventorySource;
  savedLoadouts?: ProfileSavedLoadout[];
  profile: PersonalProfile | null;
  fetchedAt: number | null;
  status: "ready" | "no-data" | "no-account" | "fetch-failed" | "account-changed";
  nextRefreshAt: number;
}

export interface ProfileLoadoutItem extends ProfileAppearanceItem {
  activeModConfig: number | null;
  modConfigs: Array<{
    name?: string;
    upgrades: Array<{ slot: number; type: string | null; rank: number | null }> | null;
  }>;
}

export interface ProfileSavedLoadout {
  name?: string;
  slots: Array<{ category: ProfileAppearanceItem["category"]; item: ProfileLoadoutItem | null }>;
}
