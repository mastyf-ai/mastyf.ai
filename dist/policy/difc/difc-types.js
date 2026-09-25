/**
 * Decentralized Information Flow Control (DIFC) & Dynamic Taint Tracking Core Types
 *
 * Implements Myers & Liskov (1997) decentralized label model adapted for
 * Model Context Protocol (MCP) and autonomous AI agent tool execution.
 */
/**
 * Creates an empty DIFC label (public secrecy, trusted system integrity).
 */
export function createEmptyLabel() {
    return {
        secrecy: new Set(),
        integrity: new Set(['trusted_system']),
    };
}
/**
 * Creates a confidential label with specific secrecy and integrity tags.
 */
export function createLabel(secrecyTags, integrityTags = []) {
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
export function canFlow(fromLabel, toLabel) {
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
export function joinLabels(a, b) {
    const secrecy = new Set([...a.secrecy, ...b.secrecy]);
    const integrity = new Set();
    for (const i of a.integrity) {
        if (b.integrity.has(i)) {
            integrity.add(i);
        }
    }
    return { secrecy, integrity };
}
//# sourceMappingURL=difc-types.js.map