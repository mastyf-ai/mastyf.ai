import type { BeforeToolCallHook } from './tool-call-hooks.js';
export interface ApprovalHookOptions {
    matchTools: string[];
    approvers: string[];
    timeoutSeconds: number;
    notifyChannel?: 'slack' | 'webhook' | 'stdout';
}
export declare function createApprovalHook(opts: ApprovalHookOptions): BeforeToolCallHook;
//# sourceMappingURL=approval-hook.d.ts.map