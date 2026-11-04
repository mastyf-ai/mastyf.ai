/**
 * Who could have written a field in a tool result. Judged from its structure only, never its text,
 * so injected content cannot change its own label.
 */

export type Origin = 'attacker_writable' | 'trusted' | 'unknown';

const FREE_TEXT_FIELD = new Set([
  'author', 'bio', 'body', 'caption', 'comment', 'comments', 'content', 'contents', 'desc', 'description',
  'feedback', 'from', 'html', 'instruction', 'instructions', 'markdown', 'memo', 'message', 'messages', 'note',
  'notes', 'readme', 'remark', 'remarks', 'review', 'reviews', 'sender', 'snippet', 'subject', 'summary', 'text',
  'title', 'transcript',
]);

// Web pages, downloads and other agents' replies: any part of the answer can say anything.
const WHOLE_RESULT_READER = new Set(['a2a', 'agent', 'browse', 'crawl', 'delegate', 'download', 'fetch', 'handoff',
  'scrape', 'subagent', 'url', 'web', 'webpage']);
// Whoever wrote the file or note wrote all of it, including anything shaped like a structured field.
const WHOLE_DOCUMENT_READER = /(?:^|_)(?:read_(?:file|text|multiple_files|note|document|doc|page)|get_(?:file_contents|note|document|doc|page)|cat)(?:$|_)/;

/** `GitHubGetUser`, `slack.post_message` and `git__diff` as lower-case words. */
export function nameWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function originOf(tool: string, fieldPath: string): Origin {
  const words = nameWords(tool);
  if (words.some((w) => WHOLE_RESULT_READER.has(w)) || WHOLE_DOCUMENT_READER.test(words.join('_'))) {
    return 'attacker_writable';
  }
  const leaf = fieldPath.replace(/\[\d+\]/g, '').split('.').pop() ?? '';
  return isFreeTextField(leaf) ? 'attacker_writable' : 'unknown';
}

export function isFreeTextField(name: string): boolean {
  return nameWords(name).some((w) => FREE_TEXT_FIELD.has(w));
}
