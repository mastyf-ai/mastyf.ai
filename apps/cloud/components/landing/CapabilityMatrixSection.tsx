import { CAPABILITY_MATRIX } from './stats';

export function CapabilityMatrixSection() {
  return (
    <section className="lp-section" id="comparison" aria-label="Architecture Comparison">
      <div className="lp-section-header">
        <span className="lp-pill lp-pill-gold">Architectural Comparison</span>
        <h2>Why Architecture Matters: Beyond Model Guardrails</h2>
        <p>
          Competitors treat agent security as either in-band conversational moderation or post-action log auditing. Mastyf establishes an external execution boundary enforcing structural capability authorization, workflow state invariants, and continuous adversarial feedback.
        </p>
      </div>

      <div className="lp-matrix-table-wrap card">
        <table className="lp-matrix-table">
          <thead>
            <tr>
              <th scope="col" className="lp-matrix-col-feature">Security Capability</th>
              <th scope="col" className="lp-matrix-col-mastyf">
                <div className="lp-matrix-badge-mastyf">Mastyf Platform</div>
              </th>
              <th scope="col">Microsoft Agent Toolkit</th>
              <th scope="col">Noma Security</th>
              <th scope="col">Obsidian</th>
              <th scope="col">Nightfall</th>
            </tr>
          </thead>
          <tbody>
            {CAPABILITY_MATRIX.map((row, idx) => (
              <tr key={row.feature} className={idx % 2 === 0 ? 'lp-matrix-row-even' : ''}>
                <td className="lp-matrix-feature-name">{row.feature}</td>
                <td className="lp-matrix-mastyf-cell">
                  <span className="lp-matrix-check">✓</span>
                  <span>{row.mastyf}</span>
                </td>
                <td className="lp-matrix-comp-cell">{row.microsoft}</td>
                <td className="lp-matrix-comp-cell">{row.noma}</td>
                <td className="lp-matrix-comp-cell">{row.obsidian}</td>
                <td className="lp-matrix-comp-cell">{row.nightfall}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs muted text-center mt-3">
        Based on publicly documented product architectures as of 2026 (including Microsoft Agent Governance Toolkit, Noma, Obsidian Security, and Nightfall MCP Gateway).
      </p>
    </section>
  );
}
