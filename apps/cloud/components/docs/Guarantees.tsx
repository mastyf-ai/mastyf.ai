import { GUARANTEES_AND_LIMITATIONS } from '@/components/landing/stats';

const EXECUTION_STATES = [
  {
    state: 'NOT_SENT',
    name: 'Wire isolation',
    body: 'ExecutionBytes(a) = 0. The call was rejected by CBAC, DIFC, or the Guard auditor before any socket or pipe write happened.',
  },
  {
    state: 'SENT_CHILD_NO_RESPONSE',
    name: 'Dispatched, unconfirmed',
    body: 'ExecutionBytes(a) > 0, but no verified response has arrived. ExecutionCertainty(a) = UNKNOWN, so dependent steps stay locked.',
  },
  {
    state: 'RESPONSE_RECEIVED',
    name: 'Verified',
    body: 'The response is verified and an execution receipt is generated. Only now can dependent workflow steps be authorized.',
  },
] as const;

/** What Mastyf guarantees, where those guarantees stop, and the execution states behind them. */
export function Guarantees() {
  return (
    <>
      <div className="doc-columns">
        <div>
          <h3>Guaranteed</h3>
          <p className="doc-note">Under the complete mediation axioms (A1–A6) and reference monitor integrity:</p>
          <ul className="doc-bullets doc-bullets--ok">
            {GUARANTEES_AND_LIMITATIONS.guarantees.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <div>
          <h3>Not guaranteed</h3>
          <p className="doc-note">Constraints documented in the published research:</p>
          <ul className="doc-bullets doc-bullets--warn">
            {GUARANTEES_AND_LIMITATIONS.limitations.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>

      <h3 className="doc-subhead">Execution states</h3>
      <p className="doc-note">
        How Mastyf tracks a tool call so an unconfirmed execution can never silently advance a workflow.
      </p>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">State</th>
              <th scope="col">Meaning</th>
            </tr>
          </thead>
          <tbody>
            {EXECUTION_STATES.map((row) => (
              <tr key={row.state}>
                <th scope="row">
                  <code>{row.state}</code>
                  <span className="doc-state-name">{row.name}</span>
                </th>
                <td>{row.body}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
