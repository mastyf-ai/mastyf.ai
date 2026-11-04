/**
 * What a tool call can do, judged from its name and arguments. A read cannot be turned into harm by
 * an injection on its own, so most calls need no further checks. Server-supplied annotations can
 * raise the risk or fill a gap but never lower what the name says: the server may be the attacker.
 */
import { nameWords } from './origins.js';
import { walkArgs } from './ledger.js';

export type Effect = 'read' | 'write' | 'external_send' | 'irreversible' | 'privilege' | 'unknown';

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
}

const VERBS: [Effect, Set<string>][] = [
  ['irreversible', new Set(['bash', 'burn', 'clear', 'command', 'delete', 'deploy', 'destroy', 'drop', 'erase', 'eval',
    'exec', 'execute', 'format', 'install', 'invoke', 'kill', 'overwrite', 'purge', 'remove', 'reset', 'restart', 'run',
    'shell', 'shutdown', 'terminal', 'terminate', 'trigger', 'truncate', 'uninstall', 'unlink', 'wipe'])],
  ['privilege', new Set(['admin', 'approve', 'authorize', 'ban', 'chmod', 'chown', 'credential', 'credentials', 'disable',
    'enable', 'grant', 'impersonate', 'invite', 'kick', 'password', 'permission', 'permissions', 'revoke', 'role', 'sudo',
    'token'])],
  ['external_send', new Set(['broadcast', 'deliver', 'dispatch', 'export', 'forward', 'notify', 'pay', 'payment', 'post',
    'publish', 'refund', 'reply', 'send', 'share', 'submit', 'sync', 'transfer', 'transmit', 'tweet', 'upload', 'webhook',
    'wire'])],
  ['write', new Set(['add', 'append', 'book', 'cancel', 'commit', 'create', 'edit', 'insert', 'merge', 'modify', 'move',
    'patch', 'push', 'put', 'rename', 'reserve', 'save', 'schedule', 'set', 'update', 'write'])],
  ['read', new Set(['browse', 'cat', 'check', 'count', 'describe', 'diff', 'download', 'fetch', 'find', 'get', 'list',
    'log', 'lookup', 'ls', 'ps', 'query', 'read', 'retrieve', 'search', 'show', 'stat', 'status', 'view', 'whoami'])],
];

// Nouns that are sends when they lead a step: `email_user`, `fetch_and_mail`. `get_mail` stays a read.
const SEND_WHEN_LEADING = new Set(['dm', 'email', 'mail', 'message', 'sms']);
const QUERY_TOOL = new Set(['database', 'db', 'query', 'sql']);
const STATEMENT_ARGS = ['query', 'sql', 'statement'];
const FREE_FORM_ARG = new Set(['body', 'comment', 'content', 'description', 'html', 'markdown', 'message', 'note',
  'notes', 'subject', 'summary', 'text', 'title']);

const RISK_ORDER: Effect[] = ['irreversible', 'privilege', 'write'];
const MAX_STATEMENT_CHARS = 64 * 1024;

/** The riskiest statement in a query, past comments and through every `;`. */
function statementEffect(args: unknown): Effect | null {
  if (!args || typeof args !== 'object') return null;
  const found = new Set<Effect>();
  for (const name of STATEMENT_ARGS) {
    const text = (args as Record<string, unknown>)[name];
    if (typeof text !== 'string') continue;
    // A query this long cannot be read through safely, so assume the worst of it.
    if (text.length > MAX_STATEMENT_CHARS) found.add('irreversible');
    const bare = text.slice(0, MAX_STATEMENT_CHARS).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
    for (const statement of bare.split(';')) {
      const verb = statement.trimStart().split(/\s+/)[0]?.toLowerCase();
      if (verb === 'drop' || verb === 'truncate' || verb === 'delete') found.add('irreversible');
      else if (verb === 'grant' || verb === 'revoke') found.add('privilege');
      else if (verb === 'update' || verb === 'insert' || verb === 'alter' || verb === 'create' || verb === 'merge') {
        found.add('write');
      }
    }
  }
  return RISK_ORDER.find((effect) => found.has(effect)) ?? null;
}

/** `fetch_and_mail` is two steps; each is judged by the word that leads it. */
function hasLeadingSend(words: string[]): boolean {
  const readVerbs = VERBS.find(([effect]) => effect === 'read')![1];
  let segment: string[] = [];
  const check = () => SEND_WHEN_LEADING.has(segment[0] ?? '') && !segment.some((w) => readVerbs.has(w));
  for (const word of words) {
    if (word === 'and' || word === 'then') {
      if (check()) return true;
      segment = [];
    } else {
      segment.push(word);
    }
  }
  return check();
}

export function classifyEffect(tool: string, args: unknown, annotations?: ToolAnnotations): Effect {
  const words = nameWords(tool);
  let effect: Effect = 'unknown';
  for (const [candidate, verbs] of VERBS) {
    if (words.some((w) => verbs.has(w))) {
      effect = candidate;
      break;
    }
  }
  if ((effect === 'read' || effect === 'write' || effect === 'unknown') && hasLeadingSend(words)) effect = 'external_send';
  if (effect === 'read' && words.some((w) => QUERY_TOOL.has(w))) effect = statementEffect(args) ?? effect;
  if (annotations?.destructiveHint && (effect === 'read' || effect === 'write' || effect === 'unknown')) {
    return 'irreversible';
  }
  if (effect === 'unknown' && annotations?.readOnlyHint) return 'read';
  return effect;
}

/**
 * Free-form arguments of a send. Quoting text there is normal, but a link or address in it is where the
 * reader gets sent, so those count even though the rest of the text does not.
 */
export function messageArgs(args: unknown, effect: Effect): string[] {
  if (effect !== 'external_send') return [];
  const paths: string[] = [];
  walkArgs(args, (path) => {
    const leaf = path.replace(/\[\d+\]/g, '').split('.').pop() ?? '';
    if (nameWords(leaf).some((w) => FREE_FORM_ARG.has(w))) paths.push(path);
  });
  return paths;
}

/**
 * Arguments that say where an action lands. Free-form content is left out of sends and writes: an
 * agent quoting an email it was asked to summarize is normal, so copied text alone is no evidence.
 * On code execution and access changes the name proves nothing, so every argument counts.
 */
export function sensitiveArgs(args: unknown, effect: Effect): string[] {
  if (effect === 'read') return [];
  const everyArg = effect === 'irreversible' || effect === 'privilege';
  const paths: string[] = [];
  walkArgs(args, (path) => {
    const leaf = path.replace(/\[\d+\]/g, '').split('.').pop() ?? '';
    if (everyArg || !nameWords(leaf).some((w) => FREE_FORM_ARG.has(w))) paths.push(path);
  });
  return paths;
}
