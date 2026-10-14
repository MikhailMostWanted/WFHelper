// Compatibility scan for PCs where Sainan's helper rejects a valid singleton.
import { bestAuthz, createAuthzScanDiagnostics, scanBufferForAuthz } from "./gameMemoryAuthz";
import { withScope } from "./logger";
import { enumProcessIds, exePathOfPid, isWarframeExePath } from "./win32Process";

const log = withScope("gameMemoryWin");

// Keep the fallback optional on unsupported systems.
let _koffi: typeof import("koffi") | null = null;
function koffi(): typeof import("koffi") {
  if (!_koffi) _koffi = require("koffi") as typeof import("koffi");
  return _koffi;
}

let _api: Win32 | null = null;
let _apiFailed = false;

// koffi's KoffiFunction type is not exported; a callable with `.async` is all
// we need. `.async` appends a Node-style callback and runs off the main thread.
type NativeFn = ((...args: unknown[]) => unknown) & {
  async: (...args: unknown[]) => void;
};

interface Win32 {
  OpenProcess: NativeFn;
  CloseHandle: NativeFn;
  GetLastError: NativeFn;
  VirtualQueryEx: NativeFn;
  ReadProcessMemory: NativeFn;
}

function loadApi(): Win32 | null {
  if (_api) return _api;
  if (_apiFailed) return null;
  try {
    const k = koffi();
    const kernel32 = k.load("kernel32.dll");
    _api = {
      // Win32 BOOL is a 4-byte int; koffi's "bool" is 1 byte and leaves garbage
      // in the upper bytes, so always declare BOOL params/returns as int32.
      OpenProcess: kernel32.func("OpenProcess", "void *", [
        "uint32",
        "int32",
        "uint32",
      ]) as NativeFn,
      CloseHandle: kernel32.func("CloseHandle", "int32", ["void *"]) as NativeFn,
      GetLastError: kernel32.func("GetLastError", "uint32", []) as NativeFn,
      // lpAddress/lpBaseAddress declared as uint64 so we can pass raw BigInt
      // addresses (same 8-byte ABI as a pointer) instead of pointer objects.
      VirtualQueryEx: kernel32.func("VirtualQueryEx", "size_t", [
        "void *",
        "uint64",
        "void *",
        "size_t",
      ]) as NativeFn,
      ReadProcessMemory: kernel32.func("ReadProcessMemory", "int32", [
        "void *",
        "uint64",
        "void *",
        "size_t",
        "void *",
      ]) as NativeFn,
    };
    return _api;
  } catch (err) {
    _apiFailed = true;
    log.warn("koffi load failed - native memory scan unavailable:", errMsg(err));
    return null;
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const PROCESS_QUERY_INFORMATION = 0x0400;
const PROCESS_VM_READ = 0x0010;
const MEM_COMMIT = 0x1000;
const PAGE_NOACCESS = 0x01;
const PAGE_EXECUTE = 0x10;
const PAGE_GUARD = 0x100;
// x64 MEMORY_BASIC_INFORMATION is 48 bytes; fields we read: BaseAddress@0,
// RegionSize@24, State@32, Protect@36 (all little-endian).
const MBI_SIZE = 48;
const USER_ADDRESS_CEILING = 0x7fffffff0000n;
const CHUNK = 4 * 1024 * 1024;
// Keep auth strings intact across chunk boundaries.
const OVERLAP = 256;

interface AuthzResult {
  authz: string | null;
  reason: string;
}

function findWarframePids(): number[] {
  return enumProcessIds().filter((pid) => isWarframeExePath(exePathOfPid(pid)));
}

function isReadableRegion(state: number, protect: number): boolean {
  if (state !== MEM_COMMIT) return false;
  if (protect & PAGE_GUARD) return false;
  if (protect === PAGE_NOACCESS || protect === PAGE_EXECUTE) return false;
  return true;
}

interface MemoryReadResult {
  bytesRead: number;
  failed: boolean;
}

function readMemory(
  api: Win32,
  hProc: unknown,
  addr: bigint,
  out: Buffer,
  len: number,
  bytesReadBuf: Buffer,
): Promise<MemoryReadResult> {
  return new Promise((resolve) => {
    bytesReadBuf.fill(0);
    api.ReadProcessMemory.async(
      hProc,
      addr,
      out,
      len,
      bytesReadBuf,
      (err: Error | null, ok: number) => {
        const reported = Number(bytesReadBuf.readBigUInt64LE(0));
        const bytesRead = Number.isSafeInteger(reported) ? Math.min(reported, len, out.length) : 0;
        resolve({ bytesRead, failed: Boolean(err) || ok === 0 });
      },
    );
  });
}

let memoryReadsStopped = false;
const activeScans = new Set<Promise<AuthzResult>>();

/** Stop between native reads; a read already in flight must finish before its handle closes. */
export function stopGameMemoryReads(): Promise<void> {
  memoryReadsStopped = true;
  return Promise.allSettled([...activeScans]).then(() => undefined);
}

export function readGameAuthzWin(apiOverride?: Win32): Promise<AuthzResult> {
  if (memoryReadsStopped) return Promise.resolve({ authz: null, reason: "shutdown" });
  const scan = scanGameAuthzWin(apiOverride);
  activeScans.add(scan);
  void scan.then(
    () => activeScans.delete(scan),
    () => activeScans.delete(scan),
  );
  return scan;
}

async function scanGameAuthzWin(apiOverride?: Win32): Promise<AuthzResult> {
  if (memoryReadsStopped) return { authz: null, reason: "shutdown" };
  const api = apiOverride ?? loadApi();
  if (!api) return { authz: null, reason: "mem-open-noapi" };

  const pids = findWarframePids();
  if (pids.length === 0) return { authz: null, reason: "process-not-found" };

  const counts = new Map<string, number>();
  const diagnostics = createAuthzScanDiagnostics();
  const mbi = Buffer.alloc(MBI_SIZE);
  const chunk = Buffer.allocUnsafe(CHUNK);
  const bytesReadBuf = Buffer.alloc(8);
  let scanned = 0n;
  let markerHits = 0;
  let readableRegions = 0;
  let iterations = 0;
  let openedProcesses = 0;
  let firstOpenError: number | null = null;
  let failedReads = 0;
  let partialReads = 0;

  for (const pid of pids) {
    if (memoryReadsStopped) return { authz: null, reason: "shutdown" };
    const hProc = api.OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, 0, pid) as unknown;
    if (!hProc) {
      firstOpenError ??= api.GetLastError() as number;
      continue;
    }
    openedProcesses += 1;

    try {
      let addr = 0n;
      while (addr < USER_ADDRESS_CEILING) {
        if (memoryReadsStopped) return { authz: null, reason: "shutdown" };
        const written = api.VirtualQueryEx(hProc, addr, mbi, MBI_SIZE) as number;
        if (written === 0) break;

        const base = mbi.readBigUInt64LE(0);
        const regionSize = mbi.readBigUInt64LE(24);
        const state = mbi.readUInt32LE(32);
        const protect = mbi.readUInt32LE(36);
        const nextAddr = base + regionSize;
        if (regionSize === 0n || nextAddr <= addr) break;

        if (isReadableRegion(state, protect)) {
          readableRegions += 1;
          let off = 0n;
          while (off < regionSize) {
            if (memoryReadsStopped) return { authz: null, reason: "shutdown" };
            const remaining = regionSize - off;
            const len = remaining < BigInt(CHUNK) ? Number(remaining) : CHUNK;
            const read = await readMemory(api, hProc, base + off, chunk, len, bytesReadBuf);
            if (memoryReadsStopped) return { authz: null, reason: "shutdown" };
            if (read.failed) {
              if (read.bytesRead > 0) partialReads += 1;
              else failedReads += 1;
            }
            if (read.bytesRead > 0) {
              markerHits += scanBufferForAuthz(
                chunk.subarray(0, read.bytesRead),
                counts,
                diagnostics,
              );
              scanned += BigInt(read.bytesRead);
            }
            if (len <= OVERLAP) break;
            off += BigInt(len - OVERLAP);
            if (++iterations % 16 === 0) await new Promise((r) => setImmediate(r));
          }
        }
        addr = nextAddr;
      }
    } finally {
      api.CloseHandle(hProc);
    }
  }

  if (memoryReadsStopped) return { authz: null, reason: "shutdown" };

  if (openedProcesses === 0) return { authz: null, reason: `mem-open-${firstOpenError ?? 0}` };

  if (counts.size === 0) {
    const gib = (Number(scanned) / (1024 * 1024 * 1024)).toFixed(1);
    log.warn(
      `No valid auth matches: markers=${markerHits}, processes=${openedProcesses}/${pids.length}, ` +
        `scanned=${gib} GiB, regions=${readableRegions}, failedReads=${failedReads}, ` +
        `partialReads=${partialReads}, rejects=${JSON.stringify(diagnostics)}`,
    );
    return { authz: null, reason: "crumbs-not-found" };
  }
  const { authz, hits, ambiguous } = bestAuthz(counts);
  if (ambiguous) {
    log.warn(`Multiple auth matches share the highest frequency (${hits}) - refusing all`);
    return { authz: null, reason: "crumbs-ambiguous" };
  }
  if (counts.size > 1) {
    log.warn(`Multiple distinct auth matches (${counts.size}) - using the most frequent`);
  }
  return { authz, reason: `ok-${hits}x` };
}
