/**
 * Tool Security Classification Catalog for DIFC
 *
 * Maps MCP and agent tool definitions into formal Source / Sink / Internal profiles.
 */
import type { ToolSecurityProfile } from './difc-types.js';
/**
 * Classifies a tool dynamically based on its name and arguments if not statically registered.
 */
export declare function getToolSecurityProfile(toolName: string): ToolSecurityProfile;
//# sourceMappingURL=tool-catalog.d.ts.map