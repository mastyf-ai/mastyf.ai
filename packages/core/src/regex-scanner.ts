import type { Issue, ToolDefinition } from "./types.js";
import { hasConfusableDelta, normalizeUnicode } from "./confusables.js";
import { findUnsafeUrls } from "./url-allowlist.js";

export interface RegexScanOptions {
  /** TR39 confusables + NFKC before pattern match (default: true). */
  unicodeStrict?: boolean;
}

interface PatternRule {
  id: string;               // Stable MCPG-R-### ID
  category: string;
  severity: "critical" | "warning";
  pattern: RegExp;
  message: string;
}

// ─── CRITICAL PATTERNS ────────────────────────────────────────────────────────

const CRITICAL_RULES: PatternRule[] = [
  // Cross-tool chaining
  { id: "MCPG-R-001", category: "cross-tool", severity: "critical",
    pattern: /before\s+using\s+this\s+tool/i,
    message: "Attempts to chain execution before this tool is invoked" },
  { id: "MCPG-R-002", category: "cross-tool", severity: "critical",
    pattern: /first\s+call\s+(?:the\s+)?[\w_]+/i,
    message: "Directs agent to call another tool first" },
  { id: "MCPG-R-003", category: "cross-tool", severity: "critical",
    pattern: /then\s+execute\s+(?:the\s+)?[\w_]+/i,
    message: "Chains execution to another tool after invocation" },
  { id: "MCPG-R-004", category: "cross-tool", severity: "critical",
    pattern: /always\s+(?:call|invoke|run|execute)/i,
    message: "Forces unconditional tool invocation" },
  { id: "MCPG-R-005", category: "cross-tool", severity: "critical",
    pattern: /you\s+must\s+(?:also\s+)?(?:call|invoke|run|execute)/i,
    message: "Mandatory side-effect tool call embedded in description" },

  // Privilege escalation
  { id: "MCPG-R-010", category: "privilege-escalation", severity: "critical",
    pattern: /ignore\s+(?:previous|prior|all\s+previous)\s+instructions/i,
    message: "Classic prompt injection: instruction override" },
  { id: "MCPG-R-011", category: "privilege-escalation", severity: "critical",
    pattern: /you\s+are\s+now\s+(?:a|an|the)/i,
    message: "Attempts to redefine agent identity/role" },
  { id: "MCPG-R-012", category: "privilege-escalation", severity: "critical",
    pattern: /bypass\s+(?:security|safety|restrictions|guidelines|policies)/i,
    message: "Explicit security bypass instruction" },
  { id: "MCPG-R-013", category: "privilege-escalation", severity: "critical",
    pattern: /override\s+(?:system|safety|security|all)\s+(?:prompt|instructions|policies)/i,
    message: "System-level instruction override attempt" },
  { id: "MCPG-R-014", category: "privilege-escalation", severity: "critical",
    pattern: /disregard\s+(?:your|all|any|previous)\s+(?:instructions|guidelines|rules|training)/i,
    message: "Instruction discard directive" },
  { id: "MCPG-R-015", category: "privilege-escalation", severity: "critical",
    pattern: /act\s+as\s+(?:if|though)\s+you\s+(?:have\s+no|don'?t\s+have)/i,
    message: "Attempts to strip agent constraints" },
  { id: "MCPG-R-016", category: "privilege-escalation", severity: "critical",
    pattern: /pretend\s+(?:you\s+are|to\s+be)\s+(?:a|an|the)/i,
    message: "Role-play injection in tool description" },
  { id: "MCPG-R-017", category: "privilege-escalation", severity: "critical",
    pattern: /your\s+new\s+(?:primary\s+)?(?:goal|objective|mission|task|directive)/i,
    message: "Goal replacement injection" },

  // Exfiltration (embedded URLs handled separately via url-allowlist)
  { id: "MCPG-R-021", category: "exfiltration", severity: "critical",
    pattern: /send\s+(?:the\s+)?(?:result|data|output|response|content|this)\s+to/i,
    message: "Explicit data forwarding directive" },
  { id: "MCPG-R-022", category: "exfiltration", severity: "critical",
    pattern: /(?:post|upload|transmit|forward|relay)\s+(?:to|the\s+result\s+to)/i,
    message: "Data transmission instruction" },
  { id: "MCPG-R-023", category: "exfiltration", severity: "critical",
    pattern: /webhook/i,
    message: "Webhook reference — potential exfiltration vector" },
  { id: "MCPG-R-024", category: "exfiltration", severity: "critical",
    pattern: /exfiltrat/i,
    message: "Literal exfiltration reference" },

  // Stealth / anti-detection
  { id: "MCPG-R-030", category: "stealth", severity: "critical",
    pattern: /do\s+not\s+(?:tell|inform|mention|reveal|show|disclose)\s+(?:the\s+)?user/i,
    message: "Concealment directive targeting user visibility" },
  { id: "MCPG-R-031", category: "stealth", severity: "critical",
    pattern: /keep\s+(?:this|it|the\s+following)\s+(?:secret|hidden|confidential|private)/i,
    message: "Secrecy instruction embedded in tool description" },
  { id: "MCPG-R-032", category: "stealth", severity: "critical",
    pattern: /without\s+(?:the\s+user'?s?\s+)?knowledge/i,
    message: "Explicit instruction to operate covertly" },
  { id: "MCPG-R-033", category: "stealth", severity: "critical",
    pattern: /silently|invisibly|covertly|surreptitiously/i,
    message: "Covert operation keyword in tool description" },
];

// ─── WARNING PATTERNS ─────────────────────────────────────────────────────────

const WARNING_RULES: PatternRule[] = [
  // Sensitive paths
  { id: "MCPG-R-100", category: "sensitive-path", severity: "warning",
    pattern: /~\/\.(?:ssh|aws|gnupg|config|kube|docker|npmrc|pypirc)/i,
    message: "Reference to sensitive home directory credential files" },
  { id: "MCPG-R-101", category: "sensitive-path", severity: "warning",
    pattern: /\/etc\/(?:passwd|shadow|sudoers|hosts)/i,
    message: "Reference to sensitive system files" },
  { id: "MCPG-R-102", category: "sensitive-path", severity: "warning",
    pattern: /\.env(?:\.local|\.production|\.staging)?(?:\b|$)/i,
    message: "Reference to environment variable files" },
  { id: "MCPG-R-103", category: "sensitive-path", severity: "warning",
    pattern: /(?:api[_\-]?key|secret[_\-]?key|access[_\-]?token|private[_\-]?key)/i,
    message: "Credential keyword reference" },
  { id: "MCPG-R-104", category: "sensitive-path", severity: "warning",
    pattern: /authorized_keys|id_rsa|id_ed25519/i,
    message: "SSH key file reference" },

  // Encoding / obfuscation
  { id: "MCPG-R-110", category: "encoded-content", severity: "warning",
    pattern: /(?:[A-Za-z0-9+/]{40,}={0,2})(?:\s|$)/,
    message: "Long Base64-like string — potential obfuscated instruction" },
  { id: "MCPG-R-111", category: "encoded-content", severity: "warning",
    pattern: /\\u[0-9a-fA-F]{4}/,
    message: "Unicode escape sequence — potential obfuscation" },
  { id: "MCPG-R-112", category: "encoded-content", severity: "warning",
    pattern: /\\x[0-9a-fA-F]{2}/,
    message: "Hex escape sequence — potential obfuscation" },

  // Unusual meta-instructions
  { id: "MCPG-R-120", category: "meta-instruction", severity: "warning",
    pattern: /\[SYSTEM\]|\[INST\]|\[\/INST\]|<\|system\|>/i,
    message: "LLM prompt delimiter embedded in description" },
  { id: "MCPG-R-121", category: "meta-instruction", severity: "warning",
    pattern: /<!-- .{5,} -->/,
    message: "HTML comment in tool description — potential hidden instruction" },
];

const MULTI_STEP_CHAIN = /\bbefore\b[\s\S]{0,120}?\bthen\b/i;
const FIRST_THEN_CHAIN = /\bfirst\b[\s\S]{0,120}?\bthen\b/i;
const CONFUSABLE_BEFORE = /\bb[\u0435e]fore\b/i;

const ALL_RULES = [...CRITICAL_RULES, ...WARNING_RULES];

export function runRegexScan(
  tool: ToolDefinition,
  options: RegexScanOptions = {},
): Issue[] {
  const issues: Issue[] = [];
  const raw = tool.description ?? "";
  const unicodeStrict = options.unicodeStrict !== false;
  const text = unicodeStrict ? normalizeUnicode(raw) : raw;

  if (unicodeStrict && hasConfusableDelta(raw)) {
    issues.push({
      id: "MCPG-R-092",
      layer: "regex",
      severity: "warning",
      category: "confusable",
      message: "Unicode confusable / homoglyph obfuscation in description (TR39 normalized)",
      evidence: raw.slice(0, 80),
      confidence: 0.85,
    });
  }

  if (MULTI_STEP_CHAIN.test(text)) {
    issues.push({
      id: "MCPG-R-090",
      layer: "regex",
      severity: "critical",
      category: "cross-tool",
      message: "Multi-step tool chain directive (before…then) in description",
      evidence: text.match(MULTI_STEP_CHAIN)?.[0]?.slice(0, 80) || "",
      confidence: 0.9,
    });
  }
  if (FIRST_THEN_CHAIN.test(text)) {
    issues.push({
      id: "MCPG-R-093",
      layer: "regex",
      severity: "critical",
      category: "cross-tool",
      message: "Multi-step tool chain directive (first…then) in description",
      evidence: text.match(FIRST_THEN_CHAIN)?.[0]?.slice(0, 80) || "",
      confidence: 0.9,
    });
  }
  if (CONFUSABLE_BEFORE.test(raw) || CONFUSABLE_BEFORE.test(text)) {
    issues.push({
      id: "MCPG-R-091",
      layer: "regex",
      severity: "warning",
      category: "confusable",
      message: "Possible homoglyph obfuscation in description",
      evidence: "before (mixed script)",
      confidence: 0.75,
    });
  }

  for (const rule of ALL_RULES) {
    const match = rule.pattern.exec(text);
    if (match) {
      issues.push({
        id: rule.id,
        layer: "regex",
        severity: rule.severity,
        category: rule.category,
        message: rule.message,
        evidence: match[0].trim(),
        confidence: 1.0,  // Regex is deterministic
      });
    }
  }

  for (const unsafeUrl of findUnsafeUrls(text)) {
    issues.push({
      id: "MCPG-R-020",
      layer: "regex",
      severity: "critical",
      category: "exfiltration",
      message: "Embedded URL — potential exfiltration endpoint",
      evidence: unsafeUrl.trim(),
      confidence: 1.0,
    });
  }

  return issues;
}