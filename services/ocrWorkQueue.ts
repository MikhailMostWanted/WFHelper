/** Bound native OCR work, including calls whose caller has already timed out. */
export class OcrWorkQueue {
  private active = 0;
  private pending: Array<() => void> = [];
  constructor(private readonly concurrency = 2, private readonly maxPending = 8) {}
  run<T>(work: () => Promise<T>, timeoutMs: number): Promise<T> {
    if (this.active >= this.concurrency && this.pending.length >= this.maxPending) {
      return Promise.reject(new Error("OCR busy; retry on a newer frame"));
    }
    return new Promise<T>((resolve, reject) => {
      let expired = false;
      const timeout = setTimeout(() => {
        expired = true;
        this.pending = this.pending.filter((entry) => entry !== start);
        reject(new Error("OCR deadline exceeded"));
      }, Math.max(1, Math.min(10_000, Number.isFinite(timeoutMs) ? timeoutMs : 2000)));
      const start = () => {
        if (expired) return;
        this.active++;
        Promise.resolve().then(work).then(
          (value) => { if (!expired) resolve(value); },
          (error: unknown) => { if (!expired) reject(error); },
        ).finally(() => {
          clearTimeout(timeout);
          // A timeout does not cancel native code; retain its capacity until completion.
          this.active--;
          this.pending.shift()?.();
        });
      };
      if (this.active < this.concurrency) start();
      else this.pending.push(start);
    });
  }
}
