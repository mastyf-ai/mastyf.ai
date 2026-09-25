export class ContextualBanditPolicyTuner {
    arms = new Map();
    alpha = 1.0; // UCB exploration parameter
    contextDim = 5; // [serverType hash, hour/24, agentTier hash, ruleCat hash, bias]
    constructor() {
        for (const action of ['enforce', 'relax', 'skip']) {
            const d = this.contextDim;
            const A = Array.from({ length: d }, (_, i) => Array.from({ length: d }, (_, j) => (i === j ? 1 : 0)));
            this.arms.set(action, {
                d,
                A,
                AInv: this.cloneMatrix(A),
                b: Array(d).fill(0),
                theta: Array(d).fill(0),
                pulls: 0,
            });
        }
    }
    /** Encode context into a feature vector. */
    encodeContext(ctx) {
        const serverHash = this.hashString(ctx.serverType) / 1e9;
        const tierHash = this.hashString(ctx.agentTier) / 1e9;
        const ruleHash = this.hashString(ctx.ruleCategory) / 1e9;
        return [
            serverHash,
            ctx.hourOfDay / 24,
            tierHash,
            ruleHash,
            1.0, // bias term
        ];
    }
    /** Select the best action given context. */
    selectAction(ctx) {
        const x = this.encodeContext(ctx);
        const stats = [];
        let bestAction = 'skip';
        let bestUCB = -Infinity;
        let bestReward = 0;
        for (const [action, arm] of this.arms) {
            // theta = AInv * b
            const theta = this.matVecMul(arm.AInv, arm.b);
            arm.theta = theta;
            // Predicted reward = theta^T * x
            const predictedReward = this.dot(theta, x);
            // UCB = sqrt(x^T * AInv * x)
            const xTAInv = this.matVecMul(arm.AInv, x);
            const ucbBonus = this.alpha * Math.sqrt(Math.abs(this.dot(x, xTAInv)) + 1e-6);
            const meanReward = arm.pulls > 0 ? predictedReward / Math.max(arm.pulls, 1) : 0;
            const ucbValue = predictedReward + ucbBonus;
            stats.push({ action, pulls: arm.pulls, meanReward: Math.round(predictedReward * 1000) / 1000, ucb: Math.round(ucbValue * 1000) / 1000 });
            if (ucbValue > bestUCB) {
                bestUCB = ucbValue;
                bestReward = predictedReward;
                bestAction = action;
            }
        }
        return {
            action: bestAction,
            confidence: Math.min(1, Math.max(0, bestReward)),
            expectedReward: Math.round(bestReward * 1000) / 1000,
            upperBound: Math.round(bestUCB * 1000) / 1000,
            exploration: stats.every(s => s.pulls < 5),
            armStats: stats,
        };
    }
    /** Update the bandit with a reward observation. */
    update(action, ctx, reward) {
        const arm = this.arms.get(action);
        if (!arm)
            return;
        const x = this.encodeContext(ctx);
        const d = arm.d;
        // Update A = A + x * x^T (outer product)
        for (let i = 0; i < d; i++) {
            for (let j = 0; j < d; j++) {
                arm.A[i][j] += x[i] * x[j];
            }
        }
        // Update b = b + reward * x
        for (let i = 0; i < d; i++) {
            arm.b[i] += reward * x[i];
        }
        // Update AInv using Sherman-Morrison rank-1 update
        // A_new = A + xx^T  →  AInv_new = AInv - (AInv * x * x^T * AInv) / (1 + x^T * AInv * x)
        const Ax = this.matVecMul(arm.AInv, x);
        const xTAx = this.dot(x, Ax);
        const denom = 1 + xTAx;
        for (let i = 0; i < d; i++) {
            for (let j = 0; j < d; j++) {
                arm.AInv[i][j] -= (Ax[i] * Ax[j]) / denom;
            }
        }
        arm.pulls++;
    }
    hashString(s) {
        let hash = 0;
        for (let i = 0; i < s.length; i++) {
            hash = ((hash << 5) - hash) + s.charCodeAt(i);
            hash |= 0;
        }
        return Math.abs(hash);
    }
    dot(a, b) {
        return a.reduce((s, v, i) => s + v * b[i], 0);
    }
    matVecMul(A, x) {
        return A.map(row => row.reduce((s, v, j) => s + v * x[j], 0));
    }
    cloneMatrix(m) {
        return m.map(r => [...r]);
    }
}
//# sourceMappingURL=contextual-bandit.js.map