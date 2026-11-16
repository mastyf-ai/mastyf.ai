// The free check service has no agentic container; every call that would use one does nothing.
export function setAgenticContainer(_c: unknown): void {}
export function getAgenticContainer(): null { return null; }
export async function ensureAgenticContainer(): Promise<null> { return null; }
export function isAgenticEnabled(): boolean { return false; }
export function isAgenticDemoMode(): boolean { return false; }

/** Marks this as the free service's stand-in (checked by the tests). */
export const __mastyfCheckStub = true;
