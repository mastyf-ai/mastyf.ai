import { Logger } from './logger.js';

type ShutdownHook = () => void | Promise<void>;

const hooks: ShutdownHook[] = [];
let shuttingDown = false;

export function onShutdown(hook: ShutdownHook): void {
  hooks.push(hook);
}

async function runShutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  Logger.info(`[guardian] Received ${signal} — shutting down gracefully`);

  for (const hook of hooks) {
    try {
      await Promise.resolve(hook());
    } catch (err) {
      Logger.error('[guardian] Shutdown hook error: ' + (err instanceof Error ? err.message : String(err)));
    }
  }

  process.exit(0);
}

export function registerShutdownHandlers(): void {
  process.on('SIGINT',  () => void runShutdown('SIGINT'));
  process.on('SIGTERM', () => void runShutdown('SIGTERM'));
  process.on('uncaughtException', (err) => {
    Logger.error('[guardian] Uncaught exception: ' + (err instanceof Error ? err.message : String(err)));
    void runShutdown('uncaughtException');
  });
}