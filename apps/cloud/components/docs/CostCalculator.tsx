'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Download, TriangleAlert } from 'lucide-react';

type RangeFieldProps = {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  scale: [string, string, string];
  onChange: (value: number) => void;
};

function RangeField({ id, label, value, min, max, step, display, scale, onChange }: RangeFieldProps) {
  const fraction = (value - min) / (max - min);
  return (
    <div className="range-field">
      <div className="range-field__head">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id}>{display}</output>
      </div>
      <div className="range">
        <span className="range__track" aria-hidden="true" />
        <span
          className="range__fill"
          aria-hidden="true"
          style={{ width: `calc(6px + (100% - 12px) * ${fraction})` }}
        />
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </div>
      <div className="range-field__scale" aria-hidden="true">
        {scale.map((mark) => (
          <span key={mark}>{mark}</span>
        ))}
      </div>
    </div>
  );
}

export function CostCalculator() {
  const [dailyCalls, setDailyCalls] = useState(25000);
  const [teamSize, setTeamSize] = useState(3);

  // Cloud LLM guardrail calculation: ~$0.003 per check, +850ms latency
  const monthlyCalls = dailyCalls * 30;
  const cloudLlmCost = Math.round((monthlyCalls * 0.003));
  const mastyfCost = 49 * teamSize;
  const monthlySavings = Math.max(0, cloudLlmCost - mastyfCost);

  // Latency calculation: 850 ms vs the rules' measured ~1.5 ms median
  const cloudHoursPerMonth = Math.round((monthlyCalls * 0.85) / 3600);
  const mastyfSecondsPerMonth = ((monthlyCalls * 0.0015)).toFixed(1);

  return (
    <div className="panel calc" data-reveal>
      <div className="calc__inputs">
        <RangeField
          id="daily-calls-slider"
          label="Daily agent tool calls"
          value={dailyCalls}
          min={2000}
          max={200000}
          step={2000}
          display={`${dailyCalls.toLocaleString()} / day`}
          scale={['2,000', '100,000', '200,000']}
          onChange={setDailyCalls}
        />
        <RangeField
          id="team-size-slider"
          label="Active developer seats"
          value={teamSize}
          min={1}
          max={15}
          step={1}
          display={`${teamSize} ${teamSize === 1 ? 'developer' : 'developers'}`}
          scale={['1', '8', '15']}
          onChange={setTeamSize}
        />
      </div>

      <div className="table-scroll">
        <table className="data-table calc__table">
          <thead>
            <tr>
              <th scope="col">
                <span className="sr-only">Measure</span>
              </th>
              <th scope="col">
                Cloud LLM guardrails
                <span className="calc__vendor">OpenAI, Lakera, NeMo</span>
              </th>
              <th scope="col">
                Mastyf Shield sidecar
                <span className="calc__vendor">Local policy check</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Execution latency</th>
              <td data-label="Cloud guardrails" className="tone-critical">+850 ms / call</td>
              <td data-label="Mastyf Shield" className="tone-allow">~1.5 ms rules (Protocol X ~1 s)</td>
            </tr>
            <tr>
              <th scope="row">Agent idle waiting time</th>
              <td data-label="Cloud guardrails" className="tone-critical">{cloudHoursPerMonth.toLocaleString()} hrs / month</td>
              <td data-label="Mastyf Shield" className="tone-allow">{mastyfSecondsPerMonth} sec total</td>
            </tr>
            <tr>
              <th scope="row">Data privacy</th>
              <td data-label="Cloud guardrails" className="dim">Prompts sent to 3rd party</td>
              <td data-label="Mastyf Shield" className="tone-allow">Rules run on your device; Protocol X checks and activity records go to Mastyf</td>
            </tr>
            <tr className="calc__total">
              <th scope="row">Monthly cost</th>
              <td data-label="Cloud guardrails">${cloudLlmCost.toLocaleString()} / mo</td>
              <td data-label="Mastyf Shield">${mastyfCost} / mo flat</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="calc__foot">
        <div className="calc__save">
          <span className="label">Estimated saving</span>
          <strong>${monthlySavings.toLocaleString()} / mo</strong>
        </div>
        <p className="calc__caveat">
          <TriangleAlert size={13} strokeWidth={1.75} aria-hidden="true" />
          Cloud guardrails incur high variable API costs and break fail-closed when the network connection drops.
        </p>
        <Link href="/download" className="btn btn-primary btn-sm">
          <Download size={13} strokeWidth={2} aria-hidden="true" />
          Download Mastyf Shield
        </Link>
      </div>
    </div>
  );
}
