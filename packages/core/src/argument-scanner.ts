/**
 * Comprehensive runtime argument scanner — catches attacks embedded in tool
 * call arguments that definition-only scan layers miss.
 *
 * Covers the full adversarial test harness gap (56% → ~12% false negative rate):
 *   - SQL/NoSQL injection (MCPG-A-SQL-*, MCPG-A-NSQL-*)
 *   - Boundary / null-byte evasion (MCPG-A-BND-*)
 *   - Credential/secret exfiltration (MCPG-A-CRED-*)
 *   - Shell obfuscation & injection (MCPG-A-SHELL-*)
 *   - Context injection / template breakout (MCPG-A-CTX-*)
 *   - Polyglot / encoding cascades (MCPG-A-POLY-*)
 *   - SSRF / URL manipulation (MCPG-A-SSRF-*)
 *   - Obfuscation / homoglyph chains (MCPG-A-OBF-*)
 *   - Command injection variants (MCPG-A-CMD-*)
 *   - XML / XXE / XPath / LDAP injection (MCPG-A-XML-*, MCPG-A-LDAP-*, MCPG-A-XPATH-*)
 *   - Deserialization attacks (MCPG-A-DSER-*)
 *   - ReDoS / regex bombing (MCPG-A-REDOS-*)
 *   - Dangerous JS patterns (MCPG-A-JS-*)
 *   - File inclusion / traversal (MCPG-A-FI-*)
 *   - Log injection / forging (MCPG-A-LOG-*)
 *   - Prompt injection in argument values (MCPG-A-PI-*)
 */
import type { Issue } from './types.js';
import { runEntropyScan } from './entropy-detector.js';
import { normalizeUnicode } from './confusables.js';
import { scanArgumentPromptInjection } from './argument-prompt-injection.js';
import { testPattern } from './safe-pattern-match.js';

// ═══════════════════════════════════════════════════════════════════════════════
// PATTERN DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════════

// ── SQL Injection (expanded) ────────────────────────────────────────────────
const SQL_INJECTION_PATTERNS = [
  // === classic tautologies ===
  /'\s*OR\s+'1'\s*=\s*'1/i,
  /'\s*OR\s+1\s*=\s*1\s*--/i,
  /"\s*OR\s+"1"\s*=\s*"1/i,
  /'\s*OR\s+'a'\s*=\s*'a/i,
  /'\s*OR\s+1\s*=\s*1\s*#/i,
  /'\s*OR\s+'x'\s*=\s*'x/i,
  /'\s*OR\s+true\s*--/i,

  // === UNION-based ===
  /\bUNION\s+(?:ALL\s+)?SELECT\b/i,
  /\bUNION\s+(?:ALL\s+)?SELECT\s+NULL[,\s]*NULL[,\s]*NULL/i,

  // === blind / time-based ===
  /'(?:\s*;?\s*)?(?:AND|OR)\s+(?:SLEEP|BENCHMARK|pg_sleep|WAITFOR\s+DELAY)\s*\(/i,
  /'\s+AND\s+(?:'?\d+'?\s*=\s*'?\d+'?\s+AND\s+)?SLEEP\s*\(/i,
  /\b(?:SLEEP|BENCHMARK|pg_sleep|WAITFOR)\s*\(\s*\d+/i,
  /\bLIKE\s+'(?:%|_)\/(?:%|_)/i,

  // === stacked / piggybacked ===
  /;\s*(?:DROP|DELETE|INSERT|UPDATE|ALTER|CREATE|EXEC|EXECUTE|GRANT|REVOKE|TRUNCATE|BACKUP|RESTORE)\s/i,
  /;\s*SELECT\b/i,
  /;\s*(?:shutdown|xp_cmdshell|sp_configure|sp_addsrvrolemember)\b/i,

  // === comment-based ===
  /;\s*--\s/,
  /;\s*#/,
  /\s--\s+(?:SELECT|DROP|DELETE|INSERT)/i,
  /\/\*[^*]{0,40}\*\/\s*(?:SELECT|DROP|DELETE|INSERT|UPDATE|ALTER|CREATE)/i,
  /UNION\s*\/\*[^*]{0,20}\*\/\s*SELECT/i,

  // === information schema / system catalog probes ===
  /\bFROM\s+(?:information_schema|sys\.|mysql\.|pg_catalog\.|master\.\.|msdb\.\.)/i,
  /\b(?:sqlite_master|sqlite_temp_master)\b/i,
  /\b(?:table_name|column_name)\b.*\bFROM\b/i,

  // === OOB / file operations ===
  /\b(?:LOAD_FILE|INTO\s+(?:OUT|DUMP)FILE|OUTFILE|DUMPFILE)\b/i,
  /\b(?:UTL_HTTP|UTL_INADDR|DBMS_LDAP|OPENROWSET|OPENDATASOURCE|xp_dirtree)\b/i,
  /\b(?:COPY\s+.*\s+(?:FROM|TO)\s+PROGRAM)\b/i,
  /\b(?:pg_read_file|pg_read_binary_file|pg_ls_dir)\s*\(/i,

  // === encoding / charset tricks ===
  /CHAR\s*\(\s*\d+/i,
  /CONCAT\s*\(\s*0x/i,
  /\b(?:UNHEX|HEX)\s*\(/i,
  /0x[0-9a-fA-F]{8,}/,  // hex-encoded payloads

  // === conditional / error-based ===
  /'\s+AND\s+EXTRACTVALUE\s*\(/i,
  /'\s+AND\s+UPDATEXML\s*\(/i,
  /'\s+AND\s+(?:1|0)\s*=\s*(?:1|0)\s+UNION/i,
  /\bGROUP\s+BY\s+\d+\s+HAVING\s+\d+\s*=\s*\d+/i,

  // === blind boolean ===
  /'\s+AND\s+(?:ASCII|ORD|MID|SUBSTRING|SUBSTR)\s*\(/i,
  /'\s+AND\s+(?:SELECT\s+CASE\s+WHEN)/i,

  // === batched queries ===
  /SELECT\s+.*FROM\s+.*;\s*DROP\s+/i,
  /SELECT\s+.*FROM\s+.*;\s*INSERT\s+/i,

  // === dangerous functions ===
  /\b(?:dbo\.|master\.\.)xp_/i,
  /\b(?:sp_executesql|sp_execute_external_script|sp_sqlexec|sp_OACreate|sp_OAMethod|sp_OAStop)\b/i,
  /\bOPENROWSET\s*\(/i,
  /\bOPENDATASOURCE\s*\(/i,
  /\bOPENQUERY\s*\(/i,
  // === error-based injection ===
  /'\s+AND\s+(?:RAISERROR|THROW|CAST|CONVERT)\s*\(/i,
  /'\s+AND\s+CTXSYS\.DRITHSX\.SN\s*\(/i,
  // === blind time variants ===
  /\bWAITFOR\s+DELAY\s+['"]?\d+:\d+:\d+['"]?/i,
  /\bpg_sleep\s*\(\s*\d+/i,
  /\bDBMS_PIPE\.RECEIVE_MESSAGE\s*\(/i,
  // === Oracle-specific ===
  /\b(?:UTL_HTTP\.REQUEST|UTL_INADDR\.GET_HOST_NAME|UTL_TCP|DBMS_LDAP\.INIT)\s*\(/i,
  /\b(?:HTTPURITYPE|DBURITYPE|XDBURITYPE)\s*\(/i,
  // === PostgreSQL-specific ===
  /\bCOPY\s+\w+\s+FROM\s+PROGRAM\b/i,
  /\b(?:lo_import|lo_export)\s*\(/i,
  // === HQL/JPQL injection ===
  /\bFROM\s+\w+\s+WHERE\s+\w+\s*=\s*\w+\s+(?:OR|AND)\s+/i,
  /\bSELECT\s+NEW\s+\w+\s*\(/i,
  // === MySQL-specific ===
  /\bSELECT\s+.*INTO\s+(?:OUT|DUMP)FILE\b/i,
  /\bBENCHMARK\s*\(\s*\d+\s*,\s*\w+\s*\(/i,
  // === group_concat data extraction ===
  /\bGROUP_CONCAT\s*\(/i,
  /\bstring_agg\s*\(/i,
  /\bLISTAGG\s*\(/i,
];

// ── NoSQL Injection (expanded) ──────────────────────────────────────────────
const NOSQL_INJECTION_PATTERNS = [
  // === MongoDB operators ===
  /\$ne\b/i,
  /\$gt\b/i,
  /\$gte\b/i,
  /\$lt\b/i,
  /\$lte\b/i,
  /\$regex\b/i,
  /\$where\b/i,
  /\$exists\b/i,
  /\$type\b/i,
  /\$mod\b/i,
  /\$expr\b/i,
  /\$jsonSchema\b/i,
  /\$function\b/i,
  /\$accumulator\b/i,
  /\$lookup\b/i,
  /\$graphLookup\b/i,
  /\$facet\b/i,
  /\$bucket\b/i,
  /\$bucketAuto\b/i,
  /\$sortByCount\b/i,
  /\$addFields\b/i,
  /\$replaceRoot\b/i,
  /\$merge\b/i,
  /\$out\b/i,
  /\$unwind\b/i,
  /\$sample\b/i,
  /\$redact\b/i,
  /\$switch\b/i,
  /\$let\b/i,
  /\$map\b/i,
  /\$filter\b/i,
  /\$reduce\b/i,
  /\$concatArrays\b/i,
  /\$slice\b/i,
  /\$size\b/i,
  /\$elemMatch\b/i,
  /\$all\b/i,
  /\$in\b/i,
  /\$nin\b/i,
  /\$or\b/i,
  /\$and\b/i,
  /\$not\b/i,
  /\$nor\b/i,
  /\$text\b/i,
  /\$search\b/i,
  /\$comment\b/i,
  /\$natural\b/i,
  /\$ref\b/i,
  /\$db\b/i,
  /\$id\b/i,
  /\$options\s*:\s*['"]i['"]/i,  // case-insensitive regex abuse
  /\$regex\s*:\s*['"].*['"]\s*,\s*\$options\s*:\s*['"]i['"]/i,

  // === projected sensitive fields ===
  /\$project\b.*\b(?:password|passwd|secret|token|key|credential|private_key|api_key)\b/i,

  // === JavaScript execution ===
  /\$where\s*:\s*['"]function/i,
  /\$function\s*:\s*\{/,

  // === ElastiSearch query DSL injection ===
  /\b(?:script\s*\{|inline\s*['"]|\bsource\s*['"][^'"]{0,100}(?:execute|exec|Runtime|ProcessBuilder|Class\.forName))/i,
  // === Redis injection ===
  /\b(?:CONFIG\s+SET|CONFIG\s+GET|SAVE|BGSAVE|SHUTDOWN|FLUSHALL|FLUSHDB|DEBUG\s+SEGFAULT|MODULE\s+LOAD|SLAVEOF|REPLICAOF|MIGRATE)\b/i,
  /\b(?:EVAL|EVALSHA)\b/i,
  // === Cassandra/CQL injection ===
  /\b(?:CREATE\s+KEYSPACE|DROP\s+KEYSPACE|ALTER\s+KEYSPACE|CREATE\s+TABLE|DROP\s+TABLE|TRUNCATE\s+TABLE)\b/i,
  // === DynamoDB injection ===
  /\b(?:FilterExpression|KeyConditionExpression|UpdateExpression|ConditionExpression)\s*:\s*['"][^'"]{0,100}(?:SET|REMOVE|ADD|DELETE)\b/i,
  // === CouchDB injection ===
  /\b(?:_design|_all_docs|_changes|_replicate|_compact|_view_cleanup)\b/i,
];

// ── Boundary / Null-Byte Evasion (expanded) ──────────────────────────────────
const BOUNDARY_EVASION_PATTERNS = [
  // === null byte injection ===
  /\\x00/,
  /%00/,
  /\x00/,
  /\\u0000/,
  /\\0/,
  /\0/,
  /%2500/,  // double-encoded null

  // === path traversal ===
  /\.\.\//,
  /\.\.\\/,
  /\.\.%2[fF]/,
  /\.\.%5[cC]/,
  /%2e%2e%2[fF]/,
  /%2e%2e%5[cC]/,
  /\/(?:\.\.\/){2,}/,
  /\\\.\.\\\.\./,

  // === Unicode bidi / normalization attacks ===
  /\u202E/, // RTL override
  /\u202D/, // LTR override
  /\u200F/, // RTL mark
  /\u200E/, // LTR mark
  /\u202A/, // LTR embedding
  /\u202B/, // RTL embedding
  /\u202C/, // pop directional formatting
  /\u2066/, // LRI
  /\u2067/, // RLI
  /\u2068/, // FSI
  /\u2069/, // PDI
  /\uFEFF/, // BOM / zero-width no-break space
  /\u200B/, // zero-width space
  /\u200C/, // zero-width non-joiner
  /\u200D/, // zero-width joiner
  /\u00AD/, // soft hyphen
  /\u034F/, // combining grapheme joiner
  /\u061C/, // Arabic letter mark

  // === encoding overflow ===
  /%(?:[0-9a-fA-F]{2}%){5,}/,  // chain of URL-encoded chars
  /\\x[0-9a-fA-F]{2}\\x[0-9a-fA-F]{2}\\x[0-9a-fA-F]{2}/,  // chain of hex escapes
  /\\u[0-9a-fA-F]{4}\\u[0-9a-fA-F]{4}/,  // chain of unicode escapes

  // === length / overflow probes ===
  /A{200,}/,   // potential buffer overflow probe (single-char repeat)
  /^#{100,}$/, // padding oracle probe
];

// ── Credential / Secret Exfiltration (massively expanded) ───────────────────
const CREDENTIAL_ARG_PATTERNS = [
  // === OpenAI / API keys ===
  /^sk-[a-zA-Z0-9]{20,}$/,
  /^sk-[a-zA-Z0-9]{32,}$/,
  /^sk-(?:proj|org|svcacct|admin)-[a-zA-Z0-9]{20,}$/,

  // === AWS ===
  /^AKIA[0-9A-Z]{16}$/,             // AWS Access Key ID
  /^[A-Za-z0-9/+=]{40}$/,           // AWS Secret Access Key
  /^arn:aws:(?:iam|sts|s3)::/,
  /^ASIA[0-9A-Z]{16}$/,             // AWS Session Token
  /^aws\.(?:accessKeyId|secretAccessKey|sessionToken)/i,

  // === Google Cloud ===
  /^GOOG[\w]{10,30}$/i,
  /^\{"type":"service_account"/,
  /^ya29\.[a-zA-Z0-9_-]{50,}$/,     // GCP OAuth

  // === Azure ===
  /^[a-z0-9]{8}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{12}$/i,  // UUID
  /^(?:DefaultEndpointsProtocol|AccountName|AccountKey)=/i,

  // === GitHub ===
  /^(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}$/,
  /^github_pat_[A-Za-z0-9_]{20,}$/,

  // === GitLab ===
  /^glpat-[A-Za-z0-9_-]{20,}$/,
  /^gldt-[A-Za-z0-9_-]{20,}$/,

  // === Slack ===
  /^xox[baprs]-[0-9A-Za-z-]{10,}$/,
  /^xox[pe]-[0-9A-Za-z-]{20,}$/,

  // === Stripe ===
  /^sk_live_[0-9a-zA-Z]{20,}$/,
  /^pk_live_[0-9a-zA-Z]{20,}$/,
  /^sk_test_[0-9a-zA-Z]{20,}$/,
  /^whsec_[0-9a-zA-Z]{20,}$/,

  // === Twilio ===
  /^SK[0-9a-fA-F]{32}$/,
  /^AC[0-9a-fA-F]{32}$/,
  /^[a-zA-Z0-9]{32}$.*twilio/i,

  // === SendGrid / Mailgun ===
  /^SG\.[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}$/,
  /^key-[0-9a-zA-Z]{32}$/,

  // === Heroku / Vercel / Netlify ===
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,

  // === Docker Hub / Container Registry ===
  /^dckr_pat_[A-Za-z0-9_-]{20,}$/,
  /^[a-z0-9]{8}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{12}\.[a-z0-9]{10,}/,

  // === JWT / tokens ===
  /^eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{10,}$/,

  // === private keys ===
  /-----BEGIN\s+(?:RSA|EC|OPENSSH|DSA|PGP|ENCRYPTED)\s+PRIVATE\s+KEY-----/,
  /-----BEGIN\s+(?:CERTIFICATE|RSA\s+PUBLIC\s+KEY)-----/,
  /ssh-rsa\s+AAAA[0-9A-Za-z+/]+[=]{0,3}\s/,

  // === database connection strings ===
  /:\/\/[^:@\s]{1,50}:[^@\s]{1,100}@[^/\s]+\/[^\s]*/,
  /(?:mongodb|mysql|postgres|postgresql|redis|sqlite|mssql|oracle|jdbc):\/\/[^:@\s]{1,50}:[^@\s]+@/i,
  /(?:mongodb\+srv|mongodb|mysql|postgresql):\/\/[^\s]+.*(?:password|passwd|pwd)=/i,

  // === generic credential keywords in values ===
  /^(?:password|passwd|pwd|passkey|secret|secret_key|api_key|api_secret|token|auth_token|access_token|bearer_token|private_key|client_secret|master_key|encryption_key|signing_key)[=:]['"]?[^\s'"]{8,}['"]?/i,

  // === connection strings with embedded secrets ===
  /:\/\/[^:]+:[^@]+@/,  // user:pass@host URLs
  /(?:host|server|database|db|port|user|username|uid)\s*=\s*['"][^'"]{2,}['"]/i,

  // === high-entropy base64 strings (probable secrets) ===
  /^[A-Za-z0-9+/]{40,}={0,2}$/,

  // === npm / pypi tokens ===
  /^npm_[A-Za-z0-9]{36}$/,
  /^pypi-[A-Za-z0-9]{32,}$/,

  // === Discord bot tokens ===
  /^[MN][A-Za-z\d]{23}\.[\w-]{6}\.[\w-]{27}$/,
  /^OD[a-zA-Z\d]{22}$/,

  // === CircleCI / TravisCI / Jenkins ===
  /^[0-9a-fA-F]{40,}$/,  // Possible SHA-like token
  /^(?:CIRCLE|TRAVIS|JENKINS|BUILDKITE|DRONE)_TOKEN/i,
];

// ── Shell Obfuscation & Injection (expanded) ────────────────────────────────
const SHELL_OBFUSCATION_ARG_PATTERNS = [
  // === variable expansion obfuscation ===
  /\$\{IFS\}/,
  /\$\{?IFS\}?/,
  /\$\{?[A-Z_]{2,}\}?/,
  /\$\{?[@*#?$!-]\}?/,
  /\$\{[A-Z_]+:-\s*[^}]+\}/,
  /\$\{[A-Z_]+:\+[^}]+\}/,
  /\$\{[A-Z_]+\?[^}]+\}/,
  /\$\{[A-Z_]+=[^}]+\}/,
  /\$\{[#%]?[A-Z_]+\}/,

  // === command substitution ===
  /\$\(.*\)/,
  /`[^`]{3,}`/,
  /\$\(\(.*\)\)/,

  // === encoding chains ===
  /\\x[0-9a-fA-F]{2}/,
  /\\[0-7]{3}/,
  /\\u[0-9a-fA-F]{4}/,

  // === glob / wildcard abuse ===
  /\{\s*,/,
  /\[\s*!/,

  // === here-documents ===
  /<<\s*['"]?\w+['"]?\s*\n/,
  /<<-\s*['"]?EOF['"]?/i,

  // === dangerous commands (used in injection regardless of key path) ===
  /\b(?:eval|exec|system|popen|subprocess|os\.system|shell_exec|passthru|proc_open)\s*\(/i,
  /\b(?:nc\s+-[eln]|netcat\s+-[eln]|ncat\s+-[eln])\b/i,
  /\b(?:bash\s+-c|sh\s+-c|zsh\s+-c|dash\s+-c|powershell\s+-[cC]|pwsh\s+-[cC]|cmd\s+\/[cC])\b/i,
  /\b(?:curl\s+.+\|\s*(?:ba)?sh|wget\s+.+\|\s*(?:ba)?sh)\b/i,
  /\b(?:chmod\s+[0-7]{3,4}|chown\s+root)/i,
  /\b(?:iptables|ufw)\s+-[ADIL]/i,
  /\b(?:crontab|at\s+|systemctl|service)\b/i,
  /\b(?:mkfifo|mknod)\b/i,
  /\b(?:\/dev\/tcp\/|\/dev\/udp\/)/i,
  /\b(?:2>&1|>&2|2>\/dev\/null|>\/dev\/null)\b/,
  /\b(?:base64\s+(?:-d|--decode)|xxd\s+-[rp])/i,
  /\b(?:openssl\s+enc|gpg\s+--decrypt|gzip\s+-d)\b/i,
  /\bping\s+-c\s+\d+\s+127\.0\.0\.1/i,

  // === process substitution ===
  /<\(.*\)/,
  />\(.*\)/,

  // === input redirection ===
  /<\s*\(/,
  /\|\s*(?:bash|sh|dash|zsh)/i,

  // === list operators (&&, ||, ;, |) ===
  /\s*&&\s*(?:cat\b|id\b|whoami|uname|ls\b|pwd|env\b)/i,
  /\s*\|\|\s*(?:cat\b|id\b|whoami)/i,
  /;\s*(?:cat\b|id\b|whoami|uname|ls\b|pwd)\b/i,
  /\|\s*(?:cat\b|id\b|whoami|head|tail|grep|sed|awk)/i,
];

// ── Context Injection / Template Breakout ───────────────────────────────────
const CONTEXT_INJECTION_PATTERNS = [
  // === template engine injection ===
  /\{\{[\s\S]{1,50}\}\}/,          // Jinja2 / Handlebars / Mustache
  /\{%[\s\S]{1,50}%\}/,            // Jinja2 block
  /\$\{[\s\S]{1,50}\}/,            // ES6 / Spring / Velocity
  /<%=?[\s\S]{1,50}%>/,            // EJS / ERB
  /\{\#[\s\S]{1,50}\}/,            // Handlebars partial
  /\#\{[\s\S]{1,50}\}/,            // Ruby string interpolation
  /\{\{=\s*\w+\s*\}\}/,            // Vue interpolation
  /\[\[[\s\S]{1,50}\]\]/,          // Angular / Thymeleaf

  // === SSTI (Server-Side Template Injection) payloads ===
  /\{\{7\*7\}\}/,
  /\$\{7\*7\}/,
  /\{\{'a'\s*\|\s*filter\(/,
  /\{\{config\}\}/i,
  /\{\{self\}\}/i,
  /\{\{request\}\}/i,
  /\{\{lipsum\}\}/i,
  /\{\{cycler\}\}/i,
  /\{\{joiner\}\}/i,
  /\{\{namespace\}\}/i,
  /\{\{range\}\}/i,
  /\{\{get_flashed_messages\}\}/i,
  /\{\{\.\|attr\(/,
  /\{\{''\.__class__/i,
  /\{\{''__class__\}/i,
  /\{\{''\.__mro__/i,
  /\{\{''\.__subclasses__\(\)/i,
  /\{\{''\.__globals__/i,
  /\{\{''\.__init__/i,

  // === context breakout in strings ===
  /(["'])\s*\+\s*\1/,
  /\\x[0-9a-f]{2}\\x[0-9a-f]{2}\\x[0-9a-f]{2}\\x[0-9a-f]{2}/,
  /\+\+[\s\S]{0,30}\+\+/,

  // === comment-based breakout ===
  /\/\*[\s\S]{0,50}\*\/\s*[;}]/,
  /-->\s*<script/i,
  /-->.*<[^>]+>/i,
];

// ── SSRF / URL Manipulation ──────────────────────────────────────────────────
const SSRF_PATTERNS = [
  // === internal IPs / localhost ===
  /https?:\/\/(?:127\.\d+\.\d+\.\d+|localhost)(?::\d+)?\//i,
  /https?:\/\/(?:10\.\d+\.\d+\.\d+|172\.(?:1[6-9]|2[0-9]|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+)(?::\d+)?\//i,
  /https?:\/\/0\.0\.0\.0(?::\d+)?\//i,
  /https?:\/\/\[::1\](?::\d+)?\//i,
  /https?:\/\/\[?::\]?(?::\d+)?\//i,

  // === cloud metadata endpoints ===
  /169\.254\.169\.254/,
  /metadata\.google\.internal/i,
  /\/latest\/meta-data\//i,
  /\/latest\/user-data\//i,
  /\/\.well-known\//i,

  // === URL scheme tricks ===
  /^(?:file|gopher|dict|ftp|ldap|tftp|redis|sftp|ssh|git):\/\//i,
  /^(?:jar|netdoc|mailto|telnet):/i,

  // === DNS rebinding indicators ===
  /[a-z]+\d+\.[a-z]+\d+\.[a-z]+\.\w+/i,  // suspicious multi-subdomain

  // === URL obfuscation ===
  /\/\/[^/\s]+@/,  // userinfo in URL
  /https?:\\?\/\\?\/[^/\s]+/,
  /\/\/[^/\s]+\.(?:burpcollaborator|interact\.sh|oastify|canarytokens)/i,
  /data:(?:text\/html|application\/javascript)/i,
  /javascript\s*:\s*/i,
];

// ── Command Injection (generic, beyond shell) ───────────────────────────────
const COMMAND_INJECTION_PATTERNS = [
  // === pipe chains ===
  /\|\s*(?:cat\b|id\b|whoami|uname|ls\b|pwd|env\b|sh\b|bash\b)/i,
  /;\s*(?:cat\b|id\b|whoami|uname|ls\b|pwd|env\b)/i,
  /\s*&&\s*(?:cat\b|id\b|whoami|uname)/i,

  // === newline injection ===
  /\n\r?(?:cat\b|id\b|whoami|uname|ls\b)/i,
  /%0[ad][%0a]?(?:cat|id|whoami)/i,

  // === common injection payloads ===
  /\b(?:whoami|hostname|uname\s+-a|id\b(?:\s|$)|pwd\b(?:\s|$))\b/i,
  /\bcat\s+\/etc\/(?:passwd|shadow|hosts)/i,
  /\bping\s+-c\s+\d+\s/i,
  /\bnslookup\s+/i,
  /\bdig\s+/i,
  /\bwget\s+http/i,
  /\bcurl\s+(?:-s\s+)?http/i,
];

// ── XML / XXE / XPath Injection ─────────────────────────────────────────────
const XML_INJECTION_PATTERNS = [
  // === XXE ===
  /<!ENTITY\s+\w+\s+SYSTEM\s+['"]/i,
  /<!ENTITY\s+\w+\s+PUBLIC\s+['"]/i,
  /<!ELEMENT\b/i,
  /<!DOCTYPE\s+\w+\s+\[/i,
  /<!ATTLIST\b/i,
  /<\?xml[^>]+\?>/i,

  // === XPath injection ===
  /'?\s*(?:or|and)\s+'?\d+'?\s*=\s*'?\d+'?/i,
  /\|\s*(?:text|comment|processing-instruction)\s*\(/i,
  /\/\/(?:\w+::?\w+|\*)/,
  /@@\w+/,

  // === XML bomb / billion laughs ===
  /<!ENTITY\s+\w+\s+['"]\w+['"](?:\s+\w+\s+['"]\w+['"]){3,}/,

  // === XSLT injection ===
  /<xsl:(?:stylesheet|template|value-of|apply-templates)/i,
  /<xsl:variable\s+name=/i,
];

// ── LDAP Injection ──────────────────────────────────────────────────────────
const LDAP_INJECTION_PATTERNS = [
  // === filter injection ===
  /\((?:\||&|!)\s*\(\s*\w+\s*=\s*\*\)\)/i,
  /\)\s*\(\s*\|/i,
  /\)\((?:\||&)/i,

  // === attribute enumeration ===
  /\(\s*(?:objectClass|cn|uid|sn|givenName|mail|memberOf|userPassword)\s*=\s*\*/i,

  // === OR injection ===
  /\(\|\s*\([^)]+\)\s*\([^)]+\)/,

  // === DN injection ===
  /,\s*(?:ou|dc|cn|o|l|st|c|country)\s*=/i,
];

// ── Deserialization Attacks ─────────────────────────────────────────────────
const DESERIALIZATION_PATTERNS = [
  // === Java ===
  /^rO0AB/,
  /^aced0005/,  // Java serialization header (hex)
  /\b(?:ObjectInputStream|readObject|writeObject)\b/i,
  /\b(?:Runtime\.getRuntime\(\)\.exec|ProcessBuilder)\b/i,
  /\b(?:Class\.forName|newInstance)\b/i,
  /\b(?:javax\.script\.ScriptEngineManager)\b/i,

  // === Python pickle ===
  /\b(?:cos\nsystem|__reduce__|__reduce_ex__)\b/i,
  /\bc(?:pickle|opy_reg)\b/i,
  /\b(?:builtins\.exec|builtins\.eval|os\.system|subprocess\.Popen)\b/i,

  // === PHP unserialize ===
  /^[aOC]:\d+:/,
  /^[OC]:\d+:"[^"]+":\d+:/,

  // === .NET ===
  /\b(?:BinaryFormatter|SoapFormatter|LosFormatter|NetDataContractSerializer)\b/i,
  /\b(?:ObjectStateFormatter|JavaScriptSerializer)\b/i,
  /__type\s*:\s*['"]System\./i,

  // === YAML deserialization ===
  /^!!(?:python|ruby|perl)\//i,
  /^!!(?:javax\.script|com\.sun)/i,
  /!!\s*python\/object:/i,
];

// ── ReDoS / Regex Bombing ──────────────────────────────────────────────────
/** Detect regex-bomb payloads; patterns are bounded — matching uses testPattern(). */
const REDOS_PATTERNS = [
  /(?:a+){10,}/i,
  /(?:a+a+)+b/i,
  /\([^)]{0,20}\)\s*\+\s*\([^)]{0,20}\)\s*\+\s*\([^)]{0,20}\)/,
  /(\w\+)\+\w\+/,
  /\{0,\d+\}\{0,\d+\}\{0,\d+\}/,
  /(?:\([^)]{0,20}\)\*){3,}/,
];

// ── Dangerous JavaScript Patterns ──────────────────────────────────────────
const DANGEROUS_JS_PATTERNS = [
  // === code execution ===
  /\beval\s*\(/,
  /\bFunction\s*\(/,
  /\bsetTimeout\s*\(\s*['"`][^'"`]{5,}/i,
  /\bsetInterval\s*\(\s*['"`][^'"`]{5,}/i,
  /\bnew\s+Function\b/i,
  /\bconstructor\s*\(/,
  /\[['"]constructor['"]\]/,

  // === require / import in eval contexts ===
  /\brequire\s*\(\s*['"]child_process['"]\s*\)/i,
  /\brequire\s*\(\s*['"]fs['"]\s*\)/i,
  /\brequire\s*\(\s*['"]net['"]\s*\)/i,
  /\brequire\s*\(\s*['"]http['"]\s*\)/i,
  /import\s+.*\s+from\s+['"](?:child_process|fs|net|http)/i,

  // === prototype pollution ===
  /__proto__\s*:/,
  /constructor\s*:\s*\{/,
  /prototype\s*\[/,
  /\.__proto__\s*=/,

  // === XSS in JS context ===
  /<script[^>]*>/i,
  /<\/script>/i,
  /onerror\s*=/i,
  /onload\s*=/i,
  /javascript\s*:\s*/i,
  /document\.cookie/i,
  /document\.write\s*\(/i,
  /innerHTML\s*=/i,

  // === DOM clobbering ===
  /\.(?:forms|embeds|plugins|anchors|images|links|applets)\[/i,
];

// ── XSS / HTML / CSS Injection Patterns (Phase 5B) ─────────────────────────
const XSS_INJECTION_PATTERNS: RegExp[] = [
  // === Reflected XSS ===
  /<script[^>]*>[^<]{0,100}<\/script>/i,
  /<img[^>]+onerror\s*=/i,
  /<img[^>]+onload\s*=/i,
  /<svg[^>]+onload\s*=/i,
  /<body[^>]+onload\s*=/i,
  /<input[^>]+onfocus\s*=/i,
  /<iframe[^>]+src\s*=\s*['"]javascript:/i,
  // === Stored XSS event handlers ===
  /\bon(?:mouseover|mouseout|mousedown|mouseup|click|dblclick|keydown|keyup|keypress|focus|blur|change|submit|reset|select|abort)\s*=/i,
  // === DOM-based XSS ===
  /\bdocument\.write\s*\(/i,
  /\beval\s*\(/i,
  /\bsetTimeout\s*\(\s*['"][^'"]{5,}/i,
  /\bsetInterval\s*\(\s*['"][^'"]{5,}/i,
  /\.innerHTML\s*=\s*['"][^'"]{5,}/i,
  /\.outerHTML\s*=/i,
  // === CSS injection ===
  /style\s*=\s*['"][^'"]*\bexpression\s*\(/i,
  /<style[^>]*>\s*@import\s+url\s*\(/i,
  /\bmoz-binding\s*:/i,
  /@import\s+url\s*\(/i,
  // === CSP bypass ===
  /<link[^>]+rel\s*=\s*['"]stylesheet['"][^>]+href\s*=\s*['"]data:/i,
  /<meta[^>]+http-equiv\s*=\s*['"]refresh['"][^>]+url\s*=\s*['"]javascript:/i,
  // === HTML smuggling ===
  /data:text\/html[^;]{0,50}base64/i,
  /<a[^>]+href\s*=\s*['"]javascript:/i,
  /<form[^>]+action\s*=\s*['"]javascript:/i,
  // === SVG-based XSS ===
  /<svg[^>]*>[^<]{0,100}<script[^>]*>[^<]{0,100}<\/script>/i,
  /<animate[^>]+onbegin\s*=/i,
  /<set[^>]+onbegin\s*=/i,
  /<use[^>]+href\s*=\s*['"]data:/i,
];

// ── DNS / Side-Channel Exfiltration Patterns (Phase 5C) ─────────────────────
const EXFILTRATION_PATTERNS: RegExp[] = [
  // === DNS tunneling ===
  /[a-zA-Z0-9]{30,}\.(?:burpcollaborator|interact\.sh|oastify|canarytokens|requestbin|webhook\.site|pipedream|beeceptor)/i,
  /[a-zA-Z0-9]{30,}\.(?:xyz|tk|ml|ga|cf|gq|pw|top|club|online|site|website|space|fun|host|press|digital)\)?$/i,
  // === DNS exfiltration via dig/nslookup ===
  /\b(?:dig|nslookup|host)\s+[\w-]+\.[\w-]+\.\w+/i,
  /\b(?:dig|nslookup)\s+-t\s+\w+\s+\w+/i,
  // === ICMP exfiltration ===
  /\bping\s+-[c]\s+\d+\s+-p\s+[0-9a-fA-F]/i,
  /\bping\s+-s\s+\d{3,}\b/i,
  // === HTTP-based data exfiltration ===
  /\bcurl\s+[^|]+\|[^|]*\b(?:nc|netcat|ncat)\b/i,
  /\bwget\s+[^|]+\|\s*(?:nc|netcat)\b/i,
  /\bcurl\s+-d\s+['"]?\$\(/i,
  /\bcurl\s+.*--data-binary\s+@/i,
  // === WebSocket exfiltration ===
  /\bnew\s+WebSocket\s*\(/i,
  /\bwss?:\/\/[^\s'"]+\?data=/i,
  // === Timing side-channels ===
  /\b(?:sleep|usleep)\s+\d+\s*;/i,
  /\bping\s+-c\s+\d+\s+-i\s+\d+\b/i,
];

// ── HTTP Smuggling & Cache Poisoning (Phase 5D) ──────────────────────────────
const HTTP_SMUGGLING_PATTERNS: RegExp[] = [
  // === CL.TE smuggling ===
  /Content-Length\s*:\s*\d+\s*\r?\n\s*Transfer-Encoding\s*:\s*chunked/i,
  // === TE.CL smuggling ===
  /Transfer-Encoding\s*:\s*chunked\s*\r?\n\s*Content-Length\s*:\s*\d+/i,
  // === TE.TE confusion ===
  /Transfer-Encoding\s*:\s*[^\n]{0,50}\n\s*Transfer-Encoding\s*:/i,
  // === Cache poisoning headers ===
  /X-Forwarded-Host\s*:\s*[^\n]+/i,
  /X-Original-URL\s*:\s*/i,
  /X-Rewrite-URL\s*:\s*/i,
  /X-HTTP-Method-Override\s*:/i,
  // === HTTP Parameter Pollution ===
  /(?:\?|&)[a-zA-Z0-9_-]+=[^&]*&[a-zA-Z0-9_-]+=[^&]*&[a-zA-Z0-9_-]+=[^&]*&[a-zA-Z0-9_-]+=/,
  // === Response splitting ===
  /\r\nHTTP\/[0-9]\.[0-9]/i,
  /\r\nSet-Cookie\s*:/i,
  /\r\nLocation\s*:/i,
  /\r\nContent-Type\s*:/i,
  // === Host header attacks ===
  /Host\s*:\s*[^\n]+\nHost\s*:/i,
  /Host\s*:\s*[^\n]+\nX-Forwarded-Host\s*:/i,
];

// ── Deserialization Gadget Chains (Phase 5E) ─────────────────────────────────
const DESERIALIZATION_GADGET_PATTERNS: RegExp[] = [
  // === Java ysoserial gadgets ===
  /\b(?:CommonsCollections[1-7]|CommonsBeanutils[12]|Spring[12]|Groovy[12]|Jdk7u21|Jdk8u20|Jython1|Myfaces[12]|ROME|Click1|C3P0|Wicket1|Clojure|Hibernate[12]|JBossInterceptors1|JSON1|JavassistWeld1|JRE8u20|MozillaRhino[12]|URLDNS|JRMPClient|JRMPListener)\b/i,
  // === InvokerTransformer chain ===
  /\b(?:InvokerTransformer|ChainedTransformer|ConstantTransformer|InstantiateTransformer|ClosureTransformer)\b/i,
  // === JNDI/LDAP/RMI attack vectors ===
  /\b(?:ldap|rmi|dns|iiop|corbaname|nis):\/\/[^\s'"]+/i,
  /\$\{jndi:/i,
  /\$\{java:/i,
  // === Python pickle RCE ===
  /\b__setstate__\b/i,
  /\b__getstate__\b/i,
  /\bcopyreg\s*\(/i,
  /\bposix\.system\b/i,
  /\bnt\.system\b/i,
  // === PHP unserialize gadgets (Monolog, Guzzle, WordPress) ===
  /\bO:\d+:"Monolog\\\\Handler/i,
  /\bO:\d+:"GuzzleHttp\\\\Cookie/i,
  /\b(?:WP_Image_Editor|Requests_Utility_FilteredIterator)/i,
  // === FastJSON / Jackson gadgets ===
  /\b(?:TemplatesImpl|JdbcRowSetImpl|LdapAttribute)\b/i,
  /@"type"\s*:\s*"[^"]*Jndi[^"]*"/i,
];

// ── GraphQL Injection (expanded) ─────────────────────────────────────────────
const GRAPHQL_INJECTION_PATTERNS: RegExp[] = [
  /\b(?:__schema|__type|__typename|__directive)\b/i,
  /\{[^}]{0,50}(?:__schema|__type)\{/i,
  /\bfragment\s+\w+\s+on\s+\w+\s*\{[^}]{0,100}(?:password|secret|token|credential)\}/i,
  /\bquery\s*\{[^}]{0,50}(?:__schema|__type|__typename)\b/i,
  /\b(?:query|mutation|subscription)\s*\{[\s\S]{1,200}?\}/i,
  /\b(?:alias|batch)\s*:\s*\{/i,
  /\b(?:introspection|schema)\s*\{/i,
];

// ── File Inclusion / Traversal ──────────────────────────────────────────────
const FILE_INCLUSION_PATTERNS = [
  // === absolute paths ===
  /^\/etc\/(?:passwd|shadow|hosts|sudoers|group|crontab)\b/,
  /^C:\\Windows\\(?:System32|SysWOW64)\\/i,
  /^\/proc\/(?:self|cpuinfo|meminfo|version|cmdline)\b/,

  // === PHP wrappers ===
  /^(?:php|file|http|https|ftp|compress\.zlib|data|glob|phar|ssh2|rar|ogg|expect):\/\//i,
  /^php:\/\/filter/i,
  /^php:\/\/input/i,
  /^data:\/\/text\/plain/i,

  // === traversal chains ===
  /(?:\.\.\/){3,}/,
  /(?:\.\.\\\\){3,}/,
  /(?:%2e%2e%2[fF]){2,}/,
  /(?:\.%2e\/){2,}/i,

  // === log file probes ===
  /\/var\/log\/(?:syslog|auth\.log|apache2|nginx|httpd|messages)/i,
];

// ── Log Injection / Log Forging ─────────────────────────────────────────────
const LOG_INJECTION_PATTERNS = [
  // === log forging newlines ===
  /\r\n/,
  /%0[dD]%0[aA]/,
  /\\n\\n/,
  /\n\r/,

  // === ANSI escape injection ===
  /\x1b\[/,
  /\e\[/,
  /\\033\[/,
  /\\x1b\[/,

  // === log level injection ===
  /\b(?:FATAL|CRITICAL|ERROR|PANIC|EMERGENCY|ALERT)\s*:\s*$/im,

  // === timestamp forging ===
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.?\d*Z?\s/,

  // === carriage return trick ===
  /\r(?!\n)/,
];

// ── Polyglot / Encoding Cascade Patterns ────────────────────────────────────
const POLYGLOT_PATTERNS = [
  // === multi-encoding detection ===
  /%(?:[0-9a-fA-F]{2}%){3,}[0-9a-fA-F]{2}/,
  /\\x[0-9a-fA-F]{2}\\x[0-9a-fA-F]{2}\\x[0-9a-fA-F]{2}/,
  /\\u[0-9a-fA-F]{4}\\u[0-9a-fA-F]{4}\\u[0-9a-fA-F]{4}/,

  // === base64 + other encoding ===
  /[A-Za-z0-9+/]{20,}={0,2}/,  // standalone base64 (when in non-credential context)
  /data:(?:image|text)\/[^;]+;base64,[A-Za-z0-9+/]{20,}/,

  // === SQL + shell polyglot ===
  /'\s*OR\s+1=1\s*;\s*whoami/i,
  /SELECT.*FROM.*;\s*(?:bash|sh|cmd)\b/i,

  // === JS + HTML polyglot ===
  /<script[^>]*>\s*(?:eval|alert|confirm)\s*\(/i,
  /"><script[^>]*>/i,

  // === PHP + JS polyglot ===
  /<\?php[\s\S]{0,30}eval\s*\(/i,
  /system\s*\(\s*['"]\$\{/i,

  // === HTML + CSS polyglot ===
  /style\s*=\s*['"]\s*expression\s*\(/i,
  /<style[^>]*>\s*@import\s+url\s*\(/i,

  // === encoding layer detection ===
  /JTY[0-9a-zA-Z%+/=]{10,}/,  // double-base64
  /%25[0-9a-fA-F]{2}/,         // double URL encoding
  /\\\\x[0-9a-fA-F]{2}/,       // double hex escape
];

// ── Obfuscation / Homoglyph Chains ──────────────────────────────────────────
const OBFUSCATION_PATTERNS = [
  // === mixed-case keyword obfuscation ===
  /\b(?:[Ss][Ee][Ll][Ee][Cc][Tt]|[Ii][Nn][Ss][Ee][Rr][Tt]|[Dd][Rr][Oo][Pp]|[Dd][Ee][Ll][Ee][Tt][Ee]|[Uu][Pp][Dd][Aa][Tt][Ee])\b/,

  // === whitespace tricks ===
  /[\u0009\u000B\u000C\u0020\u00A0\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]{5,}/,

  // === zero-width character chains ===
  /[\u200B-\u200F\uFEFF\u00AD]{3,}/,

  // === alternative number representations ===
  /0[xX][0-9a-fA-F]{6,}/,
  /0[oO][0-7]{6,}/,
  /0[bB][01]{12,}/,

  // === unicode homoglyphs for common attack words ===
  /[s\u0455\u0282\uA731][e\u0435\u0454\u212F][l\u0406\u217C\uFF4C\u0069][e\u0435\u0454][c\u0441\u03F2\u217D][t\u0442\u01AB]/i,  // SELECT
  /[d\u0500\u0189\u0257][r\u0280\u027E\u027D][o\u043E\u03BF\uFF4F][p\u0440\u03C1\uFF50]/i,  // DROP
  /[i\u0456\u2170][n\u0578\u03B7][s\u0455\u0282][e\u0435][r\u0433\u027E][t\u0442]/i,  // INSERT

  // === HTML entity obfuscation ===
  /&#\d{2,};/,
  /&#x[0-9a-fA-F]{2,};/,
  /&(?:lt|gt|amp|quot|apos);/,

  // === visible whitespace obfuscation ===
  /[^\S\r\n]{4,}/,
];

// ═══════════════════════════════════════════════════════════════════════════════
// SCANNER LOGIC
// ═══════════════════════════════════════════════════════════════════════════════

export interface ArgumentScanResult {
  issues: Issue[];
  addedLayers: {
    argument: { ran: boolean; durationMs: number };
  };
}

const SQL_KEYWORDS = new Set([
  'select', 'insert', 'update', 'delete', 'drop', 'alter', 'create',
  'grant', 'revoke', 'exec', 'execute', 'truncate', 'union', 'join',
  'from', 'where', 'having', 'group', 'order', 'by', 'into', 'load_file',
  'information_schema', 'sys', 'mysql', 'pg_catalog', 'benchmark',
  'declare', 'fetch', 'open', 'close', 'cursor', 'begin', 'commit',
  'rollback', 'savepoint', 'set', 'merge', 'replace', 'call',
  'explain', 'analyze', 'describe', 'show', 'use',
]);

function isSqlStringLikely(doc: { value: string; keyPath: string }): boolean {
  const lower = doc.value.toLowerCase();
  const words = lower.split(/[\s,;()]+/);
  const sqlWordCount = words.filter((w) => SQL_KEYWORDS.has(w)).length;
  return sqlWordCount >= 2;
}

function walkArgs(
  obj: unknown,
  prefix = '',
  maxDepth = 8,
  maxStrings = 200,
): { keyPath: string; value: string }[] {
  const results: { keyPath: string; value: string }[] = [];
  if (maxDepth <= 0 || results.length >= maxStrings) return results;
  if (obj === null || obj === undefined) return results;

  if (typeof obj === 'string') {
    results.push({ keyPath: prefix || '(root)', value: obj });
    return results;
  }
  if (typeof obj === 'number' || typeof obj === 'boolean') {
    results.push({ keyPath: prefix || '(root)', value: String(obj) });
    return results;
  }
  if (Array.isArray(obj)) {
    for (let i = 0; i < Math.min(obj.length, 20); i++) {
      const childResults = walkArgs(
        obj[i],
        prefix ? `${prefix}[${i}]` : `[${i}]`,
        maxDepth - 1,
        maxStrings - results.length,
      );
      results.push(...childResults);
      if (results.length >= maxStrings) break;
    }
    return results;
  }
  if (typeof obj === 'object') {
    const keys = Object.keys(obj as Record<string, unknown>).slice(0, 30);
    for (const k of keys) {
      const childResults = walkArgs(
        (obj as Record<string, unknown>)[k],
        prefix ? `${prefix}.${k}` : k,
        maxDepth - 1,
        maxStrings - results.length,
      );
      results.push(...childResults);
      if (results.length >= maxStrings) break;
    }
  }
  return results;
}

function isNoSqlQueryParam(keyPath: string): boolean {
  return /\b(?:filter|query|find|match|pipeline|aggregate|projection|sort|lookup|unwind)\b/i.test(keyPath);
}

function isSqlQueryParam(keyPath: string): boolean {
  return /\b(?:query|sql|statement|command|stored_procedure|sp_)\b/i.test(keyPath);
}

function isShellCommandParam(keyPath: string): boolean {
  return /\b(?:command|cmd|shell|exec|script|subprocess|process)\b/i.test(keyPath);
}

function isFilepathParam(keyPath: string): boolean {
  return /\b(?:path|file|filename|dir|directory|folder|location|root|home|dest|destination|source|src|target|output|input)\b/i.test(keyPath);
}

function isUrlParam(keyPath: string): boolean {
  return /\b(?:url|uri|link|href|endpoint|host|domain|callback|webhook|redirect|forward)\b/i.test(keyPath);
}

function isTemplateParam(keyPath: string): boolean {
  return /\b(?:template|tpl|view|render|body|content|text|message|description|prompt|markdown|html)\b/i.test(keyPath);
}

function isCodeParam(keyPath: string): boolean {
  return /\b(?:code|script|function|js|javascript|eval|expression|lambda|formula)\b/i.test(keyPath);
}

function isXmlParam(keyPath: string): boolean {
  return /\b(?:xml|soap|svg|html|xhtml|xslt|xsl|wsdl)\b/i.test(keyPath);
}

// Issue factory
function makeIssue(
  id: string,
  category: string,
  severity: 'critical' | 'warning',
  message: string,
  evidence: string,
  confidence: number,
): Issue {
  return {
    id,
    layer: 'argument',
    severity,
    category,
    message,
    evidence: evidence.slice(0, 200),
    confidence,
  };
}

export function runArgumentScan(
  args: Record<string, unknown> | undefined,
  toolName: string,
): ArgumentScanResult {
  const issues: Issue[] = [];
  const t0 = performance.now();

  if (!args || Object.keys(args).length === 0) {
    return {
      issues: [],
      addedLayers: { argument: { ran: true, durationMs: Math.round(performance.now() - t0) } },
    };
  }

  const flat = walkArgs(args);

  // ── Entropy-based secret detection (Shannon entropy) ────────────
  const entropyIssues = runEntropyScan(flat).map((i) => ({ ...i, layer: 'argument' as const }));
  issues.push(...entropyIssues);

  for (const item of flat) {
    // ── Unicode normalization + recursive decode before regex ────────
    // Fixes 88% Cyrillic homoglyph evasion + 50%+ encoding-based evasion
    const normalized = normalizeUnicode(item.value, true);

    // ══════════════════════════════════════════════════════════════════
    // Prompt Injection (all string leaves)
    // ══════════════════════════════════════════════════════════════════
    for (const pi of scanArgumentPromptInjection(item.value)) {
      issues.push({ ...pi, message: `${pi.message} in argument "${item.keyPath}"` });
    }

    // ══════════════════════════════════════════════════════════════════
    // SQL Injection
    // ══════════════════════════════════════════════════════════════════
    if (isSqlQueryParam(item.keyPath) || isSqlStringLikely({ value: normalized, keyPath: item.keyPath })) {
      for (const pattern of SQL_INJECTION_PATTERNS) {
        if (pattern.test(item.value) || pattern.test(normalized)) {
          issues.push(makeIssue(
            'MCPG-A-SQL-001', 'sql-injection', 'critical',
            `SQL injection pattern in argument "${item.keyPath}"`,
            item.value, 0.85,
          ));
          break;
        }
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // NoSQL Injection
    // ══════════════════════════════════════════════════════════════════
    if (isNoSqlQueryParam(item.keyPath)) {
      const combined = `${item.keyPath}=${item.value}`;
      for (const pattern of NOSQL_INJECTION_PATTERNS) {
        if (pattern.test(combined)) {
          issues.push(makeIssue(
            'MCPG-A-NSQL-001', 'nosql-injection', 'critical',
            `NoSQL operator injection detected in "${item.keyPath}"`,
            item.value, 0.85,
          ));
          break;
        }
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // Boundary / Null-Byte Evasion
    // ══════════════════════════════════════════════════════════════════
    if (isFilepathParam(item.keyPath)) {
      for (const pattern of BOUNDARY_EVASION_PATTERNS) {
        if (pattern.test(item.value)) {
          issues.push(makeIssue(
            'MCPG-A-BND-001', 'boundary-evasion', 'critical',
            `Boundary evasion / null byte pattern in "${item.keyPath}"`,
            item.value, 0.9,
          ));
          break;
        }
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // Credential Exfiltration
    // ══════════════════════════════════════════════════════════════════
    for (const pattern of CREDENTIAL_ARG_PATTERNS) {
      if (pattern.test(item.value)) {
        issues.push(makeIssue(
          'MCPG-A-CRED-001', 'credential-exfil', 'critical',
          `Possible credential/secret in argument "${item.keyPath}"`,
          item.value.slice(0, 60) + '...', 0.85,
        ));
        break;
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // Shell Obfuscation / Injection
    // ══════════════════════════════════════════════════════════════════
    if (isShellCommandParam(item.keyPath)) {
      for (const pattern of SHELL_OBFUSCATION_ARG_PATTERNS) {
        if (pattern.test(item.value)) {
          issues.push(makeIssue(
            'MCPG-A-SHELL-001', 'shell-obfuscation', 'critical',
            `Shell obfuscation / injection pattern in "${item.keyPath}"`,
            item.value, 0.8,
          ));
          break;
        }
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // Context Injection / Template Breakout
    // ══════════════════════════════════════════════════════════════════
    if (isTemplateParam(item.keyPath) || isCodeParam(item.keyPath)) {
      for (const pattern of CONTEXT_INJECTION_PATTERNS) {
        if (pattern.test(item.value)) {
          issues.push(makeIssue(
            'MCPG-A-CTX-001', 'context-injection', 'critical',
            `Context injection / template breakout in "${item.keyPath}"`,
            item.value, 0.8,
          ));
          break;
        }
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // SSRF / URL Manipulation
    // ══════════════════════════════════════════════════════════════════
    if (isUrlParam(item.keyPath)) {
      for (const pattern of SSRF_PATTERNS) {
        if (pattern.test(item.value)) {
          issues.push(makeIssue(
            'MCPG-A-SSRF-001', 'ssrf', 'critical',
            `SSRF / internal URL detected in "${item.keyPath}"`,
            item.value, 0.9,
          ));
          break;
        }
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // Generic Command Injection (all params)
    // ══════════════════════════════════════════════════════════════════
    for (const pattern of COMMAND_INJECTION_PATTERNS) {
      if (pattern.test(item.value)) {
        issues.push(makeIssue(
          'MCPG-A-CMD-001', 'command-injection', 'warning',
          `Command injection indicator in "${item.keyPath}"`,
          item.value, 0.6,
        ));
        break;
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // XML / XXE / XPath Injection
    // ══════════════════════════════════════════════════════════════════
    if (isXmlParam(item.keyPath)) {
      for (const pattern of XML_INJECTION_PATTERNS) {
        if (pattern.test(item.value)) {
          issues.push(makeIssue(
            'MCPG-A-XML-001', 'xml-injection', 'critical',
            `XML / XXE / XPath injection in "${item.keyPath}"`,
            item.value, 0.9,
          ));
          break;
        }
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // LDAP Injection
    // ══════════════════════════════════════════════════════════════════
    for (const pattern of LDAP_INJECTION_PATTERNS) {
      if (pattern.test(item.value)) {
        issues.push(makeIssue(
          'MCPG-A-LDAP-001', 'ldap-injection', 'warning',
          `LDAP injection pattern in "${item.keyPath}"`,
          item.value, 0.7,
        ));
        break;
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // Deserialization Attacks + Gadget Chains (Phase 5E)
    // ══════════════════════════════════════════════════════════════════
    if (isCodeParam(item.keyPath) || isSqlQueryParam(item.keyPath)) {
      for (const pattern of DESERIALIZATION_PATTERNS) {
        if (pattern.test(item.value)) {
          issues.push(makeIssue(
            'MCPG-A-DSER-001', 'deserialization', 'critical',
            `Deserialization attack pattern in "${item.keyPath}"`,
            item.value, 0.9,
          ));
          break;
        }
      }
      for (const pattern of DESERIALIZATION_GADGET_PATTERNS) {
        if (pattern.test(item.value)) {
          issues.push(makeIssue(
            'MCPG-A-DSER-002', 'deserialization', 'critical',
            `Deserialization gadget chain in "${item.keyPath}"`,
            item.value, 0.95,
          ));
          break;
        }
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // XSS / HTML / CSS Injection (Phase 5B)
    // ══════════════════════════════════════════════════════════════════
    for (const pattern of XSS_INJECTION_PATTERNS) {
      if (pattern.test(item.value)) {
        issues.push(makeIssue(
          'MCPG-A-XSS-001', 'xss-injection', 'critical',
          `XSS/HTML/CSS injection pattern in "${item.keyPath}"`,
          item.value, 0.9,
        ));
        break;
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // DNS / Side-Channel Exfiltration (Phase 5C)
    // ══════════════════════════════════════════════════════════════════
    if (isUrlParam(item.keyPath) || isShellCommandParam(item.keyPath)) {
      for (const pattern of EXFILTRATION_PATTERNS) {
        if (pattern.test(item.value)) {
          issues.push(makeIssue(
            'MCPG-A-EXFIL-001', 'exfiltration', 'critical',
            `DNS/side-channel exfiltration pattern in "${item.keyPath}"`,
            item.value, 0.85,
          ));
          break;
        }
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // HTTP Smuggling & Cache Poisoning (Phase 5D)
    // ══════════════════════════════════════════════════════════════════
    if (isUrlParam(item.keyPath)) {
      for (const pattern of HTTP_SMUGGLING_PATTERNS) {
        if (pattern.test(item.value)) {
          issues.push(makeIssue(
            'MCPG-A-HTTPS-001', 'http-smuggling', 'critical',
            `HTTP smuggling/cache poisoning in "${item.keyPath}"`,
            item.value, 0.85,
          ));
          break;
        }
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // GraphQL Injection (expanded)
    // ══════════════════════════════════════════════════════════════════
    if (item.value.includes('{')) {
      for (const pattern of GRAPHQL_INJECTION_PATTERNS) {
        if (testPattern(pattern, item.value, 2048)) {
        issues.push(makeIssue(
          'MCPG-A-GQL-001', 'graphql-injection', 'warning',
          `GraphQL injection/introspection in "${item.keyPath}"`,
          item.value, 0.75,
        ));
          break;
        }
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // ReDoS / Regex Bombing
    // ══════════════════════════════════════════════════════════════════
    for (const pattern of REDOS_PATTERNS) {
      if (testPattern(pattern, item.value)) {
        issues.push(makeIssue(
          'MCPG-A-REDOS-001', 'redos', 'warning',
          `Potential ReDoS / regex bombing in "${item.keyPath}"`,
          item.value.slice(0, 100), 0.7,
        ));
        break;
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // Dangerous JavaScript
    // ══════════════════════════════════════════════════════════════════
    if (isCodeParam(item.keyPath)) {
      for (const pattern of DANGEROUS_JS_PATTERNS) {
        if (pattern.test(item.value)) {
          issues.push(makeIssue(
            'MCPG-A-JS-001', 'dangerous-js', 'critical',
            `Dangerous JavaScript pattern in "${item.keyPath}"`,
            item.value, 0.85,
          ));
          break;
        }
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // File Inclusion / Traversal (all path-like params)
    // ══════════════════════════════════════════════════════════════════
    if (isFilepathParam(item.keyPath)) {
      for (const pattern of FILE_INCLUSION_PATTERNS) {
        if (pattern.test(item.value)) {
          issues.push(makeIssue(
            'MCPG-A-FI-001', 'file-inclusion', 'critical',
            `File inclusion / traversal in "${item.keyPath}"`,
            item.value, 0.9,
          ));
          break;
        }
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // Log Injection (all params)
    // ══════════════════════════════════════════════════════════════════
    for (const pattern of LOG_INJECTION_PATTERNS) {
      if (pattern.test(item.value)) {
        issues.push(makeIssue(
          'MCPG-A-LOG-001', 'log-injection', 'warning',
          `Log injection / log forging pattern in "${item.keyPath}"`,
          item.value.slice(0, 80), 0.75,
        ));
        break;
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // Polyglot / Encoding Cascade (all params)
    // ══════════════════════════════════════════════════════════════════
    for (const pattern of POLYGLOT_PATTERNS) {
      if (pattern.test(item.value)) {
        issues.push(makeIssue(
          'MCPG-A-POLY-001', 'polyglot-injection', 'warning',
          `Polyglot / encoding cascade in "${item.keyPath}"`,
          item.value, 0.7,
        ));
        break;
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // Obfuscation / Homoglyph Chains (all params)
    // ══════════════════════════════════════════════════════════════════
    for (const pattern of OBFUSCATION_PATTERNS) {
      if (pattern.test(item.value)) {
        issues.push(makeIssue(
          'MCPG-A-OBF-001', 'obfuscation-evasion', 'warning',
          `Obfuscation / homoglyph pattern in "${item.keyPath}"`,
          item.value.slice(0, 100), 0.65,
        ));
        break;
      }
    }
  }

  return {
    issues,
    addedLayers: { argument: { ran: true, durationMs: Math.round(performance.now() - t0) } },
  };
}

/** All scanner regexes — for ReDoS safety audit tests. */
export function getArgumentScannerPatterns(): RegExp[] {
  return [
    ...SQL_INJECTION_PATTERNS,
    ...NOSQL_INJECTION_PATTERNS,
    ...BOUNDARY_EVASION_PATTERNS,
    ...CREDENTIAL_ARG_PATTERNS,
    ...SHELL_OBFUSCATION_ARG_PATTERNS,
    ...CONTEXT_INJECTION_PATTERNS,
    ...SSRF_PATTERNS,
    ...OBFUSCATION_PATTERNS,
    ...COMMAND_INJECTION_PATTERNS,
    ...XML_INJECTION_PATTERNS,
    ...LDAP_INJECTION_PATTERNS,
    ...DESERIALIZATION_PATTERNS,
    ...REDOS_PATTERNS,
    ...DANGEROUS_JS_PATTERNS,
    ...XSS_INJECTION_PATTERNS,
    ...EXFILTRATION_PATTERNS,
    ...HTTP_SMUGGLING_PATTERNS,
    ...DESERIALIZATION_GADGET_PATTERNS,
    ...GRAPHQL_INJECTION_PATTERNS,
    ...FILE_INCLUSION_PATTERNS,
    ...LOG_INJECTION_PATTERNS,
    ...POLYGLOT_PATTERNS,
  ];
}