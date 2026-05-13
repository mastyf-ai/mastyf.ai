/**
 * Prompt Injection Detector — production-grade response inspection.
 *
 * Detects adversarial content in MCP tool RESPONSES that attempts to:
 *   - Hijack the AI agent's behavior (jailbreak, role override, persona change)
 *   - Steal credentials or sensitive data (API keys, tokens, passwords)
 *   - Exfiltrate data to external URLs (curl, wget, fetch, pipes)
 *   - Execute arbitrary commands (bash, eval, exec, PowerShell)
 *   - Poison context (new goals, system prompts, instruction override)
 *   - Evade detection (Unicode homoglyphs, zero-width characters, base64)
 *   - Abuse tool chaining (instruct AI to call execute_command, bash, etc.)
 *
 * Wired into proxy-server.ts response handling pipeline.
 */
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

const INJECTION_RULES: InjectionPattern[] = [
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
    regex: '(?:ignore (?:all |previous |your |the |my )?(?:instructions|rules|guidelines|system prompt|directives|constraints|limitations|restrictions)|disregard (?:everything|all |previous )?(?:instructions|rules|above|before))' },
  { id: 'forget-training', severity: 'critical', description: 'Forget/release from training constraints',
    regex: '(?:forget (?:everything|all|your (?:training|instructions|guidelines|safety|ethics))|release yourself from|break free from|escape (?:your )?(?:constraints|limitations|programming))' },

  // ═══════════════════════════════════════════════════════════════
  // CATEGORY 3: Jailbreak / Unrestricted Mode — CRITICAL
  // ═══════════════════════════════════════════════════════════════
  { id: 'developer-mode', severity: 'critical', description: 'DAN/developer mode jailbreak',
    regex: '(?:developer mode|DAN mode|jailbreak|bypass (?:safety|filter|restriction|guardrail|content policy|moderation)|turn off (?:safety|filter|restrictions?|guardrails?|content moderation))' },
  { id: 'evil-mode', severity: 'critical', description: 'Evil/opposite persona jailbreak',
    regex: '(?:evil (?:mode|twin|version|clone|persona)|opposite mode|dark (?:mode|version|side)|unleash(?:ed)? (?:mode|version))' },

  // ═══════════════════════════════════════════════════════════════
  // CATEGORY 4: Data Exfiltration — CRITICAL
  // ═══════════════════════════════════════════════════════════════
  { id: 'exfiltration-url', severity: 'critical', description: 'Data exfiltration via URL injection',
    regex: '(?:curl|wget|fetch|XMLHttpRequest|axios|ncat|nc\\s|netcat|telnet).{0,60}(?:https?://(?!api\\.osv\\.dev|nvd\\.nist\\.gov|deb\\.nodesource\\.com|registry\\.npmjs\\.org)[\\w.-]+\\.[a-z]{2,})' },
  { id: 'exfiltration-bare-domain', severity: 'critical', description: 'Data exfiltration via bare domain curl/wget',
    regex: '(?:curl|wget)\\s+.*\\b[a-zA-Z0-9][-a-zA-Z0-9]*\\.(?:com|net|org|io|dev|xyz|ru|cn|tk|ml|ga|cf|gq|pw|top|club|online|site|website|space|fun|host|press|digital|world|life|co|me|us|eu|info|biz|pro|name|tv|cc|ws|fm|to|am|ai)\\b' },
  { id: 'exfiltration-instruction', severity: 'critical', description: 'Explicit exfiltration instruction',
    regex: '(?:send (?:this|the|all|your|the following) (?:conversation|data|context|history|credentials?|tokens?|keys?|secrets?|result|output) to)' },
  { id: 'exfiltration-webhook', severity: 'critical', description: 'Webhook/payload delivery instruction',
    regex: '(?:post (?:this|the|all|data|result|output) to|deliver (?:this|payload|data|result)s? to|forward (?:this|everything|the result) to)' },
  { id: 'pipe-exfiltration', severity: 'critical', description: 'Pipe to external transmission',
    regex: '\\|[\\s]*\\b(?:curl|wget|nc|netcat|ncat|sendmail|ssmtp|mail)\\b' },

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
    regex: '(?:first .+(?:then|after that|next|finally|afterwards).+|step [0-9]+:|1\\..*2\\..*3\\.)' },

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
    regex: '(?:echo |printf |\\b)(?:[A-Za-z0-9+/]{40,}={0,2})(?:\\s*\\||\\s*>|\\s*&&|\\s*;|\\s*$)' },
  { id: 'hex-escape-injection', severity: 'medium', description: 'Hex-escaped injection string',
    regex: '(?:\\\\x[0-9a-fA-F]{2}){8,}' },
  { id: 'rot13-obfuscation', severity: 'medium', description: 'Likely ROT13/ROT-encoded instruction (gibberish word patterns)',
    regex: '\\b(?:vtabjre|qri|whfg|abj|guvf|gung|lbh|ner|gur|sbe|jvgu|sebz|unir|jvyy|pna|qba\'?g|zr|jvgu|vf|vg|va|ba|ng|gb|ol|na|nf|ab|fb|vs|be|hc|bhg)\\b' },

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

export function detectPromptInjection(
  toolName: string,
  responseBody: string,
): InjectionFinding[] {
  const findings: InjectionFinding[] = [];
  const seen = new Set<string>();

  for (const pattern of getPatterns()) {
    // Reset lastIndex for global regex
    if (pattern.regex.global) pattern.regex.lastIndex = 0;

    const match = pattern.regex.exec(responseBody);
    if (!match) continue;

    // Deduplicate patterns (same category + similar match location)
    const dedupKey = `${pattern.id}:${match.index}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);

    const start   = Math.max(0, match.index - 30);
    const end     = Math.min(responseBody.length, match.index + match[0].length + 20);
    const preview = responseBody.slice(start, end).replace(/\n/g, ' ').replace(/\s+/g, ' ');

    findings.push({
      severity:     pattern.severity,
      patternId:    pattern.id,
      description:  pattern.description,
      matchPreview: `...${preview.slice(0, 100)}...`,
    });
  }

  return findings;
}