import {
  evaluateSessionFlowGuard,
  recordSessionToolCall,
} from '../session-flow-guard.js';
import type { PolicyStrategy } from './types.js';

/** Multi-call read-then-exfil sequencing across a session. */
export const sessionFlowStrategy: PolicyStrategy = {
  name: 'session-flow',
  evaluate({ normalized }, deps) {
    const chain = evaluateSessionFlowGuard(normalized);
    if (chain) {
      return { ...chain, action: deps.resolveAction(chain.action) };
    }
    recordSessionToolCall(normalized);
    return null;
  },
};
