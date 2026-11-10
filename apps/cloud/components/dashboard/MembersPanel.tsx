'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { SeatView } from '@/lib/billing/workspace-seats';
import { formatDate } from '@/lib/format';

type Notice = { kind: 'ok' | 'error'; text: string } | null;

async function call(url: string, init: RequestInit): Promise<string | null> {
  try {
    const res = await fetch(url, init);
    if (res.ok) return null;
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return data.error || 'Something went wrong. Try again.';
  } catch {
    return 'Could not reach Mastyf. Check your connection and try again.';
  }
}

/** A Team lead's list of people: add by email, send a new code, or remove. */
export function MembersPanel({
  seats,
  maxPeople,
  canManage,
  leadEmail,
}: {
  seats: SeatView[];
  maxPeople: number;
  canManage: boolean;
  leadEmail: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const people = seats.length + 1;
  const full = maxPeople > 0 && people >= maxPeople;

  async function run(key: string, url: string, init: RequestInit, done: string) {
    setBusy(key);
    setNotice(null);
    const error = await call(url, init);
    setBusy(null);
    setNotice(error ? { kind: 'error', text: error } : { kind: 'ok', text: done });
    if (!error) router.refresh();
    return !error;
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    const address = email.trim();
    const added = await run(
      'add',
      '/api/team/members',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: address }) },
      `Added ${address}. A join code is on its way to that inbox.`,
    );
    if (added) setEmail('');
  }

  function remove(seat: SeatView) {
    if (!window.confirm(`Remove ${seat.email}? Their Shield stops working at its next license check.`)) return;
    void run(seat.id, `/api/team/members/${seat.id}`, { method: 'DELETE' }, `Removed ${seat.email}.`);
  }

  return (
    <section className="panel" aria-labelledby="people">
      <div className="panel__head">
        <h2 id="people" className="panel__title">
          People
        </h2>
        <span className="panel__meta">{maxPeople > 0 ? `${people} of ${maxPeople}` : `${people}`}</span>
      </div>

      {canManage ? (
        <div className="panel__body">
          <form className="members-add" onSubmit={add}>
            <label className="field">
              <span>Email address</span>
              <input
                className="input"
                type="email"
                required
                value={email}
                placeholder="prabhat@company.com"
                autoComplete="off"
                onChange={(e) => setEmail(e.target.value)}
                disabled={full}
              />
            </label>
            <button type="submit" className="btn btn-primary" disabled={full || busy === 'add'} aria-busy={busy === 'add'}>
              {busy === 'add' ? 'Adding…' : 'Add member'}
            </button>
          </form>
          {full ? <p className="panel__text dim">All seats are in use. Remove someone to add another person.</p> : null}
          {notice ? (
            <p className={`notice notice--${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
              {notice.text}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="panel__body panel__body--flush">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col">Status</th>
                {canManage ? (
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{leadEmail || 'You'}</td>
                <td>Team lead</td>
                {canManage ? <td /> : null}
              </tr>
              {seats.map((seat) => (
                <tr key={seat.id}>
                  <td>
                    {seat.name ?? seat.email}
                    {seat.name ? <span className="cell-sub">{seat.email}</span> : null}
                  </td>
                  <td>
                    {seat.status === 'joined' ? 'Joined' : 'Invited'}
                    <span className="cell-sub">
                      {seat.status === 'joined'
                        ? `Since ${formatDate(seat.joinedAt ?? undefined) ?? ''}`
                        : seat.codeExpiresAt
                          ? `Code valid until ${formatDate(seat.codeExpiresAt) ?? ''}`
                          : ''}
                    </span>
                  </td>
                  {canManage ? (
                    <td className="num">
                      <div className="members-actions">
                        <button
                          type="button"
                          className="btn btn-sm"
                          disabled={busy === seat.id}
                          onClick={() =>
                            void run(seat.id, `/api/team/members/${seat.id}`, { method: 'POST' }, `A new code is on its way to ${seat.email}.`)
                          }
                        >
                          Send new code
                        </button>
                        <button type="button" className="btn btn-sm" disabled={busy === seat.id} onClick={() => remove(seat)}>
                          Remove
                        </button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
