export class ThompsonSamplingAgentTrust {
    agents = new Map();
    /** Record a tool call outcome for an agent. */
    record(agentId, outcome) {
        let s = this.agents.get(agentId);
        if (!s) {
            s = { alpha: 1, beta: 1, lastSample: 0.5 };
            this.agents.set(agentId, s);
        }
        switch (outcome) {
            case 'safe':
                s.alpha += 1;
                break;
            case 'blocked':
                s.beta += 3;
                break; // mild penalty
            case 'bypass':
                s.beta += 10;
                break; // heavy penalty
        }
        // Cap to prevent overflow
        if (s.alpha > 1000) {
            s.alpha = 500;
            s.beta = Math.round(s.beta / 2);
        }
    }
    /** Run Thompson Sampling — sample from each agent's Beta posterior. */
    sample(agentId) {
        const s = this.agents.get(agentId);
        if (!s) {
            return { agentId, sampledScore: 0.5, meanScore: 0.5, uncertainty: 1.0, tier: 'standard', exploration: true };
        }
        // Beta sampling using gamma approximation (sum of two Gamma random variables)
        const g1 = this.gammaSample(s.alpha);
        const g2 = this.gammaSample(s.beta);
        const sampled = g1 / (g1 + g2);
        const mean = s.alpha / (s.alpha + s.beta);
        const uncertainty = 1 / (s.alpha + s.beta + 1); // std dev of Beta approx
        s.lastSample = sampled;
        let tier = 'standard';
        if (mean > 0.85 && uncertainty < 0.05)
            tier = 'trusted';
        else if (mean < 0.3)
            tier = 'suspicious';
        else if (s.beta > s.alpha * 3)
            tier = 'blocked';
        return {
            agentId,
            sampledScore: Math.round(sampled * 1000) / 1000,
            meanScore: Math.round(mean * 1000) / 1000,
            uncertainty: Math.round(uncertainty * 10000) / 10000,
            tier,
            exploration: uncertainty > 0.1,
        };
    }
    /** Get the current belief about an agent (without sampling). */
    getBelief(agentId) {
        const s = this.agents.get(agentId);
        if (!s)
            return { mean: 0.5, alpha: 1, beta: 1, confidence: 0 };
        return {
            mean: Math.round(s.alpha / (s.alpha + s.beta) * 1000) / 1000,
            alpha: s.alpha,
            beta: s.beta,
            confidence: Math.min(1, (s.alpha + s.beta) / 50),
        };
    }
    /** List all agents with their current belief state. */
    getAllBeliefs() {
        return [...this.agents.entries()].map(([id, s]) => ({
            agentId: id,
            mean: Math.round(s.alpha / (s.alpha + s.beta) * 1000) / 1000,
            alpha: s.alpha, beta: s.beta,
        }));
    }
    /** Gamma sample using Marsaglia-Tsang method. */
    gammaSample(shape, scale = 1) {
        if (shape < 1) {
            // Use inverse CDF method for small shapes
            const u = Math.random();
            let x = 0.01;
            for (let i = 0; i < 100; i++) {
                const cdf = this.gammaCDF(x, shape, scale);
                if (cdf >= u)
                    return x;
                x += 0.02;
            }
            return x;
        }
        const d = shape - 1 / 3;
        const c = 1 / Math.sqrt(9 * d);
        for (;;) {
            let x, v;
            do {
                x = this.normalSample();
                v = 1 + c * x;
            } while (v <= 0);
            v = v * v * v;
            const u = Math.random();
            if (u < 1 - 0.0331 * (x * x) * (x * x))
                return d * v * scale;
            if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v)))
                return d * v * scale;
        }
    }
    /** Approximate Gamma CDF for small shapes. */
    gammaCDF(x, shape, scale) {
        let sum = 0;
        const term = x / scale;
        for (let k = 0; k < 20; k++) {
            let num = Math.pow(term, shape + k);
            for (let j = 1; j <= k; j++)
                num /= (shape + j);
            sum += num;
        }
        return Math.min(1, sum * Math.exp(-term));
    }
    /** Box-Muller normal sample. */
    normalSample() {
        let u1 = 0, u2 = 0;
        while (u1 === 0)
            u1 = Math.random();
        while (u2 === 0)
            u2 = Math.random();
        return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    }
}
//# sourceMappingURL=thompson-sampling.js.map