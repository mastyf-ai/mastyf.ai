import { evaluateEncodingGuard } from '../encoding-guard.js';
import type { PolicyStrategy } from './types.js';

export const encodingGuardStrategy: PolicyStrategy = {
  name: 'encoding-guard',
  evaluate({ normalized }, deps) {
    const decision = evaluateEncodingGuard(normalized);
    if (!decision) return null;
    return { ...decision, action: deps.resolveAction(decision.action) };
  },
};
