/**
 * Shared agentic container reference for dashboard API and proxy hooks.
 */
import type { Container } from '../container.js';
export declare function setAgenticContainer(container: Container | null): void;
export declare function getAgenticContainer(): Container | null;
/** Lazily create agentic services when dashboard is used without a full proxy boot. */
export declare function ensureAgenticContainer(): Promise<Container | null>;
/** Default: enabled when container is set. Set MASTYF_AI_AGENTIC_ENABLED=false to disable hooks. */
export declare function isAgenticEnabled(): boolean;
export declare function isAgenticDemoMode(): boolean;
//# sourceMappingURL=agentic-container.d.ts.map