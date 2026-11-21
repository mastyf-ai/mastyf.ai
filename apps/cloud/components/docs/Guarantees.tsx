import { GUARANTEES_AND_LIMITATIONS } from '@/components/landing/stats';

const EXECUTION_STATES = [
  {
    state: 'NOT_SENT',
    name: 'Stopped',
    body: 'The call was blocked before anything was sent. Not one byte reached the tool.',
  },
  {
    state: 'SENT_CHILD_NO_RESPONSE',
    name: 'Sent, not confirmed',
    body: 'The call went out, but no confirmed answer has come back. Steps that depend on it stay locked.',
  },
  {
    state: 'RESPONSE_RECEIVED',
    name: 'Confirmed',
    body: 'A confirmed answer arrived and a receipt was made. Only now can steps that depend on it go ahead.',
  },
] as const;

/** What Mastyf guarantees, where those guarantees stop, and the execution states behind them. */
export function Guarantees() {
  return (
    <>
      <div className="doc-columns">
        <div>
          <h3>Guaranteed</h3>
          <p className="doc-note">As long as every call goes through Mastyf and Mastyf itself isn&rsquo;t tampered with:</p>
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
