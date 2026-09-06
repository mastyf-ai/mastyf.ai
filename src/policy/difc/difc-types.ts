/**
 * Decentralized Information Flow Control (DIFC) & Dynamic Taint Tracking Core Types
 *
 * Implements Myers & Liskov (1997) decentralized label model adapted for
 * Model Context Protocol (MCP) and autonomous AI agent tool execution.
 */

export type SecrecyTag =
  | 'confidential'
  | 'credentials'
  | 'filesystem_private'
  | 'pii'
  | 'financial'
  | 'database_internal'
  | 'email_private'
  | 'session_token'
  | string;

export type IntegrityTag =
  | 'trusted_system'
  | 'trusted_user'
  | 'untrusted_web'
  | 'untrusted_email'
  | 'untrusted_third_party'
  | 'prompt_injection'
  | string;

export interface DIFCLabel {
  secrecy: Set<SecrecyTag>;
  integrity: Set<IntegrityTag>;
}

export interface SerializedDIFCLabel {
  secrecy: string[];
  integrity: string[];
}

/**
 * Creates an empty DIFC label (public secrecy, trusted system integrity).
 */
export function createEmptyLabel(): DIFCLabel {
  return {
    secrecy: new Set<SecrecyTag>(),
    integrity: new Set<IntegrityTag>(['trusted_system']),
  };
}

/**
 * Creates a confidential label with specific secrecy and integrity tags.
 */
export function createLabel(secrecyTags: SecrecyTag[], integrityTags: IntegrityTag[] = []): DIFCLabel {
  return {
    secrecy: new Set(secrecyTags),
    integrity: new Set(integrityTags),
  };
}

/**
 * Information flow rule:
 * Data labeled `fromLabel` can flow to an entity requiring `toLabel` iff:
 * 1. S_from ⊆ S_to (no unauthorized disclosure / no secrecy violation)
 * 2. I_to ⊆ I_from (no unauthorized corruption / destination does not demand integrity source lacks)
 */
export function canFlow(fromLabel: DIFCLabel, toLabel: DIFCLabel): boolean {
  // Secrecy check: every secrecy requirement in fromLabel must be accommodated by toLabel
  for (const s of fromLabel.secrecy) {
    if (!toLabel.secrecy.has(s)) {
      return false;
    }
  }
  // Integrity check: every integrity requirement expected by toLabel must be satisfied by fromLabel
  for (const i of toLabel.integrity) {
    if (!fromLabel.integrity.has(i)) {
      return false;
    }
  }
  return true;
}

/**
 * Join operation in the DIFC lattice:
 * S_joined = S_a ∪ S_b (more confidential)
 * I_joined = I_a ∩ I_b (less integrity / more tainted)
 */
export function joinLabels(a: DIFCLabel, b: DIFCLabel): DIFCLabel {
  const secrecy = new Set<SecrecyTag>([...a.secrecy, ...b.secrecy]);
  const integrity = new Set<IntegrityTag>();
  for (const i of a.integrity) {
    if (b.integrity.has(i)) {
      integrity.add(i);
    }
  }
  return { secrecy, integrity };
}

export type ToolSecurityType = 'source' | 'sink' | 'internal' | 'bidirectional';

export interface ToolSecurityProfile {
  type: ToolSecurityType;
  /** Secrecy tags assigned to data emitted/returned by this tool. */
  producesSecrecy?: SecrecyTag[];
  /** Integrity tags assigned to data returned by this tool (e.g. untrusted_web). */
  producesIntegrity?: IntegrityTag[];
  /** Maximum secrecy tags this tool is authorized to transmit/egress. Empty set = zero egress clearance. */
  egressClearance: Set<SecrecyTag>;
  /** Minimum integrity tags required for input arguments to this tool. */
  requiredIntegrity?: Set<IntegrityTag>;
}

/**
 * Declassification Grant: allows a specific principal or session to declassify
 * a specific secrecy tag for a specific egress tool.
 */
export interface DeclassificationGrant {
  grantId: string;
  sessionKey: string;
  sourceTag: SecrecyTag;
  authorizedSink: string;
  issuedAt: number;
  expiresAt: number;
  signature?: string;
}

export interface SensitiveFragment {
  fragmentId: string;
  sourceTool: string;
  secrecyTags: SecrecyTag[];
  contentSample: string;
  contentHash: string;
  contentLength: number;
  timestamp: number;
}

export interface SessionTaintState {
  sessionKey: string;
  activeIntegrityTags: Set<IntegrityTag>;
  sensitiveFragments: SensitiveFragment[];
  declassificationGrants: DeclassificationGrant[];
  totalViolationsPrevented: number;
  lastUpdated: number;
}
