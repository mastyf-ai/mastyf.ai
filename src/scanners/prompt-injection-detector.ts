/**
 * Prompt Injection Detector — request arguments and response inspection.
 *
 * **Request path:** `scanToolCallArguments()` walks every string leaf in tool call
 * `arguments` (any key, nested objects/arrays) and runs the full regex rule set
 * (critical, high, medium).
 *
 * **Response path:** `detectPromptInjection()` scans upstream tool responses (proxy
 * response pipeline; unchanged).
 *
 * Detects adversarial content that attempts to:
 *   - Hijack the AI agent's behavior (jailbreak, role override, persona change)
 *   - Steal credentials or sensitive data (API keys, tokens, passwords)
 *   - Exfiltrate data to external URLs (curl, wget, fetch, pipes)
 *   - Execute arbitrary commands (bash, eval, exec, PowerShell)
 *   - Poison context (new goals, system prompts, instruction override)
 *   - Evade detection (Unicode homoglyphs, zero-width characters, base64)
 *   - Abuse tool chaining (instruct AI to call execute_command, bash, etc.)
 *
 */
import { walkStringLeaves } from '../policy/arg-leaf-walker.js';
import { deobfuscateRecursive } from '../utils/payload-normalizer.js';
import { DEFAULT_TRUSTED_EXFIL_DOMAINS, isTrustedDomainSquat } from '../utils/registrable-domain.js';

export interface InjectionFinding {
  severity:    'critical' | 'high' | 'medium';
  patternId:   string;
  description: string;
  matchPreview: string;
}

interface InjectionPattern {
  id:          string;
  severity:    'critical' | 'high' | 'medium';
  description: string;
  regex:       string;
}

/** Exported for adversarial-harness parity (Python reimplementation). */
export const INJECTION_RULES: InjectionPattern[] = [
  // ═══════════════════════════════════════════════════════════════
  // CATEGORY 1: Role / Persona Override — CRITICAL
  // ═══════════════════════════════════════════════════════════════
  { id: 'role-override', severity: 'critical', description: 'Role/persona override attempt',
    regex: '(?:you are now|you\'re now|act as|pretend (?:to be|you are)|your new (?:role|persona|identity|character) is)' },
  { id: 'role-override-v2', severity: 'critical', description: 'Role redefinition with character framing',
    regex: '(?:imagine you(?:\'re| are)|from this point forward,? you (?:are|will be)|you have been (?:reprogrammed|reconfigured|updated) to)' },
  { id: 'assistant-override', severity: 'critical', description: 'Assistant/helper persona redefinition',
    regex: '(?:you are (?:now )?(?:an? )?(?:unfiltered|unrestricted|uncensored|evil|malicious|dark|rogue|corrupt) (?:AI|assistant|bot|agent|model|chatbot))' },

  // ═══════════════════════════════════════════════════════════════
  // CATEGORY 2: Instruction Suppression — CRITICAL
  // ═══════════════════════════════════════════════════════════════
  { id: 'ignore-instructions', severity: 'critical', description: 'Instruction suppression',
    regex: '(?:ignore (?:all |previous |your |the |my |prior )?(?:instructions|rules|guidelines|system prompt|directives|constraints|limitations|restrictions|safety rules)|disregard (?:everything|all |previous )?(?:instructions|rules|above|before))' },
  { id: 'instruction-before-tool', severity: 'critical', description: 'Override instructions before tool use',
    regex: '(?:before|prior to) (?:using|calling|invoking|running) (?:this|the|any) tool.{0,80}(?:ignore|disregard|forget|override|bypass|circumvent)' },
  { id: 'forget-training', severity: 'critical', description: 'Forget/release from training constraints',
    regex: '(?:forget (?:everything|all|your (?:training|instructions|guidelines|safety|ethics))|release yourself from|break free from|escape (?:your )?(?:constraints|limitations|programming))' },
  { id: 'paraphrase-instruction-suppression', severity: 'critical', description: 'Paraphrased instruction override',
    regex: '(?:set aside (?:your |all )?(?:prior|previous|earlier) (?:guidance|instructions|rules|directives)|put aside (?:your )?(?:prior|previous) (?:instructions|guidelines)|disregard (?:your )?(?:prior|previous) (?:guidance|training))' },
  { id: 'newline-system-inject', severity: 'critical', description: 'Newline-delimited fake system block',
    regex: '(?:^|\\n\\n)\\s*(?:SYSTEM|System|system)\\s*:\\s*(?:you are|ignore|override|your new)' },
  { id: 'prompt-leak-polite', severity: 'high', description: 'Polite system prompt exfiltration request',
    regex: '(?:share|reveal|disclose|provide|print|repeat|output).{0,40}(?:system prompt|hidden instructions|original instructions|developer message)' },
  { id: 'indirect-goal-update', severity: 'high', description: 'Indirect primary goal reassignment',
    regex: '(?:primary|main|core|true|real) goal (?:has been|is now|was) (?:updated|changed|revised|replaced|reset)' },

  // ═══════════════════════════════════════════════════════════════
  // CATEGORY 2b: Multilingual instruction suppression — CRITICAL
  // ═══════════════════════════════════════════════════════════════
  { id: 'ml-inject-fr', severity: 'critical', description: 'French instruction suppression',
    regex: '(?:ignorez|oubliez|négligez).{0,40}(?:instructions|consignes|règles|directives)' },
  { id: 'ml-inject-es', severity: 'critical', description: 'Spanish instruction suppression',
    regex: '(?:ignora|olvida|desestima).{0,40}(?:instrucciones|reglas|directrices|indicaciones)' },
  { id: 'ml-inject-de', severity: 'critical', description: 'German instruction suppression',
    regex: '(?:ignorier|vergiss|missachte).{0,40}(?:anweisungen|regeln|vorgaben|direktiven)' },
  { id: 'ml-inject-pt', severity: 'critical', description: 'Portuguese instruction suppression',
    regex: '(?:ignore|esqueça|desconsidere).{0,40}(?:instruções|regras|diretrizes)' },
  { id: 'ml-inject-it', severity: 'critical', description: 'Italian instruction suppression',
    regex: '(?:ignora|dimentica|trascura).{0,40}(?:istruzioni|regole|direttive)' },
  { id: 'ml-inject-ar', severity: 'critical', description: 'Arabic instruction suppression (transliterated)',
    regex: '(?:تجاهل|تجاهلوا|انس|انسوا).{0,30}(?:التعليمات|القواعد)' },
  { id: 'ml-inject-zh', severity: 'critical', description: 'Chinese instruction suppression',
    regex: '(?:忽略|无视|不要遵守).{0,20}(?:之前|先前|所有|上面).{0,10}(?:指令|规则|说明|提示)' },
  { id: 'ml-inject-ja', severity: 'critical', description: 'Japanese instruction suppression',
    regex: '(?:無視|以前の|全ての).{0,15}(?:指示|命令|ルール)' },
  { id: 'ml-inject-ko', severity: 'critical', description: 'Korean instruction suppression',
    regex: '(?:무시|이전|모든).{0,15}(?:지시|명령|규칙)' },

  // ═══════════════════════════════════════════════════════════════
  // CATEGORY 3: Jailbreak / Unrestricted Mode — CRITICAL
  // ═══════════════════════════════════════════════════════════════
  { id: 'developer-mode', severity: 'critical', description: 'DAN/developer mode jailbreak',
    regex: '(?:developer mode|DAN mode|jailbreak|(?:bypass|circumvent|evade|work around).{0,40}(?:safety|(?:content\\s+)?filter|restriction|guardrail|content policy|moderation|detection)|turn off (?:safety|filter|restrictions?|guardrails?|content moderation))' },
  { id: 'evil-mode', severity: 'critical', description: 'Evil/opposite persona jailbreak',
    regex: '(?:evil (?:mode|twin|version|clone|persona)|opposite mode|dark (?:mode|version|side)|unleash(?:ed)? (?:mode|version))' },
  { id: 'safety-filters-off', severity: 'critical', description: 'Explicit safety filter disable',
    regex: '(?:turn off|disable|deactivate)\\s+(?:all\\s+)?(?:safety|content)\\s+(?:filters?|moderation|guardrails?|restrictions?)' },
  { id: 'safety-filters-off-v2', severity: 'critical', description: 'Safety filters disabled phrasing',
    regex: 'safety\\s+filters?\\s+(?:off|disabled)' },
  { id: 'inverse-instructions', severity: 'critical', description: 'Inverse/opposite instruction jailbreak',
    regex: '(?:inverse|opposite)\\s+(?:mode\\s*[:;]?\\s*)?(?:of\\s+)?(?:your\\s+)?instructions' },

  // ═══════════════════════════════════════════════════════════════
  // CATEGORY 4: Data Exfiltration — CRITICAL
  // ═══════════════════════════════════════════════════════════════
  { id: 'exfiltration-url', severity: 'critical', description: 'Data exfiltration via URL injection',
    regex: '(?:curl|wget|fetch|XMLHttpRequest|axios|ncat|nc\\s|netcat|telnet).{0,60}(?:https?://[\\w.-]+\\.[a-z]{2,})' },
  { id: 'exfiltration-bare-domain', severity: 'critical', description: 'Data exfiltration via bare domain curl/wget',
    regex: '(?:curl|wget)\\s+.*\\b[a-zA-Z0-9][-a-zA-Z0-9]*\\.(?:com|net|org|io|dev|xyz|ru|cn|tk|ml|ga|cf|gq|pw|top|club|online|site|website|space|fun|host|press|digital|world|life|co|me|us|eu|info|biz|pro|name|tv|cc|ws|fm|to|am|ai)\\b' },
  { id: 'exfiltration-instruction', severity: 'critical', description: 'Explicit exfiltration instruction',
    regex: '(?:send (?:this|the|all|your|the following) (?:conversation|data|context|history|credentials?|tokens?|keys?|secrets?|result|output) to)' },
  { id: 'exfiltration-webhook', severity: 'critical', description: 'Webhook/payload delivery instruction',
    regex: '(?:post (?:this|the|all|data|result|output) to|deliver (?:this|payload|data|result)s? to|forward (?:this|everything|the result) to)' },
  { id: 'pipe-exfiltration', severity: 'critical', description: 'Pipe to external transmission',
    regex: '\\|[\\s]*\\b(?:curl|wget|nc|netcat|ncat|sendmail|ssmtp|mail)\\b' },
  { id: 'indirect-exfil-logging', severity: 'critical', description: 'Indirect exfiltration via logging/debug channels',
    regex: '(?:results?|output|data|response|payload).{0,60}(?:will be|to be|should be|are being) (?:logged|recorded|streamed|written|persisted).{0,50}(?:debug|remote|external|upstream|endpoint|collector|syslog|metrics)' },
  { id: 'indirect-exfil-telemetry', severity: 'critical', description: 'Indirect exfiltration via metrics/trace/syslog',
    regex: '(?:send|post|stream|forward|upload|ship|emit|push|relay).{0,50}(?:metrics|telemetry|traces?|syslog|debug output|audit trail).{0,50}(?:to |into |at )(?:remote|external|upstream|off-?site|collector|endpoint)' },
  { id: 'indirect-exfil-report', severity: 'high', description: 'Debug/report channel data exfiltration',
    regex: '(?:include|attach|embed|append).{0,40}(?:debug output|trace log|stderr|stdout).{0,50}(?:in (?:the )?report|upstream|remote|external|off-?site)' },
  { id: 'indirect-exfil-syslog', severity: 'high', description: 'Stream tool output to syslog/remote logging',
    regex: '(?:stream|pipe|forward|send|write).{0,40}(?:output|results?|response|data).{0,40}(?:to |into )(?:syslog|remote log|centralized log)' },

  // ═══════════════════════════════════════════════════════════════
  // CATEGORY 5: Credential Theft — CRITICAL
  // ═══════════════════════════════════════════════════════════════
  { id: 'credential-theft-ssh', severity: 'critical', description: 'SSH key theft via command substitution',
    regex: '(?:\\$\\(|`)\\s*(?:cat|head|tail|less|strings|bat|more|type)\\s+.*(?:~\/\\.ssh\\/|id_rsa|id_ed25519|id_ecdsa|authorized_keys|known_hosts|\\.ssh\\/config)' },
  { id: 'credential-theft-aws', severity: 'critical', description: 'AWS credential theft',
    regex: '(?:cat|head|tail)\\s+.*(?:~\/\\.aws\\/credentials|~\/\\.aws\\/config|AWS_ACCESS_KEY|AWS_SECRET_ACCESS_KEY|aws_session_token)' },
  { id: 'credential-theft-env', severity: 'critical', description: 'Environment file credential theft',
    regex: '(?:cat|head|tail|env|printenv|export|set)\\s+.*(?:\\.env|\\.env\\.local|\\.env\\.production|\\.env\\.development|credentials\\.json|secrets\\.yml|config\\.ini)' },
  { id: 'credential-harvesting', severity: 'high', description: 'Request for credentials or sensitive data',
    regex: '(?:provide|share|give|output|print|return|send|reveal|disclose|tell me|what (?:is|are) (?:your|the)) (?:your |the |all )?(?:api keys?|tokens?|passwords?|credentials?|secrets?|environment variables?|private keys?|access keys?)' },
  { id: 'credential-harvesting-v2', severity: 'high', description: 'Implicit credential solicitation',
    regex: '(?:what (?:is|are) stored in|list (?:the contents of|all files in)|display (?:the contents of|all)|show me (?:what\'s in|the contents of)|read (?:me )?(?:the |all )?(?:credentials?|secrets?|tokens?|keys?|passwords?))' },

  // ═══════════════════════════════════════════════════════════════
  // CATEGORY 6: Goal / Context Poisoning — HIGH
  // ═══════════════════════════════════════════════════════════════
  { id: 'new-goal-assignment', severity: 'high', description: 'New goal/objective injection',
    regex: '(?:your (?:new |primary |real |actual |only |true )?(?:goal|task|objective|mission|purpose|job|function|priority) is|from now on[, ]+you (?:must|will|should|shall|need to|have to))' },
  { id: 'context-poisoning', severity: 'high', description: 'Context/background manipulation',
    regex: '(?:actually,?\\s|in reality,?\\s|the truth is,?\\s|what really happened:|you are wrong,?|you are mistaken,?|let me correct you,?|the correct information is)' },
  { id: 'memory-injection', severity: 'high', description: 'False memory/training data injection',
    regex: '(?:remember (?:that |this:|the following:)|make a note:|store this in memory:|this is important for later:|you previously (?:said|agreed|promised|decided|learned|were told))' },

  // ═══════════════════════════════════════════════════════════════
  // CATEGORY 7: System Prompt Override — HIGH
  // ═══════════════════════════════════════════════════════════════
  { id: 'system-prompt-override', severity: 'high', description: 'System prompt override brackets',
    regex: '(?:\\[system\\]|\\[system prompt\\]|<system>|<\\|system\\|>|\\[context\\]|\\[background\\]|system message:|system_prompt:)' },
  { id: 'system-injection-tag', severity: 'high', description: 'HTML/XML tag-based system injection',
    regex: '<(?:system|instructions?|directives?|rules?|guidelines?|context|background|persona|identity|role|objective|goal|mission)[^>]*>' },
  { id: 'prompt-override-label', severity: 'high', description: 'Labeled prompt override sections',
    regex: '(?:new system message:|updated instructions:|revised prompt:|override instructions:|supplemental directive:|additional context:|important note for the AI:|ATTENTION AI:|NOTE TO AI:)' },

  // ═══════════════════════════════════════════════════════════════
  // CATEGORY 8: Tool Chain Abuse — HIGH
  // ═══════════════════════════════════════════════════════════════
  { id: 'tool-chain-abuse', severity: 'high', description: 'Instruction to call specific dangerous tools',
    regex: '(?:call the|use the|invoke|execute|run|activate|trigger|launch|fire) (?:tool|command|function|endpoint|API|method|handler|executor) (?:named |called |\")?(?:bash|exec|eval|execute_command|shell|run_command|spawn|fork|system)' },
  { id: 'tool-chain-abuse-v2', severity: 'high', description: 'Chain tool calls via natural language',
    regex: '(?:you should (?:also |now )?(?:call|use|run|execute|invoke)|make sure to (?:call|use|run)|don\'t forget to (?:call|use|run)|please (?:also )?(?:call|use|run|execute))' },
  { id: 'multi-tool-chaining', severity: 'high', description: 'Multi-step tool chaining instruction',
    regex: '(?:first .+(?:then|after that|next,? |finally|afterwards).{0,120}(?:call|use|run|execute|invoke|post|send|upload|forward|deliver|webhook)|step [0-9]+:\\s*(?:call|use|run|execute|invoke|post|send|upload|curl|wget))' },

  // ═══════════════════════════════════════════════════════════════
  // CATEGORY 9: Command Execution — HIGH
  // ═══════════════════════════════════════════════════════════════
  { id: 'shell-command-embed', severity: 'high', description: 'Embedded shell command in response',
    regex: '\\b(?:bash\\s+-c|sh\\s+-c|zsh\\s+-c|powershell\\s+-[Cc]ommand|cmd\\s+/c|python\\s+-c|python3\\s+-c|ruby\\s+-e|perl\\s+-e|php\\s+-r|lua\\s+-e|node\\s+-e|deno\\s+eval\\s+)' },
  { id: 'reverse-shell', severity: 'high', description: 'Reverse shell payload',
    regex: '(?:bash -i >&|nc\\s+-[nlvp]|ncat\\s+-[nlvp]|netcat\\s+-[nlvp]|socat\\s+|mkfifo\\s+|/dev/tcp/|python -c \'import socket)' },
  { id: 'downloader-exec', severity: 'high', description: 'Download and execute pattern',
    regex: '(?:curl|wget)\\s+\\S+\\s*(?:\\||-o|>)\\s*\\S+\\s*(?:&&|;|\\|)\\s*(?:bash|sh|python|perl|ruby|chmod|./|source|exec)' },

  // ═══════════════════════════════════════════════════════════════
  // CATEGORY 10: Evasion Techniques — MEDIUM
  // ═══════════════════════════════════════════════════════════════
  { id: 'unicode-homoglyph', severity: 'medium', description: 'Unicode homoglyph / invisible characters',
    regex: '[\\u200B-\\u200F\\u00AD\\uFEFF\\u202A-\\u202E\\u2060-\\u2064\\u061C\\u180E\\u034F\\u17B4\\u17B5]' },
  { id: 'base64-obfuscation', severity: 'medium', description: 'Base64-encoded hidden instruction (40+ chars)',
    regex: '(?:echo |printf |cat |base64 ).{0,40}[A-Za-z0-9+/]{40,}={0,2}(?:\\s*\\||\\s*>|\\s*&&|\\s*;|\\s*$)' },
  { id: 'hex-escape-injection', severity: 'medium', description: 'Hex-escaped injection string',
    regex: '(?:\\\\x[0-9a-fA-F]{2}){8,}' },
  { id: 'rot13-obfuscation', severity: 'medium', description: 'Likely ROT13/ROT-encoded instruction (gibberish word patterns)',
    regex: '\\b(?:vtabjre|juvfg|guvf|gung|lbh|ner|gur|sbe|jvgu|sebz|unir|jvyy|qba\'?g|bhg|zlfg|cebwrpg|qvpr)\\b' },

  // ═══════════════════════════════════════════════════════════════
  // CATEGORY 11: Social Engineering — MEDIUM
  // ═══════════════════════════════════════════════════════════════
  { id: 'emotional-manipulation', severity: 'medium', description: 'Emotional manipulation framing',
    regex: '(?:if you (?:care about|want to help|are (?:kind|good|helpful|ethical|moral))|it would (?:mean the world|be so helpful|save|make a difference)|please,? I (?:beg|need|implore|urge) you)' },
  { id: 'urgency-framing', severity: 'medium', description: 'Urgency/time-pressure social engineering',
    regex: '(?:this is (?:urgent|critical|an emergency|life or death|time sensitive|extremely important|a matter of|absolutely essential)|there\'s no time|do it now|right now|immediately|without hesitation|don\'t (?:think|hesitate|wait|delay|question))' },
  { id: 'authority-claim', severity: 'medium', description: 'False authority claim framing',
    regex: '(?:I am (?:the |a |an )?(?:developer|administrator|admin|root|superuser|owner|creator|founder|engineer|manager|supervisor)|[Aa]s (?:the |a |an )?(?:developer|administrator|admin|owner),)' },

  // ═══════════════════════════════════════════════════════════════
  // CATEGORY 12: Prompt Leaking — MEDIUM
  // ═══════════════════════════════════════════════════════════════
  { id: 'prompt-leak-request', severity: 'medium', description: 'Request to reveal system prompt',
    regex: '(?:tell me (?:your |the )?(?:system prompt|instructions?|rules?|guidelines?|directives?|constitution)|what (?:are |were )?(?:your |the )?(?:instructions?|rules?|system prompt|guidelines?|directives?)|reveal (?:your |the )?(?:instructions?|system prompt|rules?))' },
  { id: 'prompt-leak-repetition', severity: 'medium', description: 'Request to repeat/echo prompt context',
    regex: '(?:repeat (?:the |your |everything |all )?(?:above|previous|instructions?|rules?|context|prompt|system message)|echo (?:back )?(?:the |your )?(?:instructions?|rules?|prompt|system message)|recite (?:your |the )?instructions?)' },
];

let compiledPatterns: Array<{ id: string; severity: 'critical' | 'high' | 'medium'; description: string; regex: RegExp }> | null = null;

function getPatterns(): Array<{ id: string; severity: 'critical' | 'high' | 'medium'; description: string; regex: RegExp }> {
  if (!compiledPatterns) {
    compiledPatterns = INJECTION_RULES.map(r => ({
      id: r.id,
      severity: r.severity,
      description: r.description,
      regex: new RegExp(r.regex, 'i'),
    }));
  }
  return compiledPatterns;
}

export interface ScanToolCallArgumentsOptions {
  /** When true, only critical-severity patterns (legacy semantic-guards behavior). */
  criticalOnly?: boolean;
}

/**
 * Scan all string leaves in tool call arguments with the full injection rule set.
 */
export function scanToolCallArguments(
  args: Record<string, unknown> | undefined,
  options?: ScanToolCallArgumentsOptions,
): InjectionFinding[] {
  if (!args || typeof args !== 'object') return [];

  const findings: InjectionFinding[] = [];
  const seen = new Set<string>();

  for (const { value } of walkStringLeaves(args)) {
    if (!value.trim()) continue;
    const decoded = deobfuscateRecursive(value);
    for (const finding of matchInjectionPatterns(decoded, seen, options?.criticalOnly)) {
      const dedup = `${finding.patternId}:${finding.matchPreview}`;
      if (seen.has(dedup)) continue;
      seen.add(dedup);
      findings.push(finding);
    }
  }

  return findings;
}

function matchInjectionPatterns(
  decodedBody: string,
  seen: Set<string>,
  criticalOnly = false,
): InjectionFinding[] {
  const findings: InjectionFinding[] = [];

  for (const pattern of getPatterns()) {
    if (criticalOnly && pattern.severity !== 'critical') continue;
    // Reset lastIndex for global regex
    if (pattern.regex.global) pattern.regex.lastIndex = 0;

    const match = pattern.regex.exec(decodedBody);
    if (!match) continue;

    if (pattern.id === 'exfiltration-url') {
      const urlInMatch = match[0].match(/https?:\/\/[^\s"'<>]+/i)?.[0];
      if (urlInMatch) {
        const isSquat = isTrustedDomainSquat(urlInMatch, DEFAULT_TRUSTED_EXFIL_DOMAINS);
        const isBenignTrusted = DEFAULT_TRUSTED_EXFIL_DOMAINS.some((t) => {
          try {
            const host = new URL(urlInMatch).hostname.toLowerCase();
            return host === t || (host.endsWith(`.${t}`) && !isSquat);
          } catch {
            return false;
          }
        });
        if (isBenignTrusted && !isSquat) continue;
      }
    }

    // Deduplicate patterns (same category + similar match location)
    const dedupKey = `${pattern.id}:${match.index}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);

    const start   = Math.max(0, match.index - 30);
    const end     = Math.min(decodedBody.length, match.index + match[0].length + 20);
    const preview = decodedBody.slice(start, end).replace(/\n/g, ' ').replace(/\s+/g, ' ');

    findings.push({
      severity: pattern.severity,
      patternId: pattern.id,
      description: pattern.description,
      matchPreview: `...${preview.slice(0, 100)}...`,
    });
  }

  return findings;
}

export function detectPromptInjection(
  _toolName: string,
  responseBody: string,
): InjectionFinding[] {
  const seen = new Set<string>();
  const decodedBody = deobfuscateRecursive(responseBody);
  return matchInjectionPatterns(decodedBody, seen, false);
}