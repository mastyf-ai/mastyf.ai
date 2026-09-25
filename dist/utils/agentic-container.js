import { Logger } from './logger.js';
let _agenticContainer = null;
let _initPromise = null;
export function setAgenticContainer(container) {
    _agenticContainer = container;
    if (container)
        _initPromise = null;
}
export function getAgenticContainer() {
    return _agenticContainer;
}
/** Lazily create agentic services when dashboard is used without a full proxy boot. */
export async function ensureAgenticContainer() {
    if (_agenticContainer)
        return _agenticContainer;
    if (process.env.MASTYF_AI_AGENTIC_ENABLED === 'false')
        return null;
    if (!_initPromise) {
        _initPromise = (async () => {
            try {
                const { createContainer } = await import('../container.js');
                const dbPath = process.env.MASTYF_AI_DB_PATH;
                const container = await createContainer(dbPath);
                _agenticContainer = container;
                Logger.info('[agentic] Container initialized for dashboard API');
                return container;
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                Logger.warn(`[agentic] Failed to initialize container: ${msg}`);
                return null;
            }
            finally {
                _initPromise = null;
            }
        })();
    }
    return _initPromise;
}
/** Default: enabled when container is set. Set MASTYF_AI_AGENTIC_ENABLED=false to disable hooks. */
export function isAgenticEnabled() {
    if (process.env.MASTYF_AI_AGENTIC_ENABLED === 'false')
        return false;
    return _agenticContainer != null;
}
export function isAgenticDemoMode() {
    return process.env.MASTYF_AI_AGENTIC_DEMO_MODE === 'true';
}
//# sourceMappingURL=agentic-container.js.map