import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { MembersPanel } from '@/components/dashboard/MembersPanel';
import { listSeats, planAllowsSeats } from '@/lib/billing/workspace-seats';
import { activeLicense, requireDashboard } from '@/lib/dashboard-data';
import { userCanManageOrg } from '@/lib/org-context';

export default async function MembersPage() {
  const { session, ctx } = await requireDashboard();
  const orgId = ctx.org.id;
  const [license, seats] = await Promise.all([activeLicense(orgId), listSeats(orgId).catch(() => null)]);
  const hasPlan = planAllowsSeats(license);

  return (
    <>
      <header className="dhead">
        <div>
          <h1>Members</h1>
          <p>Add people to this workspace. Each person joins from Shield with a code sent to their email.</p>
        </div>
      </header>

      <div className="dstack">
        {!hasPlan ? (
          <section className="panel" aria-label="Team plan needed">
            <div className="panel__body">
              <p className="panel__text">Adding people to a workspace is part of the Team plan.</p>
              <Link href="/pricing" className="btn btn-primary btn-sm">
                See plans
                <ArrowRight size={14} strokeWidth={2} aria-hidden="true" />
              </Link>
            </div>
          </section>
        ) : seats === null ? (
          <p className="notice notice--error" role="alert">
            Members could not be loaded. Try again shortly.
          </p>
        ) : (
          <MembersPanel
            seats={seats}
            maxPeople={license.maxUsers}
            canManage={userCanManageOrg(ctx.membership)}
            leadEmail={session.user.email ?? ''}
          />
        )}
      </div>
    </>
  );
}
