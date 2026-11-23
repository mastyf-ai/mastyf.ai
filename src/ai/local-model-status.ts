/**
 * Is the local model Threat Lab and Auto Research need there? Tells apart the things a new user has to
 * do (install Ollama, start it, download the model), so the dashboard can say which one is left.
 */
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { LlmAssistant } from './llm-assistant.js';

export type LocalModelState = 'ready' | 'not-installed' | 'not-running' | 'model-missing' | 'disabled';

export interface LocalModelStatus {
  ok: boolean;
  state: LocalModelState;
  model: string;
  endpoint: string;
  reason?: string;
}

/** Looks for the Ollama program on this machine, on PATH or where its installers put it. */
export function ollamaInstalled(env: NodeJS.ProcessEnv = process.env, exists: (p: string) => boolean = existsSync): boolean {
  const names = process.platform === 'win32' ? ['ollama.exe', 'ollama.cmd'] : ['ollama'];
  const dirs = (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean);
  if (env.LOCALAPPDATA) dirs.push(join(env.LOCALAPPDATA, 'Programs', 'Ollama'));
  dirs.push('/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/Applications/Ollama.app/Contents/Resources');
  return dirs.some((d) => names.some((n) => exists(join(d, n))));
}

/** Ollama lists `qwen3:8b` as `qwen3:8b`, and an untagged model as `name:latest`. */
export function hasModel(tags: string[], model: string): boolean {
  const want = model.includes(':') ? model : `${model}:latest`;
  return tags.includes(want);
}

const REASONS: Record<Exclude<LocalModelState, 'ready'>, (model: string, endpoint: string) => string> = {
  disabled: () => 'The local model is turned off. Set MASTYF_AI_LLM_ENABLED=true and restart Mastyf.',
  'not-installed': () => 'Threat Lab needs Ollama, which is not installed on this computer. Install it from https://ollama.com/download.',
  'not-running': (_m, endpoint) => `Threat Lab needs Ollama, which is not answering at ${endpoint}. Start it with: ollama serve`,
  'model-missing': (model) => `Ollama is running but the model ${model} is not downloaded. Run: ollama pull ${model}`,
};

export async function checkLocalModel(
  deps: {
    llm?: Pick<LlmAssistant, 'isAvailable' | 'getModel' | 'getOllamaUrl'>;
    fetchImpl?: typeof fetch;
    installed?: () => boolean;
  } = {},
): Promise<LocalModelStatus> {
  const llm = deps.llm ?? new LlmAssistant();
  const model = llm.getModel();
  const endpoint = llm.getOllamaUrl();
  const no = (state: Exclude<LocalModelState, 'ready'>): LocalModelStatus => ({ ok: false, state, model, endpoint, reason: REASONS[state](model, endpoint) });
  if (!llm.isAvailable()) return no('disabled');
  try {
    const res = await (deps.fetchImpl ?? fetch)(`${endpoint}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return no('not-running');
    const body = (await res.json()) as { models?: Array<{ name?: string }> };
    const tags = (body.models ?? []).map((m) => m.name ?? '');
    return hasModel(tags, model) ? { ok: true, state: 'ready', model, endpoint } : no('model-missing');
  } catch {
    return no((deps.installed ?? ollamaInstalled)() ? 'not-running' : 'not-installed');
  }
}
