'use client';

import { useEffect, useState } from 'react';
import { buildMutatingHeaders, mastyfAiFetch } from '@/lib/mastyf-ai-api';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';

type Budget = {
  monthlyUsd: number | null;
  alertAtPct: number;
  source: 'dashboard' | 'env' | null;
  updatedAt: string | null;
  updatedBy: string | null;
};

/**
 * Set the monthly spend budget and the alert threshold (GET/PUT /api/cost/budget).
 * The Cost views pro-rate it to the selected period and raise an alert past the threshold.
 */
export function BudgetSettingsCard({
  canEdit,
  onSaved,
  onAction,
}: {
  canEdit: boolean;
  onSaved: () => void;
  onAction?: (msg: string) => void;
}) {
  const [budget, setBudget] = useState<Budget | null>(null);
  const [amount, setAmount] = useState('');
  const [alertAt, setAlertAt] = useState(80);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const res = await mastyfAiFetch('/api/cost/budget');
    if (!res.ok) {
      setError(`Could not read the budget (HTTP ${res.status})`);
      return;
    }
    const b = (await res.json()) as Budget;
    setBudget(b);
    setAmount(b.monthlyUsd != null ? String(b.monthlyUsd) : '');
    setAlertAt(b.alertAtPct);
  };

  useEffect(() => { void load(); }, []);

  const save = async (clear = false) => {
    setError(null);
    const monthly = clear ? null : Number(amount);
    if (!clear && !(monthly! > 0)) {
      setError('Enter a monthly budget greater than zero, in US dollars.');
      return;
    }
    setBusy(true);
    try {
      const res = await mastyfAiFetch('/api/cost/budget', {
        method: 'PUT',
        headers: await buildMutatingHeaders(),
        body: JSON.stringify({ monthlyUsd: monthly, alertAtPct: alertAt }),
      });
      const body = (await res.json().catch(() => ({}))) as Budget & { error?: string; reason?: string };
      if (!res.ok) {
        setError(body.error === 'Forbidden' ? 'Changing the budget needs the operator role.' : body.error || `HTTP ${res.status}`);
        return;
      }
      setBudget(body);
      setAmount(body.monthlyUsd != null ? String(body.monthlyUsd) : '');
      onAction?.(clear ? 'Budget removed' : 'Budget saved');
      onSaved();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Monthly budget" subtitle="Tracked against measured spend, pro-rated to the period you are viewing">
      {budget?.source === 'env' && (
        <p className="text-sm text-muted" style={{ marginTop: 0 }}>
          The current budget comes from <code>MASTYF_AI_COST_BUDGET_USD</code>. Saving here overrides it.
        </p>
      )}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label className="text-sm" style={{ display: 'grid', gap: 6 }}>
          Budget per month (USD)
          <input
            className="input"
            type="number"
            min="0.01"
            step="0.01"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={!canEdit || busy}
            style={{ width: 180 }}
          />
        </label>
        <label className="text-sm" style={{ display: 'grid', gap: 6, minWidth: 220 }}>
          Alert when spend reaches {alertAt}% of it
          <input
            type="range"
            min={10}
            max={100}
            step={5}
            value={alertAt}
            onChange={(e) => setAlertAt(Number(e.target.value))}
            disabled={!canEdit || busy}
          />
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="primary" size="sm" onClick={() => void save()} disabled={!canEdit || busy}>
            {busy ? 'Saving' : 'Save budget'}
          </Button>
          {budget?.source === 'dashboard' && (
            <Button size="sm" onClick={() => void save(true)} disabled={!canEdit || busy}>
              Remove
            </Button>
          )}
        </div>
      </div>
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
      {!canEdit && <p className="text-sm text-muted">Changing the budget needs the operator role.</p>}
      {budget?.updatedAt && budget.source === 'dashboard' && (
        <p className="text-xs text-muted">
          Last changed {new Date(budget.updatedAt).toLocaleString()}
          {budget.updatedBy ? ` by ${budget.updatedBy}` : ''}.
        </p>
      )}
      <p className="text-xs text-muted" style={{ marginBottom: 0 }}>
        A budget raises alerts in the Cost views; it does not stop tool calls. To cap usage, use the
        <code> token-budget</code> and rate-limit rules in your policy.
      </p>
    </Card>
  );
}
