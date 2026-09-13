#!/usr/bin/env node
// Runs a command on a separate Windows desktop so Electron windows never reach the screen;
// Playwright screenshots still work since they come from Chromium, not the visible desktop.
import { spawn, spawnSync } from "node:child_process";
import process from "node:process";

const DESKTOP_NAME = "WFHelperSandbox";
const args = process.argv.slice(2);
if (args[0] === "--") args.shift();
if (args.length === 0) {
  console.error("usage: node scripts/hidden-desktop.mjs [--probe] <command...>");
  process.exit(2);
}

if (process.platform !== "win32") {
  const child = spawn(args[0], args.slice(1), { stdio: "inherit" });
  child.on("error", (error) => {
    console.error(`hidden-desktop: could not start command: ${error.message}`);
    process.exitCode = 1;
  });
  child.on("exit", (code) => process.exit(code ?? 1));
} else {
  const koffi = (await import("koffi")).default;
  const user32 = koffi.load("user32.dll");
  const kernel32 = koffi.load("kernel32.dll");
  const GetLastError = kernel32.func("__stdcall", "GetLastError", "uint32", []);
  const fail = (what) => {
    console.error(`hidden-desktop: ${what} failed (error ${GetLastError()})`);
    process.exit(1);
  };

  if (args[0] === "--probe") {
    probe();
  } else {
    launch();
  }

  function probe() {
    const OpenDesktopW = user32.func("__stdcall", "OpenDesktopW", "void*", [
      "str16",
      "uint32",
      "int32",
      "uint32",
    ]);
    const CloseDesktop = user32.func("__stdcall", "CloseDesktop", "int32", ["void*"]);
    const EnumProc = koffi.proto("int32 __stdcall EnumProc(void *hwnd, intptr lParam)");
    const EnumDesktopWindows = user32.func("__stdcall", "EnumDesktopWindows", "int32", [
      "void*",
      koffi.pointer(EnumProc),
      "intptr",
    ]);
    const IsWindowVisible = user32.func("__stdcall", "IsWindowVisible", "int32", ["void*"]);
    const GetWindowThreadProcessId = user32.func(
      "__stdcall",
      "GetWindowThreadProcessId",
      "uint32",
      ["void*", "_Out_ uint32*"],
    );
    const GetClassNameW = user32.func("__stdcall", "GetClassNameW", "int32", [
      "void*",
      "void*",
      "int32",
    ]);
    const DESKTOP_READOBJECTS_ENUMERATE = 0x0041;
    const images = new Map();
    const list = spawnSync("tasklist", ["/FO", "CSV", "/NH"], { encoding: "utf8" });
    for (const line of (list.stdout || "").split(/\r?\n/)) {
      const cells = line.split('","');
      if (cells.length > 1)
        images.set(Number(cells[1].replace(/"/g, "")), cells[0].replace(/"/g, ""));
    }
    const GetProcessWindowStation = user32.func(
      "__stdcall",
      "GetProcessWindowStation",
      "void*",
      [],
    );
    const EnumDesktopProc = koffi.proto(
      "int32 __stdcall EnumDesktopProc(str16 name, intptr lParam)",
    );
    const EnumDesktopsW = user32.func("__stdcall", "EnumDesktopsW", "int32", [
      "void*",
      koffi.pointer(EnumDesktopProc),
      "intptr",
    ]);
    const names = [];
    const collect = koffi.register((name) => {
      names.push(name);
      return 1;
    }, koffi.pointer(EnumDesktopProc));
    EnumDesktopsW(GetProcessWindowStation(), collect, 0);
    koffi.unregister(collect);
    for (const name of names) {
      const desktop = OpenDesktopW(name, 0, 0, DESKTOP_READOBJECTS_ENUMERATE);
      if (!desktop) {
        console.log(`${name}: not open (error ${GetLastError()})`);
        continue;
      }
      const rows = [];
      const buffer = Buffer.alloc(512);
      const callback = koffi.register((hwnd) => {
        if (!IsWindowVisible(hwnd)) return 1;
        const pid = [0];
        GetWindowThreadProcessId(hwnd, pid);
        const length = GetClassNameW(hwnd, buffer, 256);
        rows.push(
          `${images.get(pid[0]) ?? "?"} pid ${pid[0]} ${buffer.toString("utf16le", 0, length * 2)}`,
        );
        return 1;
      }, koffi.pointer(EnumProc));
      EnumDesktopWindows(desktop, callback, 0);
      koffi.unregister(callback);
      CloseDesktop(desktop);
      const electron = rows.filter((row) => row.startsWith("electron.exe")).length;
      console.log(`${name}: ${rows.length} visible windows, ${electron} from electron.exe`);
      for (const row of rows.filter((row) => row.startsWith("electron.exe")).slice(0, 12))
        console.log(`  ${row}`);
    }
    process.exit(0);
  }

  function launch() {
    const CreateDesktopW = user32.func("__stdcall", "CreateDesktopW", "void*", [
      "str16",
      "str16",
      "void*",
      "uint32",
      "uint32",
      "void*",
    ]);
    const GetStdHandle = kernel32.func("__stdcall", "GetStdHandle", "void*", ["int32"]);
    const SetHandleInformation = kernel32.func("__stdcall", "SetHandleInformation", "int32", [
      "void*",
      "uint32",
      "uint32",
    ]);
    const STARTUPINFOW = koffi.struct("STARTUPINFOW", {
      cb: "uint32",
      lpReserved: "str16",
      lpDesktop: "str16",
      lpTitle: "str16",
      dwX: "uint32",
      dwY: "uint32",
      dwXSize: "uint32",
      dwYSize: "uint32",
      dwXCountChars: "uint32",
      dwYCountChars: "uint32",
      dwFillAttribute: "uint32",
      dwFlags: "uint32",
      wShowWindow: "uint16",
      cbReserved2: "uint16",
      lpReserved2: "void*",
      hStdInput: "void*",
      hStdOutput: "void*",
      hStdError: "void*",
    });
    koffi.struct("PROCESS_INFORMATION", {
      hProcess: "void*",
      hThread: "void*",
      dwProcessId: "uint32",
      dwThreadId: "uint32",
    });
    const CreateProcessW = kernel32.func("__stdcall", "CreateProcessW", "int32", [
      "str16",
      "str16",
      "void*",
      "void*",
      "int32",
      "uint32",
      "void*",
      "str16",
      "STARTUPINFOW*",
      "_Out_ PROCESS_INFORMATION*",
    ]);
    const JOB_LIMITS = koffi.struct("JOBOBJECT_EXTENDED_LIMIT_INFORMATION", {
      PerProcessUserTimeLimit: "int64",
      PerJobUserTimeLimit: "int64",
      LimitFlags: "uint32",
      MinimumWorkingSetSize: "size_t",
      MaximumWorkingSetSize: "size_t",
      ActiveProcessLimit: "uint32",
      Affinity: "size_t",
      PriorityClass: "uint32",
      SchedulingClass: "uint32",
      ReadOperationCount: "uint64",
      WriteOperationCount: "uint64",
      OtherOperationCount: "uint64",
      ReadTransferCount: "uint64",
      WriteTransferCount: "uint64",
      OtherTransferCount: "uint64",
      ProcessMemoryLimit: "size_t",
      JobMemoryLimit: "size_t",
      PeakProcessMemoryUsed: "size_t",
      PeakJobMemoryUsed: "size_t",
    });
    const CreateJobObjectW = kernel32.func("__stdcall", "CreateJobObjectW", "void*", [
      "void*",
      "str16",
    ]);
    const SetInformationJobObject = kernel32.func("__stdcall", "SetInformationJobObject", "int32", [
      "void*",
      "int32",
      "JOBOBJECT_EXTENDED_LIMIT_INFORMATION*",
      "uint32",
    ]);
    const AssignProcessToJobObject = kernel32.func(
      "__stdcall",
      "AssignProcessToJobObject",
      "int32",
      ["void*", "void*"],
    );
    const ResumeThread = kernel32.func("__stdcall", "ResumeThread", "uint32", ["void*"]);
    const WaitForSingleObject = kernel32.func("__stdcall", "WaitForSingleObject", "uint32", [
      "void*",
      "uint32",
    ]);
    const GetExitCodeProcess = kernel32.func("__stdcall", "GetExitCodeProcess", "int32", [
      "void*",
      "_Out_ uint32*",
    ]);
    const CloseHandle = kernel32.func("__stdcall", "CloseHandle", "int32", ["void*"]);

    const GENERIC_ALL = 0x10000000;
    const HANDLE_FLAG_INHERIT = 0x1;
    const STARTF_USESTDHANDLES = 0x100;
    const CREATE_SUSPENDED = 0x4;
    const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;
    const JobObjectExtendedLimitInformation = 9;
    const INFINITE = 0xffffffff;

    // CreateDesktop opens the desktop when it already exists, so reruns share it.
    const desktop = CreateDesktopW(DESKTOP_NAME, null, null, 0, GENERIC_ALL, null);
    if (!desktop) fail("CreateDesktopW");

    const std = [-10, -11, -12].map((id) => {
      const handle = GetStdHandle(id);
      SetHandleInformation(handle, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT);
      return handle;
    });
    // Preserve argv through Win32 parsing without interpreting shell metacharacters.
    const commandLine = args
      .map((arg) => `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, "$1$1")}"`)
      .join(" ");
    const startup = {
      cb: koffi.sizeof(STARTUPINFOW),
      lpReserved: null,
      lpDesktop: DESKTOP_NAME,
      lpTitle: null,
      dwX: 0,
      dwY: 0,
      dwXSize: 0,
      dwYSize: 0,
      dwXCountChars: 0,
      dwYCountChars: 0,
      dwFillAttribute: 0,
      dwFlags: STARTF_USESTDHANDLES,
      wShowWindow: 0,
      cbReserved2: 0,
      lpReserved2: null,
      hStdInput: std[0],
      hStdOutput: std[1],
      hStdError: std[2],
    };
    const info = {};
    if (
      !CreateProcessW(null, commandLine, null, null, 1, CREATE_SUSPENDED, null, null, startup, info)
    )
      fail("CreateProcessW");

    // Kill-on-close ties the whole tree to this launcher, so a killed run leaves no
    // Electron processes alive on a desktop nobody can see.
    const job = CreateJobObjectW(null, null);
    const limits = { LimitFlags: JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE };
    if (
      !job ||
      !SetInformationJobObject(
        job,
        JobObjectExtendedLimitInformation,
        limits,
        koffi.sizeof(JOB_LIMITS),
      ) ||
      !AssignProcessToJobObject(job, info.hProcess)
    )
      console.warn(`hidden-desktop: job object unavailable (error ${GetLastError()})`);
    ResumeThread(info.hThread);
    CloseHandle(info.hThread);

    console.log(`hidden-desktop: pid ${info.dwProcessId} on desktop ${DESKTOP_NAME}`);
    WaitForSingleObject(info.hProcess, INFINITE);
    const code = [0];
    GetExitCodeProcess(info.hProcess, code);
    CloseHandle(info.hProcess);
    process.exit(code[0]);
  }
}
