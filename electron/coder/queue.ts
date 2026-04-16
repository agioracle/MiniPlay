/**
 * Simple serial execution queue.
 * Ensures only one code agent process runs at a time per project.
 */
export class SerialQueue {
  private queue: Array<() => Promise<void>> = [];
  private running = false;

  async enqueue<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const result = await fn();
          resolve(result);
        } catch (err) {
          reject(err);
        }
      });
      this.processNext();
    });
  }

  private async processNext(): Promise<void> {
    if (this.running || this.queue.length === 0) return;
    this.running = true;
    const task = this.queue.shift()!;
    try {
      await task();
    } finally {
      this.running = false;
      this.processNext();
    }
  }
}
