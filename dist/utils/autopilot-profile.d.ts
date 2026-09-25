/**
 * Mastyf AI Autopilot — single env preset for plug-and-play operation.
 */
import { type AutopilotConfig } from './autopilot-config.js';
export declare function isAutopilotMode(): boolean;
/** Apply Autopilot env defaults (does not override explicitly set vars). */
export declare function applyAutopilotEnv(config?: AutopilotConfig | null): void;
/** Force Autopilot env (used by `autopilot start`). */
export declare function forceAutopilotEnv(config?: AutopilotConfig | null): void;
//# sourceMappingURL=autopilot-profile.d.ts.map