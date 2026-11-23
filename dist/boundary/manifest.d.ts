/**
 * Boundary Manifest Parser & Loader.
 *
 * Defines the expected security boundaries, network routes,
 * protected services, and credential isolation invariants.
 */
import { BoundaryManifest } from './types.js';
export declare function getDefaultBoundaryManifest(): BoundaryManifest;
export declare function loadBoundaryManifest(explicitPath?: string): BoundaryManifest;
export declare function validateAndMergeManifest(parsed: Partial<BoundaryManifest>): BoundaryManifest;
//# sourceMappingURL=manifest.d.ts.map