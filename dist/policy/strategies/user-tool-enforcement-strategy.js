import { UserToolEnforcementEngine } from '../user-tool-enforcement.js';
const enforcementEngine = new UserToolEnforcementEngine();
export function getUserToolEnforcementEngine() {
    return enforcementEngine;
}
export const userToolEnforcementStrategy = {
    name: 'user-tool-enforcement',
    evaluate(ctx, _deps) {
        return enforcementEngine.evaluate(ctx.raw);
    },
};
//# sourceMappingURL=user-tool-enforcement-strategy.js.map