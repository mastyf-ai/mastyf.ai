'use client';

import type { useProtection } from './useProtection';

type Protection = ReturnType<typeof useProtection>;

const VIA = { mastyf: 'Protected', other: 'Protected elsewhere' } as const;

/**
 * Every AI agent on this computer and its MCP servers, from /api/protection (names only). The list
 * refreshes by itself, so a server added to an agent shows up without a scan.
 */
export function AgentsCard({ protection, paid, upgradeUrl }: { protection: Protection; paid: boolean; upgradeUrl: string | null }) {
  const { status, failed, fresh } = protection;
  const blocked = new Set((status?.notProtected ?? []).map((n) => `${n.id}/${n.server}`));

  return (
    <section className="home-card agents" aria-labelledby="agents-title">
      <div className="home-card-head">
        <h2 id="agents-title" className="home-h3">Your agents</h2>
        {status && <span className="agents-count">{status.totals.servers} MCP {status.totals.servers === 1 ? 'server' : 'servers'}</span>}
      </div>

      {!status && !failed && <p className="muted">Looking for AI agents on this computer</p>}
      {!status && failed && <p className="muted">The scan did not run. Check that the Mastyf service is up.</p>}

      {status && status.agents.length === 0 && (
        <p className="muted">
          No supported agents found yet. Mastyf looks for Claude Code, Claude Desktop, Cursor, VS Code, Windsurf and Cline, and
          lists them here as soon as they appear.
        </p>
      )}

      {status && status.agents.length > 0 && (
        <ul className="agents-list">
          {status.agents.map((a) => (
            <li key={a.id} className="agents-item">
              <div className="agents-name" title={a.configPath}>{a.name}</div>
              {a.servers.length === 0 && <div className="agents-servers">No MCP servers yet</div>}
              {a.servers.map((s) => (
                <div key={s.name} className={`agents-server${fresh.has(`${a.id}/${s.name}`) ? ' fresh' : ''}`}>
                  <span>{s.name}</span>
                  <span className={`agents-state ${s.via === 'mastyf' ? 'ok' : s.via === 'other' ? 'part' : 'off'}`}>
                    {s.via
                      ? VIA[s.via]
                      : s.transport === 'http'
                        ? 'Remote, not routed'
                        : status.enabled && blocked.has(`${a.id}/${s.name}`)
                          ? 'Cannot be routed'
                          : 'Not protected'}
                  </span>
                </div>
              ))}
            </li>
          ))}
        </ul>
      )}

      {status && status.enabled && status.notProtected.length > 0 && (
        <p className="agents-note">
          Remote (URL) servers, project-level servers and servers that use agent variables stay direct. Mastyf cannot route those
          by itself.
        </p>
      )}
      {!paid && (
        <p className="agents-shield">
          In Claude Code and Cursor, Shield also checks the agent’s own shell commands and file reads.{' '}
          {upgradeUrl && <a href={upgradeUrl} target="_blank" rel="noopener noreferrer">About Shield</a>}
        </p>
      )}
      {status && <p className="agents-foot">Updated {new Date(status.lastScanAt).toLocaleTimeString()}. Only names are shown; commands and keys stay in your config files.</p>}
    </section>
  );
}
