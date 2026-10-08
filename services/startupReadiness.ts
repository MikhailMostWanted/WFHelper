let pending: Promise<void> | null = null;
let complete: (() => void) | null = null;
let failed = false;
export function beginStartupData(): void {
  failed = false;
  pending = new Promise<void>((resolve) => {
    complete = resolve;
  });
}
export function finishStartupData(ok = true): void {
  failed = !ok;
  complete?.();
  complete = null;
}
export async function waitForStartupData(): Promise<void> {
  await pending;
  if (failed) throw new Error("Item database initialization failed; restart WantedFrame");
}
