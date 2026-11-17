// Stands in for the agentic hooks module: nothing to run in the free service.
export type AgenticToolCallContext = Record<string, unknown>;
export interface AgenticAuditParams { [key: string]: unknown }
export async function hookAgenticObservation(): Promise<void> {}
export async function hookPromptInjectionCheck(): Promise<{ blocked: boolean }> { return { blocked: false }; }
export function hookThreatMeshContribution(): void {}
export function recordAgenticAudit(): void {}
export async function runAgenticPreForwardHooks(): Promise<{ blocked: boolean }> { return { blocked: false }; }
export async function runAgenticPostCallHooks(): Promise<void> {}
export function runAgenticDeniedCallHooks(): void {}

/** Marks this as the free service's stand-in (checked by the tests). */
export const __mastyfCheckStub = true;
