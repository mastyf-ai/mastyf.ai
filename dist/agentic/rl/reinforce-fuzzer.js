const MUTATION_STRATEGIES = [
    'case_obfuscation', 'space_substitution', 'char_doubling',
    'null_byte_injection', 'url_encoding', 'unicode_homoglyph',
];
export class ReinforceFuzzerSelector {
    // Policy weights: [strategy_index][state_feature] → θ
    weights = [];
    // Track strategy performance
    strategyStats = new Map();
    // Episode tracking
    episodes = [];
    totalEpisodes = 0;
    cumulativeReward = 0;
    alpha = 0.05; // learning rate
    constructor() {
        // Initialize weights: 6 strategies × 3 features (bypass rate, recency, diversity)
        for (let i = 0; i < 6; i++) {
            this.weights[i] = [Math.random() * 0.1, Math.random() * 0.1, Math.random() * 0.1];
        }
        for (const s of MUTATION_STRATEGIES) {
            this.strategyStats.set(s, { bypassCount: 0, totalAttempts: 0, lastReward: 0 });
        }
    }
    /** Build state vector from strategy statistics. */
    buildState() {
        const states = [];
        for (const s of MUTATION_STRATEGIES) {
            const stats = this.strategyStats.get(s);
            const bypassRate = stats.totalAttempts > 0 ? stats.bypassCount / stats.totalAttempts : 0;
            states.push(bypassRate);
        }
        return states;
    }
    /** Select a mutation strategy using the current policy. */
    select() {
        const state = this.buildState();
        // Compute logits for each strategy: θ_i · state
        const logits = this.weights.map(w => w.reduce((sum, wi, j) => sum + wi * (state[j] || 0), 0));
        // Softmax to get probabilities
        const maxLogit = Math.max(...logits);
        const expSum = logits.reduce((s, l) => s + Math.exp(l - maxLogit), 0);
        const probs = logits.map(l => Math.exp(l - maxLogit) / expSum);
        // Sample from distribution
        const r = Math.random();
        let cumulative = 0;
        let selectedIdx = 0;
        for (let i = 0; i < probs.length; i++) {
            cumulative += probs[i];
            if (r <= cumulative) {
                selectedIdx = i;
                break;
            }
        }
        const selected = MUTATION_STRATEGIES[selectedIdx];
        const selectedProb = probs[selectedIdx];
        // Store for REINFORCE update
        this.episodes.push({
            strategy: selected,
            reward: 0, // will be updated by observe()
            logProb: Math.log(Math.max(selectedProb, 1e-10)),
        });
        return {
            selectedStrategy: selected,
            probability: Math.round(selectedProb * 1000) / 1000,
            strategyProbabilities: MUTATION_STRATEGIES.map((s, i) => ({
                strategy: s,
                probability: Math.round(probs[i] * 1000) / 1000,
            })),
            totalEpisodes: this.totalEpisodes,
            averageReward: this.totalEpisodes > 0 ? Math.round(this.cumulativeReward / this.totalEpisodes * 1000) / 1000 : 0,
        };
    }
    /** Observe the reward from the last selected strategy. */
    observe(reward) {
        const last = this.episodes[this.episodes.length - 1];
        if (!last)
            return;
        last.reward = reward;
        this.cumulativeReward += reward;
        this.totalEpisodes++;
        // Update strategy stats
        const stats = this.strategyStats.get(last.strategy);
        stats.totalAttempts++;
        if (reward > 0)
            stats.bypassCount++;
        stats.lastReward = reward;
        // REINFORCE update: θ ← θ + α * G * ∇ log π(a|s)
        // ∇ log π(a|s) for softmax = (1_{i=a} - π(a|s)) * s
        const state = this.buildState();
        const logits = this.weights.map(w => w.reduce((sum, wi, j) => sum + wi * (state[j] || 0), 0));
        const maxLogit = Math.max(...logits);
        const expSum = logits.reduce((s, l) => s + Math.exp(l - maxLogit), 0);
        const probs = logits.map(l => Math.exp(l - maxLogit) / expSum);
        const actionIdx = MUTATION_STRATEGIES.indexOf(last.strategy);
        for (let i = 0; i < this.weights.length; i++) {
            const indicator = i === actionIdx ? 1 : 0;
            const gradient = indicator - probs[i];
            for (let j = 0; j < this.weights[i].length; j++) {
                // REINFORCE: θ += α * G * (indicator - π) * state
                this.weights[i][j] += this.alpha * reward * gradient * (state[j] || 0);
            }
        }
        // Keep episode buffer bounded
        if (this.episodes.length > 1000)
            this.episodes = this.episodes.slice(-500);
    }
    /** Get strategy performance statistics. */
    getStats() {
        return MUTATION_STRATEGIES.map((s, i) => {
            const stats = this.strategyStats.get(s);
            return {
                strategy: s,
                attempts: stats.totalAttempts,
                bypasses: stats.bypassCount,
                bypassRate: stats.totalAttempts > 0 ? Math.round(stats.bypassCount / stats.totalAttempts * 1000) / 1000 : 0,
                weight: this.weights[i].map(w => Math.round(w * 1000) / 1000),
            };
        });
    }
}
//# sourceMappingURL=reinforce-fuzzer.js.map