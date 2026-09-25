import { Logger } from './logger.js';
const hooks = [];
let shuttingDown = false;
export function onShutdown(hook) {
    hooks.push(hook);
}
async function runShutdown(signal) {
    if (shuttingDown)
        return;
    shuttingDown = true;
    Logger.info(`[mastyf-ai] Received ${signal} — shutting down gracefully`);
    for (const hook of hooks) {
        try {
            await Promise.resolve(hook());
        }
        catch (err) {
            Logger.error('[mastyf-ai] Shutdown hook error: ' + (err instanceof Error ? err.message : String(err)));
        }
    }
    process.exit(0);
}
export function registerShutdownHandlers() {
    process.on('SIGINT', () => void runShutdown('SIGINT'));
    process.on('SIGTERM', () => void runShutdown('SIGTERM'));
    process.on('uncaughtException', (err) => {
        Logger.error('[mastyf-ai] Uncaught exception: ' + (err instanceof Error ? err.message : String(err)));
        void runShutdown('uncaughtException');
    });
}
//# sourceMappingURL=shutdown.js.map