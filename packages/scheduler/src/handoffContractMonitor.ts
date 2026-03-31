import { checkSLAs, type ContractSlaCheckResult } from '@glyphor/agent-runtime';

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

export class HandoffContractMonitor {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private running = false;

  start(intervalMs = DEFAULT_INTERVAL_MS): void {
    if (this.intervalId) return;
    console.log('[HandoffContractMonitor] Started');
    this.intervalId = setInterval(() => void this.tick(), intervalMs);
    void this.tick();
  }

  stop(): void {
    if (!this.intervalId) return;
    clearInterval(this.intervalId);
    this.intervalId = null;
    console.log('[HandoffContractMonitor] Stopped');
  }

  private async tick(): Promise<ContractSlaCheckResult | null> {
    if (this.running) return null;
    this.running = true;
    try {
      const result = await checkSLAs();
      if (result.breached > 0) {
        console.log('[HandoffContractMonitor] SLA breaches:', JSON.stringify(result));
      }
      return result;
    } catch (err) {
      console.error('[HandoffContractMonitor] Tick failed:', (err as Error).message);
      return null;
    } finally {
      this.running = false;
    }
  }
}