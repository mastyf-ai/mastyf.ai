import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { retentionDays } from '@/lib/activity/event-batch';
import { countEvents, listEvents, type StoredEvent } from '@/lib/activity/events-db';
import { listInstances, requireDashboard } from '@/lib/dashboard-data';
import { formatCount, formatDateTime, timeAgo } from '@/lib/format';

export const dynamic = 'force-dynamic';

const VERDICT_LABEL: Record<StoredEvent['verdict'], string> = {
  allow: 'Allowed',
  block: 'Blocked',
  flag: 'Flagged',
  held: 'Held',
};

const DIRECTION_LABEL: Record<StoredEvent['direction'], string> = {
  call: 'Call',
  result: 'Result',
  action: 'Agent action',
};

/** Free tier: what the `mastyf` command saw on this workspace's machines in the last 7 days. */
export default async function ActivityPage() {
  const { ctx } = await requireDashboard();
  const orgId = ctx.org.id;
  const days = retentionDays('free');
  const [instances, totals, events] = await Promise.all([
    listInstances(orgId),
    countEvents(orgId, days).catch(() => null),
    listEvents(orgId, { days, limit: 100 }).catch(() => null),
  ]);
  const online = instances.filter((i) => i.health === 'online').length;

  return (
    <>
      <header className="dhead">
        <div>
          <h1>Activity</h1>
          <p>
            Tool calls your agents made through Mastyf AI in the last {days} days, with what was decided. Arguments are
            redacted on your machine before anything is sent.
          </p>
        </div>
        <div className="dhead__actions">
          <Link href="/dashboard/settings" className="btn">
            Get a key
            <ArrowRight size={14} strokeWidth={1.75} aria-hidden="true" />
          </Link>
        </div>
      </header>

      <div className="dstack">
        <section className="panel" aria-labelledby="machines">
          <div className="panel__head">
            <h2 id="machines" className="panel__title">
              Machines
            </h2>
            <span className="panel__meta">
              {instances.length ? `${online} of ${instances.length} connected now` : 'None connected yet'}
            </span>
          </div>
          {instances.length ? (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Machine</th>
                    <th scope="col">Status</th>
                    <th scope="col" className="col-opt">
                      Version
                    </th>
                    <th scope="col" className="num">
                      Last seen
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {instances.map((i) => (
                    <tr key={i.instanceId}>
                      <td>{i.hostname || i.name || i.instanceId.slice(0, 8)}</td>
                      <td>
                        <span className={`health health--${i.health}`}>
                          {i.health === 'online' ? 'Connected' : i.health === 'delayed' ? 'Quiet' : 'Not connected'}
                        </span>
                      </td>
                      <td className="dim col-opt">{i.version || '—'}</td>
                      <td className="num dim" title={formatDateTime(i.lastHeartbeat) ?? undefined}>
                        {timeAgo(i.lastHeartbeat) ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty">
              <strong>Connect your first machine</strong>
              Create a key under Settings, then run <code>mastyf-ai connect --key &lt;your key&gt;</code> on the machine
              your agents run on. It routes their MCP servers through Mastyf AI and keeps a backup of each config;{' '}
              <code>mastyf-ai disconnect</code> undoes it.
            </div>
          )}
        </section>

        <section className="panel" aria-labelledby="totals">
          <div className="panel__head">
            <h2 id="totals" className="panel__title">
              Last {days} days
            </h2>
            <span className="panel__meta">
              {totals?.lastAt ? `Last call ${timeAgo(totals.lastAt)}` : 'No calls recorded yet'}
            </span>
          </div>
          <div className="metrics">
            <div className="metric">
              <span className="metric__label">Calls checked</span>
              <span className="metric__value">{totals ? formatCount(totals.total) : '—'}</span>
            </div>
            <div className="metric">
              <span className="metric__label">Blocked</span>
              <span className="metric__value">{totals ? formatCount(totals.blocked) : '—'}</span>
            </div>
            <div className="metric">
              <span className="metric__label">Flagged or held</span>
              <span className="metric__value">{totals ? formatCount(totals.flagged) : '—'}</span>
            </div>
          </div>
        </section>

        <section className="panel" aria-labelledby="events">
          <div className="panel__head">
            <h2 id="events" className="panel__title">
              Recent calls
            </h2>
            <span className="panel__meta">Newest first, up to 100</span>
          </div>
          {events === null ? (
            <p className="notice notice--warn">The activity records could not be read just now. Reload in a minute.</p>
          ) : events.length === 0 ? (
            <div className="empty">
              <strong>Nothing yet</strong>
              Calls appear here within a minute of your agent using a protected MCP server.
            </div>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Call</th>
                    <th scope="col">Decision</th>
                    <th scope="col" className="col-opt">
                      Why, and what it saw
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((e) => (
                    <tr key={e.id}>
                      <td className="dim" title={formatDateTime(e.occurredAt) ?? undefined}>
                        {timeAgo(e.occurredAt)}
                      </td>
                      <td>
                        <code>{e.tool}</code> on {e.server}
                        <span className="cell-sub">
                          {DIRECTION_LABEL[e.direction]}
                          {e.agent ? `, ${e.agent}` : ''}
                          {e.latencyMs != null ? `, ${formatCount(e.latencyMs)} ms` : ''}
                        </span>
                      </td>
                      <td>
                        <span className={`verdict verdict--${e.verdict}`}>{VERDICT_LABEL[e.verdict]}</span>
                      </td>
                      <td className="col-opt">
                        {e.rule || e.reason ? (
                          <span>
                            {e.rule ? <code>{e.rule}</code> : null}
                            {e.rule && e.reason ? ': ' : ''}
                            {e.reason}
                          </span>
                        ) : (
                          <span className="dim">No rule matched</span>
                        )}
                        {e.snippet ? <span className="cell-sub activity-snippet">{e.snippet}</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
