import { unwrapInventoryPayload } from "../config/shared/inventoryPayload";
import { asRecord } from "../config/shared/objectValidation";
import ctx from "../ipc/context";
import {
  getInventorySource,
  getLoadedInventoryModifiedAt,
  getLoadedInventoryHash,
} from "../ipc/inventoryIpc";
import { buildAccountSnapshot } from "./accountSnapshot";
import { buildAccountBridge, type AccountBridgeDocument } from "./accountBridge";
import { getAllItems, getRendererLookup, lookupItem } from "./itemDatabase";
import { nameInLocale } from "./gameLocale";
import { getPersonalProfile, getInventoryBindingFingerprint } from "./codexProfile";
import { computeMasteryProgress } from "./masteryHelper";
import { waitForStartupData } from "./startupReadiness";
import { app } from "electron";

let pending: Promise<AccountBridgeDocument> | null = null;
/** Read only the chosen in-memory inventory and already cached, same-account profile. */
export function currentAccountBridge(): Promise<AccountBridgeDocument> {
  if (pending) return pending;
  pending = build().finally(() => {
    pending = null;
  });
  return pending;
}
async function build(): Promise<AccountBridgeDocument> {
  await waitForStartupData();
  const raw = ctx.currentInventoryData;
  const source = getInventorySource();
  const stamp = getLoadedInventoryModifiedAt();
  if (!raw || source === "none")
    throw new Error("Открой инвентарь WantedFrame и дождись его загрузки");
  const bindingId = getInventoryBindingFingerprint(getLoadedInventoryHash()) ?? "manual";
  const lookup = (type: string) => {
    const item = lookupItem(type);
    return item ? { name: item.name, nameRu: nameInLocale(item.nameKey, "ru") } : null;
  };
  const snapshot = buildAccountSnapshot(raw, {
    source,
    inventoryUpdatedAt: stamp,
    appVersion: app.getVersion(),
    lookup,
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  const profile = bindingId === "manual" ? undefined : await getPersonalProfile(false);
  let mastery: ReturnType<typeof computeMasteryProgress> | undefined;
  try {
    mastery = computeMasteryProgress(asRecord(unwrapInventoryPayload(raw)) ?? {});
  } catch {
    /* Keep source history; never invent derived mastery. */
  }
  await new Promise<void>((resolve) => setImmediate(resolve));
  // Recipes live in a separate index. getAllItems alone cannot export crafting trees.
  const rendererReference = getRendererLookup();
  const gameItems = Object.fromEntries(
    Object.entries(getAllItems()).map(([key, item]) => [
      key,
      {
        ...item,
        ...(rendererReference[key]?.recipe ? { recipe: rendererReference[key].recipe } : {}),
        ...(rendererReference[key]?.buildsProduct
          ? { buildsProduct: rendererReference[key].buildsProduct }
          : {}),
      },
    ]),
  );
  const doc = buildAccountBridge(raw, snapshot, {
    bindingId,
    gameItems,
    gameNameRu: (key) => nameInLocale(key, "ru"),
    mastery,
    profile: profile && profile.status !== "account-changed" ? profile : undefined,
  });
  if (
    ctx.currentInventoryData !== raw ||
    getInventorySource() !== source ||
    getLoadedInventoryModifiedAt() !== stamp ||
    (getInventoryBindingFingerprint(getLoadedInventoryHash()) ?? "manual") !== bindingId
  )
    throw new Error("Источник инвентаря изменился во время подготовки. Повтори запрос.");
  return doc;
}
