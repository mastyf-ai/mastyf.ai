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
export declare function ollamaInstalled(env?: NodeJS.ProcessEnv, exists?: (p: string) => boolean): boolean;
/** Ollama lists `qwen3:8b` as `qwen3:8b`, and an untagged model as `name:latest`. */
export declare function hasModel(tags: string[], model: string): boolean;
export declare function checkLocalModel(deps?: {
    llm?: Pick<LlmAssistant, 'isAvailable' | 'getModel' | 'getOllamaUrl'>;
    fetchImpl?: typeof fetch;
    installed?: () => boolean;
}): Promise<LocalModelStatus>;
//# sourceMappingURL=local-model-status.d.ts.map