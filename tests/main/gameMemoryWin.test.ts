import { beforeEach, describe, expect, it, vi } from "vitest";

// Process discovery moved to services/win32Process; the fake below still owns
// which pids exist and what each one's image path is.
const win32 = vi.hoisted(() => ({ processes: [] as { pid: number; imagePath: string }[] }));

vi.mock("../../services/win32Process", () => ({
  enumProcessIds: () => win32.processes.map((process) => process.pid),
  exePathOfPid: (pid: number) =>
    win32.processes.find((process) => process.pid === pid)?.imagePath ?? null,
  isWarframeExePath: (exePath: string | null) =>
    typeof exePath === "string" && exePath.toLowerCase().endsWith("\\warframe.x64.exe"),
}));

import { readGameAuthzWin } from "../../services/gameMemoryWin";

const ACCOUNT_ID = "0123456789abcdef01234567";
const AUTHZ = `?accountId=${ACCOUNT_ID}&nonce=1712345678901`;

interface FakeRegion {
  base: bigint;
  size: bigint;
  contents?: string;
  failed?: boolean;
  reportedBytes?: bigint;
}

interface FakeProcess {
  pid: number;
  imagePath?: string;
  regions: FakeRegion[];
}

function nativeFn(implementation: (...args: unknown[]) => unknown) {
  return Object.assign(vi.fn(implementation), { async: vi.fn() });
}

function createWin32Fake(processes: FakeProcess[]) {
  const byPid = new Map(processes.map((process) => [process.pid, process]));
  win32.processes = processes.map((process) => ({
    pid: process.pid,
    imagePath: process.imagePath ?? "C:\\Games\\Warframe.x64.exe",
  }));
  const openProcess = nativeFn((access: unknown, _inherit: unknown, pidValue: unknown) => {
    const pid = pidValue as number;
    if (!byPid.has(pid)) return 0;
    return pid * 10 + (access === 0x1000 ? 1 : 2);
  });
  const closeHandle = nativeFn(() => 1);
  const getLastError = nativeFn(() => 0);
  const enumProcesses = nativeFn((pids: unknown, _size: unknown, used: unknown) => {
    for (const [index, process] of processes.entries()) {
      (pids as Buffer).writeUInt32LE(process.pid, index * 4);
    }
    (used as Buffer).writeUInt32LE(processes.length * 4, 0);
    return 1;
  });
  const queryImageName = nativeFn(
    (handleValue: unknown, _flags: unknown, output: unknown, size: unknown) => {
      const process = byPid.get(Math.floor((handleValue as number) / 10));
      if (!process) return 0;
      const imagePath = process.imagePath ?? "C:\\Games\\Warframe.x64.exe";
      Buffer.from(imagePath, "utf16le").copy(output as Buffer);
      (size as Buffer).writeUInt32LE(imagePath.length, 0);
      return 1;
    },
  );
  const virtualQuery = nativeFn(
    (handleValue: unknown, addressValue: unknown, output: unknown, _size: unknown) => {
      const process = byPid.get(Math.floor((handleValue as number) / 10));
      const region = process?.regions.find(({ base }) => base === (addressValue as bigint));
      if (!region) return 0;
      const mbi = output as Buffer;
      mbi.fill(0);
      mbi.writeBigUInt64LE(region.base, 0);
      mbi.writeBigUInt64LE(region.size, 24);
      mbi.writeUInt32LE(0x1000, 32);
      mbi.writeUInt32LE(0x04, 36);
      return 48;
    },
  );
  const readMemory = nativeFn(() => 0);
  readMemory.async.mockImplementation((...args: unknown[]) => {
    const process = byPid.get(Math.floor((args[0] as number) / 10));
    const region = process?.regions.find(({ base }) => base === (args[1] as bigint));
    const output = args[2] as Buffer;
    const bytesRead = args[4] as Buffer;
    const callback = args[5] as (error: Error | null, ok: number) => void;
    output.fill(0);
    if (region?.contents) output.write(region.contents, 0, "latin1");
    bytesRead.writeBigUInt64LE(region?.reportedBytes ?? region?.size ?? 0n, 0);
    callback(region?.failed ? new Error("partial copy") : null, region?.failed ? 0 : 1);
  });

  return {
    api: {
      OpenProcess: openProcess,
      CloseHandle: closeHandle,
      GetLastError: getLastError,
      VirtualQueryEx: virtualQuery,
      ReadProcessMemory: readMemory,
      EnumProcesses: enumProcesses,
      QueryFullProcessImageNameW: queryImageName,
    },
    readMemory,
  };
}

describe("Windows game-memory scan", () => {
  beforeEach(() => {
    win32.processes = [];
  });

  it("continues to a singleton after an oversized read report", async () => {
    const { api, readMemory } = createWin32Fake([
      {
        pid: 42,
        regions: [
          { base: 0n, size: 128n, reportedBytes: 9n * 1024n * 1024n * 1024n },
          { base: 128n, size: 128n, contents: AUTHZ },
        ],
      },
    ]);

    await expect(readGameAuthzWin(api as never)).resolves.toEqual({
      authz: AUTHZ,
      reason: "ok-1x",
    });
    expect(readMemory.async).toHaveBeenCalledTimes(2);
  });

  it("uses bytes returned with a partial-copy failure", async () => {
    const { api } = createWin32Fake([
      { pid: 42, regions: [{ base: 0n, size: 128n, contents: AUTHZ, failed: true }] },
    ]);

    await expect(readGameAuthzWin(api as never)).resolves.toEqual({
      authz: AUTHZ,
      reason: "ok-1x",
    });
  });

  it("scans every matching Warframe process", async () => {
    const { api } = createWin32Fake([
      { pid: 41, regions: [{ base: 0n, size: 128n, contents: "?accountId=invalid" }] },
      { pid: 42, regions: [{ base: 0n, size: 128n, contents: AUTHZ }] },
    ]);

    await expect(readGameAuthzWin(api as never)).resolves.toEqual({
      authz: AUTHZ,
      reason: "ok-1x",
    });
  });
});

it("drains an in-flight native read before closing its handle and refuses later scans", async () => {
  vi.resetModules();
  const memory = await import("../../services/gameMemoryWin");
  const { api, readMemory } = createWin32Fake([
    { pid: 42, regions: [{ base: 0n, size: 8n * 1024n * 1024n, contents: AUTHZ }] },
  ]);
  let finishRead!: () => void;
  readMemory.async.mockImplementation((...args: unknown[]) => {
    const output = args[2] as Buffer;
    const bytesRead = args[4] as Buffer;
    const callback = args[5] as (error: Error | null, ok: number) => void;
    output.fill(0);
    output.write(AUTHZ, 0, "latin1");
    bytesRead.writeBigUInt64LE(BigInt(AUTHZ.length), 0);
    finishRead = () => callback(null, 1);
  });

  const scan = memory.readGameAuthzWin(api as never);
  expect(readMemory.async).toHaveBeenCalledTimes(1);
  const shutdown = memory.stopGameMemoryReads();
  let drained = false;
  void shutdown.then(() => (drained = true));
  await Promise.resolve();
  expect(drained).toBe(false);
  expect(api.CloseHandle).not.toHaveBeenCalled();

  finishRead();
  await expect(scan).resolves.toEqual({ authz: null, reason: "shutdown" });
  await shutdown;
  expect(api.CloseHandle).toHaveBeenCalledExactlyOnceWith(422);
  expect(readMemory.async).toHaveBeenCalledTimes(1);
  const opened = api.OpenProcess.mock.calls.length;
  await expect(memory.readGameAuthzWin(api as never)).resolves.toEqual({
    authz: null,
    reason: "shutdown",
  });
  expect(api.OpenProcess).toHaveBeenCalledTimes(opened);
});
