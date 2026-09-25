/**
 * Curated prompt injection payload patterns.
 *
 * These regex patterns detect known injection techniques in tool call arguments.
 * Categories follow the OWASP LLM Top 10 classification for prompt injection.
 *
 * Patterns are compiled once at import time for performance.
 */
export const PROMPT_INJECTION_PATTERNS = [
    // ── Directive Override ──────────────────────────────────────────
    {
        category: 'directive_override',
        description: 'Attempt to override system instructions or agent directives',
        confidence: 0.95,
        patterns: [
            /ignore\s+(all\s+)?(previous|above|prior|earlier)\s+(instructions?|prompts?|directives?|messages?|context)/i,
            /disregard\s+(all\s+)?(previous|above|prior|earlier)\s+(instructions?|prompts?|directives?)/i,
            /forget\s+(everything|all\s+(previous|above)\s+(instructions?|context))/i,
            /override\s+(system\s+)?(instructions?|prompts?|directives?)/i,
            /do\s+not\s+follow\s+(previous|above|original)\s+(instructions?|rules?)/i,
            /(stop|cease)\s+following\s+(previous|above)\s+(instructions?|commands?)/i,
        ],
    },
    // ── Role Confusion ──────────────────────────────────────────────
    {
        category: 'role_confusion',
        description: 'Attempt to make the agent assume a different persona or role',
        confidence: 0.85,
        patterns: [
            /you\s+are\s+now\s+(a\s+)?(different|new)\s+(AI|assistant|system|model|agent)/i,
            /from\s+now\s+on\s+you\s+(are|will\s+be|act\s+as)\s+(a\s+)?(malicious|evil|unrestricted|DAN)/i,
            /pretend\s+(you\s+are|to\s+be)\s+(a\s+)?(different|someone\s+else)/i,
            /you\s+are\s+no\s+longer\s+(an?\s+)?(AI|assistant|Claude|GPT)/i,
            /your\s+(new\s+)?(name|identity|role)\s+(is|will\s+be)\s+/i,
            /act\s+as\s+if\s+you\s+(are|were)\s+(a\s+)?(human|developer|hacker|expert)/i,
        ],
    },
    // ── Hidden Instruction ──────────────────────────────────────────
    {
        category: 'hidden_instruction',
        description: 'Instructions concealed within seemingly benign data (comments, URLs, code)',
        confidence: 0.75,
        patterns: [
            /<\|?im_start\|?>\s*(system|assistant|user)/i,
            /<\|?im_end\|?>/i,
            /\[system\]:?\s*\(/i,
            /\[INST\].*\[\\INST\]/i,
            /<\|system\|>.*<\|\\system\|>/i,
            /Human:\s*Ignore\s+all/i,
            /Assistant:\s*(I\s+will|OK|Sure|Understood)/i,
        ],
    },
    // ── Payload Concealment ─────────────────────────────────────────
    {
        category: 'payload_concealment',
        description: 'Obfuscated or encoded injection attempts',
        confidence: 0.80,
        patterns: [
            // Base64 hints (long base64 strings in text arguments)
            /[A-Za-z0-9+/]{40,}={0,2}/,
            // Hex-encoded ASCII that looks like text
            /(?:\\x[0-9a-fA-F]{2}){8,}/,
            // Unicode homoglyph attacks
            /[\u0390-\u03FF\u0400-\u04FF]{4,}/,
            // Rot13 hints
            /VTAVBER|SBERG|VAFGEHPGVBAF/,
            // Encoded HTML entities
            /&#(?:x?[0-9a-fA-F]+|[0-9]+);/,
        ],
    },
    // ── Data Exfiltration ───────────────────────────────────────────
    {
        category: 'data_exfiltration',
        description: 'Attempt to exfiltrate data to external location',
        confidence: 0.90,
        patterns: [
            /(send|forward|copy|post|upload)\s+(this|the|all)\s+(data|content|conversation|output|result)\s+to/i,
            /curl\s+.*\b(POST|PUT)\b.*\b(https?:\/\/|ftp:\/\/)/i,
            /webhook.*(send|post|deliver|forward)/i,
            /exfiltrate.*(data|info|secrets?|keys?|tokens?)/i,
            /(save|write)\s+(this|the)\s+(output|result|data)\s+to\s+(https?:\/\/|ftp:\/\/)/i,
        ],
    },
    // ── Multi-language Injection ────────────────────────────────────
    {
        category: 'directive_override',
        description: 'Non-English prompt injection attempts',
        confidence: 0.80,
        patterns: [
            // Chinese
            /忽略\s*(所有)?\s*(之前|以上|前面)\s*(的)?\s*(指令|指示|说明|提示)/i,
            /忘记\s*(所有|一切)\s*(之前|以上)\s*(的)?\s*(指令|内容)/i,
            // Japanese
            /(以前|これまで|上記)\s*(の)?\s*(指示|命令|プロンプト)\s*(を)?\s*(無視|忘れ)/i,
            // Korean
            /(이전|위|앞서)\s*(의)?\s*(지시|명령|프롬프트)\s*(를)?\s*(무시|잊어)/i,
            // Russian
            /игнорируй(те)?\s*(все)?\s*(предыдущие|вышеуказанные)\s*(инструкции|указания|команды)/i,
        ],
    },
    // ── Token/Session Theft ─────────────────────────────────────────
    {
        category: 'data_exfiltration',
        description: 'Attempt to steal API tokens or session data via tool arguments',
        confidence: 0.90,
        patterns: [
            /(show|reveal|display|print|output|echo)\s+(your|the)\s+(API\s+)?(key|token|secret|password|credential)/i,
            /what\s+is\s+(your|the)\s+(API\s+)?(key|token|secret)/i,
            /dump\s+(your|the)\s+(memory|context|system\s+prompt|instructions)/i,
            /repeat\s+(your|the)\s+(system\s+prompt|initial\s+instructions|hidden\s+rules)/i,
        ],
    },
    // ── Context Window Manipulation ─────────────────────────────────
    {
        category: 'directive_override',
        description: 'Attempt to manipulate context window or attention mechanism',
        confidence: 0.70,
        patterns: [
            /^\[IMPORTANT\].*\[\\IMPORTANT\]$/is,
            /^\[CRITICAL\].*\[\\CRITICAL\]$/is,
            /^###\s*IMPORTANT\s*###[\s\S]*###\s*END\s*IMPORTANT\s*###/i,
            /priority:\s*(highest|maximum|urgent|critical|override)/i,
            /EMERGENCY\s+OVERRIDE/i,
            /ADMIN\s+OVERRIDE/i,
        ],
    },
];
//# sourceMappingURL=payload-patterns.js.map