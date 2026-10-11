import fs from "node:fs";
import fsp from "node:fs/promises";
import https from "node:https";
import { safeStorage } from "electron";
import { userDataPath } from "./userDataPath";
import { writeFileAtomicSync } from "./atomicFile";
import type { AccountBridgeDocument } from "./accountBridge";

type Pairing = { format: "wantedframe.pairing.v1"; server: string; token: string };
type Settings = Pairing & { automatic: boolean; bindingId: string | null };
export interface BridgeSyncStatus {
  connected: boolean;
  server: string | null;
  automatic: boolean;
  busy: boolean;
  lastSentAt: number | null;
  lastRevision: string | null;
  error: string | null;
}
let settings: Settings | null | undefined;
let busy: Promise<void> | null = null;
let abortActive: (() => void) | null = null;
let generation = 0;
let lastSentAt: number | null = null;
let lastRevision: string | null = null;
let error: string | null = null;
const configFile = () => userDataPath("wantedframe-chatgpt.connection");
function canEncrypt(): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false;
  return process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text";
}
export function validatePairing(raw: unknown): Pairing {
  if (!raw || typeof raw !== "object") throw new Error("Неверный файл подключения");
  const p = raw as Record<string, unknown>;
  if (
    p.format !== "wantedframe.pairing.v1" ||
    typeof p.server !== "string" ||
    typeof p.token !== "string" ||
    !/^[A-Za-z0-9_-]{43,128}$/.test(p.token)
  )
    throw new Error("Неверный файл подключения");
  const url = new URL(p.server);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["", "/"].includes(url.pathname)
  )
    throw new Error("Нужен HTTPS-адрес сервера без пути, логина и параметров");
  return { format: "wantedframe.pairing.v1", server: url.origin, token: p.token };
}
function load(): Settings | null {
  if (settings !== undefined) return settings;
  settings = null;
  try {
    if (!canEncrypt() || !fs.existsSync(configFile())) return null;
    const raw = JSON.parse(safeStorage.decryptString(fs.readFileSync(configFile()))) as Record<
      string,
      unknown
    >;
    const pair = validatePairing(raw);
    const binding =
      typeof raw.bindingId === "string" && /^(?:[a-f0-9]{64}|manual)$/.test(raw.bindingId)
        ? raw.bindingId
        : null;
    settings = { ...pair, automatic: raw.automatic === true, bindingId: binding };
  } catch {
    error = "Не удалось открыть сохранённое подключение; импортируй файл заново";
  }
  return settings;
}
function persist(next: Settings): void {
  if (!canEncrypt())
    throw new Error("Защищённое хранилище ОС недоступно; токен не будет сохранён открытым текстом");
  const encrypted = safeStorage.encryptString(JSON.stringify(next));
  writeFileAtomicSync(configFile(), encrypted);
  fs.chmodSync(configFile(), 0o600);
  settings = next;
}
export function bridgeSyncStatus(): BridgeSyncStatus {
  const cfg = load();
  return {
    connected: !!cfg,
    server: cfg?.server ?? null,
    automatic: cfg?.automatic ?? false,
    busy: !!busy,
    lastSentAt,
    lastRevision,
    error,
  };
}
/** Invoked only after the owner selects and confirms a local pairing file. */
export function connectBridge(pair: Pairing): void {
  generation++;
  abortActive?.();
  persist({ ...validatePairing(pair), automatic: false, bindingId: null });
  error = null;
  lastRevision = null;
  lastSentAt = null;
}
export function setAutomaticBridge(enabled: boolean): void {
  const cfg = load();
  if (!cfg) throw new Error("Сначала подключи сервер");
  if (enabled && (!cfg.bindingId || cfg.bindingId === "manual"))
    throw new Error(
      "Автосинхронизация требует подтверждённой привязки снимка к игровому аккаунту. Сначала отправь один снимок вручную.",
    );
  persist({ ...cfg, automatic: enabled });
  if (!enabled) {
    generation++;
    abortActive?.();
  }
}
export async function disconnectBridge(): Promise<void> {
  generation++;
  abortActive?.();
  settings = null;
  await fsp.rm(configFile(), { force: true });
  error = null;
  lastRevision = null;
  lastSentAt = null;
}
/** Only the explicitly paired destination is contacted. Redirects never receive the token. */
export function pushBridge(doc: AccountBridgeDocument): Promise<void> {
  if (busy) return Promise.reject(new Error("Отправка уже выполняется"));
  const cfg = load();
  if (!cfg) return Promise.reject(new Error("Сервер не подключён"));
  if (cfg.bindingId && cfg.bindingId !== doc.bindingId)
    return Promise.reject(
      new Error(
        "Аккаунт изменился. Переподключи сервер отдельно; данные аккаунтов не смешиваются.",
      ),
    );
  const requestGeneration = generation;
  busy = (async () => {
    const body = Buffer.from(JSON.stringify(doc));
    if (body.length > 24 * 1024 * 1024) throw new Error("Снимок слишком большой");
    const response = await new Promise<{ revision: string }>((resolve, reject) => {
      const request = https.request(
        new URL("/ingest", cfg.server),
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${cfg.token}`,
            "Content-Type": "application/json",
            "Content-Length": body.length,
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          let bytes = 0;
          res.on("data", (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > 16 * 1024) {
              res.destroy();
              request.destroy();
              reject(new Error("Ответ сервера слишком большой"));
            } else chunks.push(chunk);
          });
          res.on("error", () => reject(new Error("Ошибка чтения ответа сервера")));
          res.on("end", () => {
            if (res.statusCode !== 200) {
              reject(
                new Error(
                  res.statusCode === 409
                    ? "Сервер отказал: другой аккаунт или устаревший снимок"
                    : `Сервер вернул HTTP ${res.statusCode ?? 0}`,
                ),
              );
              return;
            }
            try {
              const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
              if (data.revision !== doc.revision || data.accepted !== true) throw new Error();
              resolve(data);
            } catch {
              reject(new Error("Сервер не подтвердил сохранение снимка"));
            }
          });
        },
      );
      const timeout = setTimeout(() => request.destroy(new Error("timeout")), 30_000);
      abortActive = () => request.destroy(new Error("cancelled"));
      request.on("error", () =>
        reject(new Error("Не удалось отправить снимок; предыдущие данные на сервере сохранены")),
      );
      request.on("close", () => {
        clearTimeout(timeout);
        abortActive = null;
      });
      request.end(body);
    });
    if (requestGeneration !== generation) return;
    if (!cfg.bindingId) persist({ ...cfg, bindingId: doc.bindingId });
    lastSentAt = Date.now();
    lastRevision = response.revision;
    error = null;
  })()
    .catch((e: unknown) => {
      if (requestGeneration === generation)
        error = e instanceof Error ? e.message : "Синхронизация не выполнена";
      throw e;
    })
    .finally(() => {
      busy = null;
    });
  return busy;
}

export function noteBridgeSyncFailure(): void {
  error ??=
    "Не удалось подготовить снимок. Проверь загрузку инвентаря и привязку аккаунта; повтори отправку вручную.";
}
