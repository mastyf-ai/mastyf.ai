export class SarsaThresholdAdapter {
    // Q-table: state hash → action → value
    qTable = new Map();
    // Per-parameter tracking
    rateLimit = 500;
    latencyLimit = 2000;
    confidenceMin = 0.7;
    epsilon = 0.15; // exploration rate, decays over time
    alpha = 0.1; // learning rate
    gamma = 0.9; // discount factor
    steps = 0;
    /** Recommend an action for a specific threshold parameter. */
    decide(parameter, state) {
        const stateKey = this.hashState(state);
        let qs = this.qTable.get(stateKey);
        if (!qs) {
            qs = { increase: 0, decrease: 0, maintain: 0 };
            this.qTable.set(stateKey, qs);
        }
        let action;
        if (Math.random() < this.epsilon) {
            // Explore: random action
            const actions = ['increase', 'decrease', 'maintain'];
            action = actions[Math.floor(Math.random() * 3)];
        }
        else {
            // Exploit: best Q
            action = qs.increase >= qs.decrease && qs.increase >= qs.maintain ? 'increase'
                : qs.decrease >= qs.maintain ? 'decrease' : 'maintain';
        }
        // Apply action
        let currentValue = 0;
        switch (parameter) {
            case 'rateLimit':
                currentValue = this.rateLimit;
                break;
            case 'latencyLimit':
                currentValue = this.latencyLimit;
                break;
            case 'confidence':
                currentValue = this.confidenceMin;
                break;
        }
        let newValue = currentValue;
        switch (action) {
            case 'increase':
                newValue = parameter === 'confidence' ? Math.min(1, currentValue * 1.1) : Math.round(currentValue * 1.1);
                break;
            case 'decrease':
                newValue = parameter === 'confidence' ? Math.max(0.1, currentValue * 0.9) : Math.round(currentValue * 0.9);
                break;
        }
        return {
            parameter,
            action,
            newValue,
            qValues: [
                { action: 'increase', value: Math.round(qs.increase * 1000) / 1000 },
                { action: 'decrease', value: Math.round(qs.decrease * 1000) / 1000 },
                { action: 'maintain', value: Math.round(qs.maintain * 1000) / 1000 },
            ],
            epsilon: Math.round(this.epsilon * 1000) / 1000,
        };
    }
    /** Learn from the outcome (SARSA update). */
    learn(parameter, state, action, reward, nextState, nextAction) {
        const stateKey = this.hashState(state);
        const nextKey = this.hashState(nextState);
        let qs = this.qTable.get(stateKey);
        if (!qs) {
            qs = { increase: 0, decrease: 0, maintain: 0 };
            this.qTable.set(stateKey, qs);
        }
        let nextQs = this.qTable.get(nextKey);
        if (!nextQs) {
            nextQs = { increase: 0, decrease: 0, maintain: 0 };
            this.qTable.set(nextKey, nextQs);
        }
        // SARSA: Q(s,a) ← Q(s,a) + α * [r + γ * Q(s',a') - Q(s,a)]
        const tdTarget = reward + this.gamma * nextQs[nextAction];
        qs[action] = qs[action] + this.alpha * (tdTarget - qs[action]);
        // Apply to parameter
        switch (parameter) {
            case 'rateLimit':
                if (action === 'increase')
                    this.rateLimit = Math.round(this.rateLimit * 1.1);
                else if (action === 'decrease')
                    this.rateLimit = Math.round(this.rateLimit * 0.9);
                break;
            case 'latencyLimit':
                if (action === 'increase')
                    this.latencyLimit = Math.round(this.latencyLimit * 1.1);
                else if (action === 'decrease')
                    this.latencyLimit = Math.round(this.latencyLimit * 0.9);
                break;
            case 'confidence':
                if (action === 'increase')
                    this.confidenceMin = Math.min(1, this.confidenceMin * 1.1);
                else if (action === 'decrease')
                    this.confidenceMin = Math.max(0.1, this.confidenceMin * 0.9);
                break;
        }
        // Decay epsilon
        this.steps++;
        this.epsilon = Math.max(0.02, 0.15 / (1 + this.steps / 500));
    }
    /** Get current threshold values. */
    getThresholds() {
        return { rateLimit: this.rateLimit, latencyLimit: this.latencyLimit, confidenceMin: Math.round(this.confidenceMin * 100) / 100 };
    }
    hashState(s) {
        const b = Math.round(s.blockRate * 10) / 10;
        const f = Math.round(s.fpRate * 10) / 10;
        const v = Math.round(s.callVolume * 10) / 10;
        return `b${b}f${f}v${v}`;
    }
}
//# sourceMappingURL=sarsa-thresholds.js.map