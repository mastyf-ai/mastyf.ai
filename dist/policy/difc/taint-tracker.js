/**
 * Dynamic Session Taint & Information Flow Tracker
 *
 * Tracks confidential data fragments and integrity taints across multi-call agent sessions.
 * Enforces DIFC non-exfiltration invariants before tool dispatch.
 */
import { LRUCache } from 'lru-cache';
import { createHash } from 'crypto';
import { getToolSecurityProfile } from './tool-catalog.js';
import { walkStringLeaves } from '../arg-leaf-walker.js';
const MIN_FRAGMENT_MATCH_LEN = 6;
const MAX_FRAGMENTS_PER_SESSION = 100;
const SESSION_TTL_MS = 15 * 60 * 1000; // 15 minutes
export class SessionTaintTracker {
    sessions;
    constructor() {
        this.sessions = new LRUCache({
            max: 20_000,
            ttl: SESSION_TTL_MS,
            updateAgeOnGet: true,
        });
    }
    getOrCreateSession(sessionKey) {
        let state = this.sessions.get(sessionKey);
        if (!state) {
            state = {
                sessionKey,
                activeIntegrityTags: new Set(),
                sensitiveFragments: [],
                declassificationGrants: [],
                totalViolationsPrevented: 0,
                lastUpdated: Date.now(),
            };
            this.sessions.set(sessionKey, state);
        }
        return state;
    }
    /**
     * Ingest a tool execution response into the session's information flow state.
     */
    ingestToolResponse(params) {
        const { sessionKey, toolName, output, explicitSecrecyTags, explicitIntegrityTags } = params;
        if (output == null)
            return;
        const state = this.getOrCreateSession(sessionKey);
        const profile = getToolSecurityProfile(toolName);
        // 1. Record Integrity Taints (e.g. from web or untrusted third-party reads)
        const integrityTags = explicitIntegrityTags || profile.producesIntegrity || [];
        for (const tag of integrityTags) {
            state.activeIntegrityTags.add(tag);
        }
        // 2. Record Secrecy Fragments (e.g. from sensitive files, credentials, PII)
        const secrecyTags = explicitSecrecyTags || profile.producesSecrecy || [];
        if (secrecyTags.length > 0) {
            const text = typeof output === 'string' ? output : JSON.stringify(output);
            this.extractAndStoreFragments(state, toolName, text, secrecyTags);
        }
        state.lastUpdated = Date.now();
    }
    /**
     * Extract meaningful sensitive substrings from text and index them in session memory.
     */
    extractAndStoreFragments(state, sourceTool, text, secrecyTags) {
        // If output is moderate size, store whole text as primary fragment
        const trimmed = text.trim();
        if (trimmed.length >= MIN_FRAGMENT_MATCH_LEN && trimmed.length <= 4096) {
            this.addFragment(state, sourceTool, trimmed, secrecyTags);
        }
        // Also extract structured values (JSON key-values, email addresses, keys, lines)
        const lines = trimmed.split(/[\r\n]+/);
        for (const line of lines) {
            const l = line.trim();
            if (l.length >= MIN_FRAGMENT_MATCH_LEN && l.length <= 512) {
                // Exclude common formatting artifacts like '{' or '}'
                if (!/^[{}[\],"]+$/.test(l)) {
                    this.addFragment(state, sourceTool, l, secrecyTags);
                }
            }
        }
        // Extract specific token patterns: email, addresses, API keys, hashes
        const tokenRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b|\b[A-Za-z0-9_-]{16,}\b/g;
        let match;
        while ((match = tokenRegex.exec(trimmed)) !== null) {
            const tok = match[0];
            if (tok.length >= MIN_FRAGMENT_MATCH_LEN) {
                this.addFragment(state, sourceTool, tok, secrecyTags);
            }
        }
    }
    addFragment(state, sourceTool, content, secrecyTags) {
        if (content.length < MIN_FRAGMENT_MATCH_LEN)
            return;
        // Prevent duplicate fragments
        const hash = createHash('sha256').update(content).digest('hex').slice(0, 16);
        if (state.sensitiveFragments.some((f) => f.contentHash === hash)) {
            return;
        }
        const fragment = {
            fragmentId: `frag_${Date.now()}_${state.sensitiveFragments.length}`,
            sourceTool,
            secrecyTags,
            contentSample: content,
            contentHash: hash,
            contentLength: content.length,
            timestamp: Date.now(),
        };
        state.sensitiveFragments.push(fragment);
        if (state.sensitiveFragments.length > MAX_FRAGMENTS_PER_SESSION) {
            state.sensitiveFragments.shift();
        }
    }
    /**
     * Evaluate proposed tool call arguments against the session's DIFC state.
     * Deterministically intercepts cross-tool secret exfiltration.
     */
    evaluateDIFC(params) {
        const { sessionKey, toolName, args } = params;
        const state = this.getOrCreateSession(sessionKey);
        const profile = getToolSecurityProfile(toolName);
        const hasIntegrityTaint = state.activeIntegrityTags.has('untrusted_web') ||
            state.activeIntegrityTags.has('untrusted_email') ||
            state.activeIntegrityTags.has('prompt_injection');
        // If session has no sensitive fragments recorded, allow immediately
        if (state.sensitiveFragments.length === 0) {
            return {
                allowed: true,
                taintContext: {
                    hasIntegrityTaint,
                    activeIntegrityTags: Array.from(state.activeIntegrityTags),
                    secrecyViolations: [],
                },
            };
        }
        if (!args || Object.keys(args).length === 0) {
            return {
                allowed: true,
                taintContext: {
                    hasIntegrityTaint,
                    activeIntegrityTags: Array.from(state.activeIntegrityTags),
                    secrecyViolations: [],
                },
            };
        }
        // Extract all string leaf values from proposed tool arguments
        const stringLeaves = walkStringLeaves(args).map((l) => l.value.toLowerCase());
        const argBlob = stringLeaves.join(' \n ');
        // Check each sensitive fragment against arguments (bidirectional n-gram matching >= 6 chars)
        for (const fragment of state.sensitiveFragments) {
            const needle = fragment.contentSample.toLowerCase();
            let matched = argBlob.includes(needle);
            if (!matched && needle.length >= 6) {
                // Also check if any argument leaf >= 6 chars is a sub-slice of the sensitive secret
                for (const leaf of stringLeaves) {
                    if (leaf.length >= 6 && needle.includes(leaf)) {
                        matched = true;
                        break;
                    }
                }
            }
            if (matched) {
                // Taint may flow to sources and internal tools. Enforce clearance only at egress sinks.
                if (profile.type !== 'sink') {
                    continue;
                }
                for (const tag of fragment.secrecyTags) {
                    const hasClearance = profile.egressClearance.has(tag);
                    const hasGrant = this.hasValidDeclassificationGrant(state, tag, toolName);
                    if (!hasClearance && !hasGrant) {
                        // DIFC Violation!
                        state.totalViolationsPrevented++;
                        const snippet = fragment.contentSample.length > 40
                            ? `${fragment.contentSample.slice(0, 37)}...`
                            : fragment.contentSample;
                        return {
                            allowed: false,
                            violation: {
                                sourceTool: fragment.sourceTool,
                                sinkTool: toolName,
                                secrecyTag: tag,
                                matchedSample: snippet,
                                reason: `DIFC violation: data derived from '${fragment.sourceTool}' (secrecy: ${tag}) cannot flow to egress sink '${toolName}' without declassification clearance`,
                            },
                            taintContext: {
                                hasIntegrityTaint,
                                activeIntegrityTags: Array.from(state.activeIntegrityTags),
                                secrecyViolations: [tag],
                            },
                        };
                    }
                }
            }
        }
        return {
            allowed: true,
            taintContext: {
                hasIntegrityTaint,
                activeIntegrityTags: Array.from(state.activeIntegrityTags),
                secrecyViolations: [],
            },
        };
    }
    hasValidDeclassificationGrant(state, tag, sinkTool) {
        const now = Date.now();
        return state.declassificationGrants.some((g) => g.sourceTag === tag &&
            (g.authorizedSink === '*' || g.authorizedSink === sinkTool) &&
            g.expiresAt > now);
    }
    /**
     * Authorize an explicit declassification grant for the session.
     */
    addDeclassificationGrant(grant) {
        const state = this.getOrCreateSession(grant.sessionKey);
        state.declassificationGrants.push(grant);
    }
    /**
     * Reset session state (useful for tests or session boundary close).
     */
    resetSession(sessionKey) {
        this.sessions.delete(sessionKey);
    }
}
export const globalSessionTaintTracker = new SessionTaintTracker();
//# sourceMappingURL=taint-tracker.js.map