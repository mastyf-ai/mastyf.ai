// The free service loads no extensions and has no licence client: these all do nothing.
export async function loadExtensions(): Promise<void> {}
export async function startExtensions(): Promise<void> {}
export function setExtensionsForTests(_list: unknown): void {}
export function setExtensionBlockListener(_l: unknown): void {}
export function observeToolResult(_e: unknown): void {}
export function observeToolList(_s: string, _t: unknown): void {}
export function observePublishedContent(_m: string, _r: unknown): void {}
export function applyExtensionMeta(_c: unknown, _m: unknown): void {}
export function recordToolOutput(_o: unknown): void {}
export function checkToolCall(_c: unknown): null { return null; }
export function checkDataFlow(_c: unknown): null { return null; }
export function activeRequestClassifier(): null { return null; }

/** Marks this as the free service's stand-in (checked by the tests). */
export const __mastyfCheckStub = true;
