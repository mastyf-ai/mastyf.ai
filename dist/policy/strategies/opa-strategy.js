import { evaluateOpaPolicy } from '../opa-policy.js';
export const opaStrategy = {
    name: 'opa',
    async evaluateAsync(context, deps) {
        const opaEnabled = Boolean(process.env['OPA_URL']) &&
            deps.config.policy.opa !== false &&
            (deps.config.policy.opa === true || process.env['MASTYF_AI_OPA_ENABLED'] === 'true');
        if (!opaEnabled)
            return null;
        return evaluateOpaPolicy(context);
    },
};
//# sourceMappingURL=opa-strategy.js.map