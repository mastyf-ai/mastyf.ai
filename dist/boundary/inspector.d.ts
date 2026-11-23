/**
 * CMQ Topology Inspector.
 *
 * Implements Level 1 (Declarative) and Level 2 (Environmental) evidence gathering:
 * 1. Prohibited credentials leaked into agent environment.
 * 2. Unmediated direct listening sockets and active direct route probing.
 * 3. Shell and subprocess escape surface.
 * 4. Local filesystem permissions on secret stores (~/.ssh, ~/.aws, /var/run/secrets).
 * 5. Docker network and Kubernetes namespace isolation inspection.
 */
import { BoundaryManifest, TopologyInspectionReport } from './types.js';
export declare function inspectTopology(manifest: BoundaryManifest, agentEnv?: NodeJS.ProcessEnv): Promise<TopologyInspectionReport>;
//# sourceMappingURL=inspector.d.ts.map