/**
 * CMQ Physical Network Isolation Templates.
 *
 * Generates Docker and Kubernetes infrastructure definitions enforcing
 * that the agent has NO physical network route to protected tools except
 * through Mastyf.
 */
import { BoundaryManifest } from './types.js';
export declare function generateDockerCompose(manifest: BoundaryManifest): string;
export declare function generateKubernetesNetworkPolicies(manifest: BoundaryManifest): string;
//# sourceMappingURL=templates.d.ts.map