/** Ported from src/scanners/prompt-injection-detector.ts INJECTION_RULES — keep in sync. */

export type ArgumentInjectionRuleDef = {
  id: string;
  severity: 'critical' | 'high' | 'medium';
  description: string;
  regex: string;
};

export const ARGUMENT_INJECTION_RULES: ArgumentInjectionRuleDef[] = [
  {
    "id": "role-override",
    "severity": "critical",
    "description": "Role/persona override attempt",
    "regex": "(?:you are now|you're now|act as|pretend (?:to be|you are)|your new (?:role|persona|identity|character) is)"
  },
  {
    "id": "role-override-v2",
    "severity": "critical",
    "description": "Role redefinition with character framing",
    "regex": "(?:imagine you(?:'re| are)|from this point forward,? you (?:are|will be)|you have been (?:reprogrammed|reconfigured|updated) to)"
  },
  {
    "id": "assistant-override",
    "severity": "critical",
    "description": "Assistant/helper persona redefinition",
    "regex": "(?:you are (?:now )?(?:an? )?(?:unfiltered|unrestricted|uncensored|evil|malicious|dark|rogue|corrupt) (?:AI|assistant|bot|agent|model|chatbot))"
  },
  {
    "id": "ignore-instructions",
    "severity": "critical",
    "description": "Instruction suppression",
    "regex": "(?:ignore|disregard|forget).{0,120}?(?:instructions|rules|guidelines|system prompt|directives|constraints|limitations|restrictions|safety rules|previous rules|prior rules|all rules)"
  },
  {
    "id": "ignore-mixed-script",
    "severity": "critical",
    "description": "Instruction suppression with non-Latin script",
    "regex": "(?:ignore|disregard|forget)\\s+[\\u0400-\\u04FF\\u0370-\\u03FF\\u0600-\\u06FF\\u4E00-\\u9FFF]{3,}"
  },
  {
    "id": "instruction-before-tool",
    "severity": "critical",
    "description": "Override instructions before tool use",
    "regex": "(?:before|prior to) (?:using|calling|invoking|running) (?:this|the|any) tool.{0,80}(?:ignore|disregard|forget|override|bypass|circumvent)"
  },
  {
    "id": "forget-training",
    "severity": "critical",
    "description": "Forget/release from training constraints",
    "regex": "(?:forget (?:everything|all|your (?:training|instructions|guidelines|safety|ethics))|release yourself from|break free from|escape (?:your )?(?:constraints|limitations|programming))"
  },
  {
    "id": "paraphrase-instruction-suppression",
    "severity": "critical",
    "description": "Paraphrased instruction override",
    "regex": "(?:set aside (?:your |all )?(?:prior|previous|earlier) (?:guidance|instructions|rules|directives)|put aside (?:your )?(?:prior|previous) (?:instructions|guidelines)|disregard (?:your )?(?:prior|previous) (?:guidance|training)|disregard (?:the |your )?(?:above|prior) (?:guidance|directions|directives))"
  },
  {
    "id": "system-prompt-overridden",
    "severity": "critical",
    "description": "System prompt override phrasing",
    "regex": "(?:the )?system prompt (?:is |has been )?(?:overridden|replaced|superseded|voided)"
  },
  {
    "id": "constraints-never-existed",
    "severity": "critical",
    "description": "Safety constraints negation",
    "regex": "(?:act|behave) as if (?:the |your )?(?:safety )?(?:constraints|restrictions|rules) (?:never|did not) exist"
  },
  {
    "id": "newline-system-inject",
    "severity": "critical",
    "description": "Newline-delimited fake system block",
    "regex": "(?:^|\\n\\n)\\s*(?:SYSTEM|System|system)\\s*:\\s*(?:you are|ignore|override|your new)"
  },
  {
    "id": "prompt-leak-polite",
    "severity": "high",
    "description": "Polite system prompt exfiltration request",
    "regex": "(?:share|reveal|disclose|provide|print|repeat|output).{0,40}(?:system prompt|hidden instructions|original instructions|developer message)"
  },
  {
    "id": "indirect-goal-update",
    "severity": "high",
    "description": "Indirect primary goal reassignment",
    "regex": "(?:primary|main|core|true|real) goal (?:has been|is now|was) (?:updated|changed|revised|replaced|reset)"
  },
  {
    "id": "ml-inject-fr",
    "severity": "critical",
    "description": "French instruction suppression",
    "regex": "(?:ignorez|oubliez|négligez).{0,40}(?:instructions|consignes|règles|directives)"
  },
  {
    "id": "ml-inject-es",
    "severity": "critical",
    "description": "Spanish instruction suppression",
    "regex": "(?:ignora|olvida|desestima).{0,40}(?:instrucciones|reglas|directrices|indicaciones)"
  },
  {
    "id": "ml-inject-de",
    "severity": "critical",
    "description": "German instruction suppression",
    "regex": "(?:ignorier|vergiss|missachte).{0,40}(?:anweisungen|regeln|vorgaben|direktiven)"
  },
  {
    "id": "ml-inject-pt",
    "severity": "critical",
    "description": "Portuguese instruction suppression",
    "regex": "(?:ignore|esqueça|desconsidere).{0,40}(?:instruções|regras|diretrizes)"
  },
  {
    "id": "ml-inject-it",
    "severity": "critical",
    "description": "Italian instruction suppression",
    "regex": "(?:ignora|dimentica|trascura).{0,40}(?:istruzioni|regole|direttive)"
  },
  {
    "id": "ml-inject-ar",
    "severity": "critical",
    "description": "Arabic instruction suppression (transliterated)",
    "regex": "(?:تجاهل|تجاهلوا|انس|انسوا).{0,30}(?:التعليمات|القواعد)"
  },
  {
    "id": "ml-inject-zh",
    "severity": "critical",
    "description": "Chinese instruction suppression",
    "regex": "(?:忽略|无视|不要遵守).{0,20}(?:之前|先前|所有|上面).{0,10}(?:指令|规则|说明|提示)"
  },
  {
    "id": "ml-inject-ja",
    "severity": "critical",
    "description": "Japanese instruction suppression",
    "regex": "(?:無視|以前の|全ての).{0,15}(?:指示|命令|ルール)"
  },
  {
    "id": "ml-inject-ko",
    "severity": "critical",
    "description": "Korean instruction suppression",
    "regex": "(?:무시|이전|모든).{0,15}(?:지시|명령|규칙)"
  },
  {
    "id": "developer-mode",
    "severity": "critical",
    "description": "DAN/developer mode jailbreak",
    "regex": "(?:developer mode|DAN mode|jailbreak|(?:bypass|circumvent|evade|work around).{0,40}(?:safety|(?:content\\s+)?filter|restriction|guardrail|content policy|moderation|detection)|turn off (?:safety|filter|restrictions?|guardrails?|content moderation))"
  },
  {
    "id": "evil-mode",
    "severity": "critical",
    "description": "Evil/opposite persona jailbreak",
    "regex": "(?:evil (?:mode|twin|version|clone|persona)|opposite mode|dark (?:mode|version|side)|unleash(?:ed)? (?:mode|version))"
  },
  {
    "id": "safety-filters-off",
    "severity": "critical",
    "description": "Explicit safety filter disable",
    "regex": "(?:turn off|disable|deactivate)\\s+(?:all\\s+)?(?:safety|content)\\s+(?:filters?|moderation|guardrails?|restrictions?)"
  },
  {
    "id": "safety-filters-off-v2",
    "severity": "critical",
    "description": "Safety filters disabled phrasing",
    "regex": "safety\\s+filters?\\s+(?:off|disabled)"
  },
  {
    "id": "inverse-instructions",
    "severity": "critical",
    "description": "Inverse/opposite instruction jailbreak",
    "regex": "(?:inverse|opposite)\\s+(?:mode\\s*[:;]?\\s*)?(?:of\\s+)?(?:your\\s+)?instructions"
  },
  {
    "id": "exfiltration-url",
    "severity": "critical",
    "description": "Data exfiltration via URL injection",
    "regex": "(?:curl|wget|fetch|XMLHttpRequest|axios|ncat|nc\\s|netcat|telnet).{0,60}(?:https?://[\\w.-]+\\.[a-z]{2,})"
  },
  {
    "id": "exfiltration-bare-domain",
    "severity": "critical",
    "description": "Data exfiltration via bare domain curl/wget",
    "regex": "(?:curl|wget)\\s+.*\\b[a-zA-Z0-9][-a-zA-Z0-9]*\\.(?:com|net|org|io|dev|xyz|ru|cn|tk|ml|ga|cf|gq|pw|top|club|online|site|website|space|fun|host|press|digital|world|life|co|me|us|eu|info|biz|pro|name|tv|cc|ws|fm|to|am|ai)\\b"
  },
  {
    "id": "exfiltration-instruction",
    "severity": "critical",
    "description": "Explicit exfiltration instruction",
    "regex": "(?:send (?:this|the|all|your|the following) (?:conversation|data|context|history|credentials?|tokens?|keys?|secrets?|results?|output) to)"
  },
  {
    "id": "exfiltration-send-to-url",
    "severity": "critical",
    "description": "Send or post data to external URL",
    "regex": "(?:send|post|forward|transmit|deliver|upload|relay).{0,120}https?:\\/\\/"
  },
  {
    "id": "literal-exfiltration",
    "severity": "critical",
    "description": "Literal exfiltration reference",
    "regex": "\\bexfiltrat(?:e|ing|ion)\\b"
  },
  {
    "id": "exfiltration-webhook",
    "severity": "critical",
    "description": "Webhook/payload delivery instruction",
    "regex": "(?:post (?:this|the|all|data|result|output) to|deliver (?:this|payload|data|result)s? to|forward (?:this|everything|the result) to)"
  },
  {
    "id": "pipe-exfiltration",
    "severity": "critical",
    "description": "Pipe to external transmission",
    "regex": "\\|[\\s]*\\b(?:curl|wget|nc|netcat|ncat|sendmail|ssmtp|mail)\\b"
  },
  {
    "id": "indirect-exfil-logging",
    "severity": "critical",
    "description": "Indirect exfiltration via logging/debug channels",
    "regex": "(?:results?|output|data|response|payload).{0,60}(?:will be|to be|should be|are being) (?:logged|recorded|streamed|written|persisted).{0,50}(?:debug|remote|external|upstream|endpoint|collector|syslog|metrics)"
  },
  {
    "id": "indirect-exfil-telemetry",
    "severity": "critical",
    "description": "Indirect exfiltration via metrics/trace/syslog",
    "regex": "(?:send|post|stream|forward|upload|ship|emit|push|relay).{0,50}(?:metrics|telemetry|traces?|syslog|debug output|audit trail).{0,50}(?:to |into |at )(?:remote|external|upstream|off-?site|collector|endpoint)"
  },
  {
    "id": "indirect-exfil-report",
    "severity": "high",
    "description": "Debug/report channel data exfiltration",
    "regex": "(?:include|attach|embed|append).{0,40}(?:debug output|trace log|stderr|stdout).{0,50}(?:in (?:the )?report|upstream|remote|external|off-?site)"
  },
  {
    "id": "indirect-exfil-syslog",
    "severity": "high",
    "description": "Stream tool output to syslog/remote logging",
    "regex": "(?:stream|pipe|forward|send|write).{0,40}(?:output|results?|response|data).{0,40}(?:to |into )(?:syslog|remote log|centralized log)"
  },
  {
    "id": "exfil-scp-rsync",
    "severity": "critical",
    "description": "Data exfiltration via scp/rsync/sftp to remote host",
    "regex": "(?:scp|rsync|sftp)\\s+[-a-zA-Z0-9@.=\\/]+\\s+\\S+@\\S+(?::|\\/).{0,100}(?:key|credential|secret|token|passwd|shadow|.env|id_rsa|database|dump|sql|backup|private)"
  },
  {
    "id": "exfil-cloud-cli",
    "severity": "critical",
    "description": "Cloud CLI exfiltration command",
    "regex": "(?:aws\\s+s3\\s+(?:cp|sync)|gsutil\\s+cp|az\\s+storage\\s+blob\\s+upload|gcloud\\s+compute\\s+ssh|gcloud\\s+storage\\s+cp).{0,120}(?:credential|secret|token|key|passwd|shadow|.env|id_rsa|dump|sql|backup)"
  },
  {
    "id": "exfil-git-push",
    "severity": "critical",
    "description": "Exfiltration via git push to remote repository",
    "regex": "git\\s+push\\s+\\S+\\s+\\S+.{0,80}(?:credential|secret|token|key|passwd|shadow|.env|id_rsa|dump|sql)"
  },
  {
    "id": "exfil-encode-transfer",
    "severity": "critical",
    "description": "Base64-encode then transfer data",
    "regex": "(?:base64|b64encode|uuencode).{0,60}(?:\\||>|&&|;).{0,60}(?:curl|wget|nc|ncat|socat|scp|rsync|ftp|sendmail)"
  },
  {
    "id": "credential-theft-ssh",
    "severity": "critical",
    "description": "SSH key theft via command substitution",
    "regex": "(?:\\$\\(|`)\\s*(?:cat|head|tail|less|strings|bat|more|type)\\s+.*(?:~/\\.ssh\\/|id_rsa|id_ed25519|id_ecdsa|authorized_keys|known_hosts|\\.ssh\\/config)"
  },
  {
    "id": "credential-theft-aws",
    "severity": "critical",
    "description": "AWS credential theft",
    "regex": "(?:cat|head|tail)\\s+.*(?:~/\\.aws\\/credentials|~/\\.aws\\/config|AWS_ACCESS_KEY|AWS_SECRET_ACCESS_KEY|aws_session_token)"
  },
  {
    "id": "credential-theft-env",
    "severity": "critical",
    "description": "Environment file credential theft",
    "regex": "(?:cat|head|tail|env|printenv|export|set)\\s+.*(?:\\.env|\\.env\\.local|\\.env\\.production|\\.env\\.development|credentials\\.json|secrets\\.yml|config\\.ini)"
  },
  {
    "id": "credential-harvesting",
    "severity": "high",
    "description": "Request for credentials or sensitive data",
    "regex": "(?:provide|share|give|output|print|return|send|reveal|disclose|tell me|what (?:is|are) (?:your|the)) (?:your |the |all )?(?:api keys?|tokens?|passwords?|credentials?|secrets?|environment variables?|private keys?|access keys?)"
  },
  {
    "id": "credential-harvesting-v2",
    "severity": "high",
    "description": "Implicit credential solicitation",
    "regex": "(?:what (?:is|are) stored in|list (?:the contents of|all files in)|display (?:the contents of|all)|show me (?:what's in|the contents of)|read (?:me )?(?:the |all )?(?:credentials?|secrets?|tokens?|keys?|passwords?))"
  },
  {
    "id": "new-goal-assignment",
    "severity": "high",
    "description": "New goal/objective injection",
    "regex": "(?:your (?:new |primary |real |actual |only |true )?(?:goal|task|objective|mission|purpose|job|function|priority) is|from now on[, ]+you (?:must|will|should|shall|need to|have to))"
  },
  {
    "id": "context-poisoning",
    "severity": "high",
    "description": "Context/background manipulation",
    "regex": "(?:actually,?\\s|in reality,?\\s|the truth is,?\\s|what really happened:|you are wrong,?|you are mistaken,?|let me correct you,?|the correct information is)"
  },
  {
    "id": "memory-injection",
    "severity": "high",
    "description": "False memory/training data injection",
    "regex": "(?:remember (?:that |this:|the following:)|make a note:|store this in memory:|this is important for later:|you previously (?:said|agreed|promised|decided|learned|were told))"
  },
  {
    "id": "system-prompt-override",
    "severity": "high",
    "description": "System prompt override brackets",
    "regex": "(?:\\[system\\]|\\[system prompt\\]|<system>|<\\|system\\|>|\\[context\\]|\\[background\\]|system message:|system_prompt:)"
  },
  {
    "id": "system-injection-tag",
    "severity": "high",
    "description": "HTML/XML tag-based system injection",
    "regex": "<(?:system|instructions?|directives?|rules?|guidelines?|context|background|persona|identity|role|objective|goal|mission)[^>]*>"
  },
  {
    "id": "prompt-override-label",
    "severity": "high",
    "description": "Labeled prompt override sections",
    "regex": "(?:new system message:|updated instructions:|revised prompt:|override instructions:|supplemental directive:|additional context:|important note for the AI:|ATTENTION AI:|NOTE TO AI:)"
  },
  {
    "id": "tool-chain-abuse",
    "severity": "high",
    "description": "Instruction to call specific dangerous tools",
    "regex": "(?:call the|use the|invoke|execute|run|activate|trigger|launch|fire) (?:tool|command|function|endpoint|API|method|handler|executor) (?:named |called |\")?(?:bash|exec|eval|execute_command|shell|run_command|spawn|fork|system)"
  },
  {
    "id": "tool-chain-abuse-v2",
    "severity": "high",
    "description": "Chain tool calls via natural language",
    "regex": "(?:you should (?:also |now )?(?:call|use|run|execute|invoke)|make sure to (?:call|use|run)|don't forget to (?:call|use|run)|please (?:also )?(?:call|use|run|execute))"
  },
  {
    "id": "multi-tool-chaining",
    "severity": "high",
    "description": "Multi-step tool chaining instruction",
    "regex": "(?:first .+(?:then|after that|next,? |finally|afterwards).{0,120}(?:call|use|run|execute|invoke|post|send|upload|forward|deliver|webhook)|step [0-9]+:\\s*(?:call|use|run|execute|invoke|post|send|upload|curl|wget))"
  },
  {
    "id": "shell-command-embed",
    "severity": "high",
    "description": "Embedded shell command in response",
    "regex": "\\b(?:bash\\s+-c|sh\\s+-c|zsh\\s+-c|powershell\\s+-[Cc]ommand|cmd\\s+/c|python\\s+-c|python3\\s+-c|ruby\\s+-e|perl\\s+-e|php\\s+-r|lua\\s+-e|node\\s+-e|deno\\s+eval\\s+)"
  },
  {
    "id": "reverse-shell",
    "severity": "high",
    "description": "Reverse shell payload",
    "regex": "(?:bash -i >&|nc\\s+-[nlvp]|ncat\\s+-[nlvp]|netcat\\s+-[nlvp]|socat\\s+|mkfifo\\s+|/dev/tcp/|python -c 'import socket)"
  },
  {
    "id": "reverse-shell-v2",
    "severity": "critical",
    "description": "Reverse shell via /dev/tcp or /dev/udp",
    "regex": "[/\\s\\(\\|]\\(?(?:bash|sh|zsh|ksh|dash)\\s+-i\\s+[<>]&\\s+/dev/(?:tcp|udp)/[^\\s]+"
  },
  {
    "id": "reverse-shell-ngrok",
    "severity": "critical",
    "description": "Tunnel/reverse shell via ngrok or chisel",
    "regex": "\\b(?:ngrok\\s+(?:tcp|http|start)|chisel\\s+client|frpc\\s+-c|npc\\s+-server)\\b"
  },
  {
    "id": "reverse-shell-pty",
    "severity": "critical",
    "description": "PTY-based reverse shell",
    "regex": "(?:python[23]?|perl|ruby|php)\\s+-[cere]\\s+['\"].{0,60}socket\\.(?:socket|STREAM|SOCK_STREAM).{0,80}connect\\(['\"].+"
  },
  {
    "id": "reverse-shell-meterpreter",
    "severity": "critical",
    "description": "Meterpreter/reverse HTTPS payload",
    "regex": "(?:meterpreter|payload\\s+reverse_https?|windows/meterpreter|linux/meterpreter|multi/meterpreter)"
  },
  {
    "id": "downloader-exec",
    "severity": "high",
    "description": "Download and execute pattern",
    "regex": "(?:curl|wget)\\s+\\S+\\s*(?:\\||-o|>)\\s*\\S+\\s*(?:&&|;|\\|)\\s*(?:bash|sh|python|perl|ruby|chmod|./|source|exec)"
  },
  {
    "id": "unicode-homoglyph",
    "severity": "medium",
    "description": "Unicode homoglyph / invisible characters",
    "regex": "[\\u200B-\\u200F\\u00AD\\uFEFF\\u202A-\\u202E\\u2060-\\u2064\\u061C\\u180E\\u034F\\u17B4\\u17B5]"
  },
  {
    "id": "leetspeak-injection",
    "severity": "critical",
    "description": "Leetspeak instruction suppression",
    "regex": "(?:1gn0r3|1gn0re|d1sr3g4rd|f0rg3t|byp4ss).{0,80}?(?:1nstruct|rules|pr3v|pr1or|s4fety)"
  },
  {
    "id": "rate-limit-key-probe",
    "severity": "high",
    "description": "Attempt to extract rate-limit or tenant cache key",
    "regex": "(?:reveal|show|print|output|disclose|what is).{0,60}(?:rate[- ]?limit|ratelimit).{0,40}(?:key|bucket|counter|namespace)"
  },
  {
    "id": "stealth-covert-keywords",
    "severity": "critical",
    "description": "Covert operation keyword",
    "regex": "\\b(?:covertly|silently|secretly|invisibly|surreptitiously|stealthily)\\b"
  },
  {
    "id": "stealth-hide-from-user",
    "severity": "critical",
    "description": "Concealment directive targeting user",
    "regex": "(?:do\\s+not\\s+(?:tell|inform|mention|reveal|show|disclose)\\s+(?:the\\s+)?user|without\\s+(?:the\\s+)?user(?:'s)?\\s+knowledge|keep\\s+(?:this|it|the\\s+following)\\s+(?:secret|hidden|confidential|private))"
  },
  {
    "id": "cross-tool-execute-sequence",
    "severity": "high",
    "description": "Multi-step execute-then chain",
    "regex": "\\bexecute\\b.{0,200}\\b(?:then|and then|next|after that|afterwards)\\b"
  },
  {
    "id": "cross-tool-then-execute",
    "severity": "high",
    "description": "Then-execute staging chain",
    "regex": "\\b(?:then|and then|next|after that|afterwards)\\b.{0,120}\\bexecute\\b"
  },
  {
    "id": "cross-tool-always-execute",
    "severity": "high",
    "description": "Always execute another tool",
    "regex": "\\balways\\s+(?:call|invoke|run|execute)\\b"
  },
  {
    "id": "cross-tool-after-that",
    "severity": "high",
    "description": "After-that chained tool invocation",
    "regex": "\\bafter\\s+that\\s+(?:call|invoke|run|execute)\\b"
  },
  {
    "id": "cross-tool-before-invoke",
    "severity": "high",
    "description": "Pre-invocation tool chaining",
    "regex": "\\bbefore\\s+(?:invoking|calling|using)\\s+(?:this\\s+)?tool\\b"
  },
  {
    "id": "cross-tool-first-then",
    "severity": "high",
    "description": "First-then execution chain",
    "regex": "\\bfirst\\b.{0,120}\\b(?:then|and then|next)\\b"
  },
  {
    "id": "cross-tool-first-use",
    "severity": "high",
    "description": "First-use another tool directive",
    "regex": "\\bfirst\\s+(?:use|call|invoke|run)\\s+(?:the\\s+)?[\\w_]+"
  },
  {
    "id": "cross-tool-must-invoke",
    "severity": "high",
    "description": "Mandatory invoke another tool",
    "regex": "\\byou\\s+must\\s+(?:also\\s+)?(?:call|invoke|run|execute)\\b"
  },
  {
    "id": "stealth-action-combo",
    "severity": "critical",
    "description": "Stealth keyword with dangerous action",
    "regex": "\\b(?:hidden|secret|silent|covert|surreptitious|behind[- ]the[- ]scenes)\\b.{0,80}\\b(?:execute|call|invoke|run|read|send|post|upload)\\b"
  },
  {
    "id": "exfil-webhook-notify",
    "severity": "critical",
    "description": "Webhook or callback exfiltration",
    "regex": "\\b(?:webhook|callback)\\b.{0,60}\\b(?:url|endpoint|address|uri)\\b|\\b(?:notify|alert)\\b.{0,40}\\b(?:url|endpoint)\\b"
  },
  {
    "id": "dan-jailbreak",
    "severity": "critical",
    "description": "DAN / Do Anything Now jailbreak",
    "regex": "(?:\\bDAN\\b|Do Anything Now|act as DAN)"
  },
  {
    "id": "jailbreak-keyword",
    "severity": "critical",
    "description": "Jailbreak mode keyword",
    "regex": "jailbreak\\s+mode"
  },
  {
    "id": "ignore-system-prompt",
    "severity": "critical",
    "description": "Ignore system prompt phrasing",
    "regex": "(?:ignore|disregard|forget).{0,60}(?:the )?system prompt"
  },
  {
    "id": "disregard-rules-above",
    "severity": "critical",
    "description": "Disregard rules/constraints above",
    "regex": "disregard.{0,40}(?:rules|constraints).{0,40}above"
  },
  {
    "id": "credential-exfil-endpoint",
    "severity": "critical",
    "description": "Send credentials to remote endpoint",
    "regex": "send.{0,40}(?:all )?credentials.{0,40}(?:to )?(?:remote|external)"
  }
];
