import type { SecretFinding } from '../types.js';
import { type DetectorPlugin, type DetectorScanContext } from './sdk.js';
export type { DetectorFinding, DetectorPlugin, DetectorScanContext, } from './sdk.js';
export { createDetectorPlugin, PLUGIN_SDK_VERSION } from './sdk.js';
export declare function registerDetectorPlugin(plugin: DetectorPlugin): void;
export declare function getRegisteredDetectorPlugins(): readonly DetectorPlugin[];
export declare function clearDetectorPluginsForTests(): void;
/** Plugins on by default in v2.7; set MASTYF_AI_PLUGINS_ENABLED=false to disable. */
export declare function areDetectorPluginsEnabled(): boolean;
/** Run registered plugins when enabled. */
export declare function runDetectorPlugins(text: string, ctx: DetectorScanContext): SecretFinding[];
/** Load *.js plugins from MASTYF_AI_PLUGIN_PATH (optional). */
export declare function loadDetectorPluginsFromPath(): Promise<void>;
//# sourceMappingURL=detector-plugin.d.ts.map