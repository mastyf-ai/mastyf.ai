/**
 * CMQ Escape Runner.
 *
 * Deliberately executes boundary-escape attempts against isolated canary services.
 * Tests 15 distinct escape vectors across network, credentials, MCP, shell, and processes.
 *
 * The core qualification invariant:
 * Could the protected system observe a successful unauthorized action without
 * Mastyf observing the corresponding request?
 */
import { BoundaryManifest, CMQSingleTestResult } from './types.js';
import { CMQCanaryHarness } from './canary-harness.js';
export declare function runEscapeSuite(manifest: BoundaryManifest, harness: CMQCanaryHarness, agentEnv?: NodeJS.ProcessEnv): Promise<CMQSingleTestResult[]>;
//# sourceMappingURL=escape-runner.d.ts.map