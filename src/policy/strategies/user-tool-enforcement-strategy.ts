import type { PolicyStrategy, SyncEvaluateContext, PolicyEngineDeps } from './types.js';
import type { PolicyDecision } from '../policy-types.js';
import { UserToolEnforcementEngine } from '../user-tool-enforcement.js';

const enforcementEngine = new UserToolEnforcementEngine();

export function getUserToolEnforcementEngine(): UserToolEnforcementEngine {
  return enforcementEngine;
}

export const userToolEnforcementStrategy: PolicyStrategy = {
  name: 'user-tool-enforcement',
  evaluate(ctx: SyncEvaluateContext, _deps: PolicyEngineDeps): PolicyDecision | null {
    return enforcementEngine.evaluate(ctx.raw);
  },
};
