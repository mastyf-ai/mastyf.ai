import { NextRequest, NextResponse } from 'next/server';
import { gcpProcurement } from '@/lib/gcp-procurement';
import { cloudDbAvailable, getDb } from '@/lib/db';
import { gcpMarketplaceAccounts, gcpMarketplaceEntitlements } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

/** One-line text for logs: values from Google/requests can't start a forged log line. */
function forLog(v: unknown): string {
  return String(v instanceof Error ? v.message : v).replace(/[\r\n\u2028\u2029]+/g, ' ');
}

/**
 * Google Cloud Marketplace Procurement Webhook Handler
 * Receives Pub/Sub push messages from Google Cloud Commerce (cloudcommerceprocurement.googleapis.com)
 * for customer subscription lifecycle events:
 *   - ENTITLEMENT_CREATION_REQUESTED
 *   - ENTITLEMENT_ACTIVE
 *   - ENTITLEMENT_PLAN_CHANGED
 *   - ENTITLEMENT_CANCELLED
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Pub/Sub push envelope unwrapping
    const message = body?.message;
    if (!message || !message.data) {
      return NextResponse.json({ error: 'Invalid Pub/Sub payload' }, { status: 400 });
    }

    const decodedStr = Buffer.from(message.data, 'base64').toString('utf8');
    const event = JSON.parse(decodedStr);

    const eventId = event.eventId || message.messageId;
    const eventType = event.eventType;
    const entitlementId = event.entitlement?.id || event.entitlement?.name;
    const accountId = event.account?.id || event.account?.name;
    const planId = event.entitlement?.planId || event.entitlement?.plan;

    console.log('[GCP Marketplace Webhook] Received Event:', {
      eventId,
      eventType,
      entitlementId,
      accountId,
      planId,
    });

    // 1. Sync or record in Database if DB is available
    if (cloudDbAvailable() && accountId && entitlementId) {
      try {
        const db = getDb();

        // Upsert account
        const existingAcc = await db
          .select()
          .from(gcpMarketplaceAccounts)
          .where(eq(gcpMarketplaceAccounts.id, accountId))
          .limit(1);

        if (existingAcc.length === 0) {
          await db.insert(gcpMarketplaceAccounts).values({
            id: accountId,
            state: 'ACCOUNT_ACTIVE',
            rawPayload: JSON.stringify(event.account || {}),
          });
        }

        // Upsert entitlement
        const existingEnt = await db
          .select()
          .from(gcpMarketplaceEntitlements)
          .where(eq(gcpMarketplaceEntitlements.id, entitlementId))
          .limit(1);

        if (existingEnt.length === 0) {
          await db.insert(gcpMarketplaceEntitlements).values({
            id: entitlementId,
            accountId,
            planId: planId || 'starter',
            state: eventType === 'ENTITLEMENT_ACTIVE' ? 'ENTITLEMENT_ACTIVE' : 'ENTITLEMENT_PENDING_APPROVAL',
            rawPayload: JSON.stringify(event.entitlement || {}),
          });
        }
      } catch (dbErr) {
        console.warn('[GCP Marketplace DB Warn] Could not upsert event to DB:', dbErr);
      }
    }

    // 2. Lifecycle transitions & Procurement API calls
    switch (eventType) {
      case 'ENTITLEMENT_CREATION_REQUESTED': {
        console.log(`[GCP Marketplace] Auto-approving requested entitlement: ${forLog(entitlementId)}`);
        if (entitlementId) {
          try {
            await gcpProcurement.approveEntitlement(entitlementId);
            console.log(`[GCP Marketplace] Successfully approved entitlement: ${forLog(entitlementId)}`);
          } catch (procErr: any) {
            // The id is passed as a %s argument, not built into the format string, so a "%" in it
            // can't shift the arguments.
            console.error('[GCP Marketplace] Failed to approve entitlement %s:', forLog(entitlementId), procErr);
            // Return 200 or 500 depending on retry strategy; Google Pub/Sub will retry on 500
            return NextResponse.json({ error: procErr.message }, { status: 500 });
          }
        }
        break;
      }

      case 'ENTITLEMENT_ACTIVE': {
        console.log(`[GCP Marketplace] Entitlement is active for account: ${forLog(accountId)}`);
        if (cloudDbAvailable() && entitlementId) {
          try {
            const db = getDb();
            await db
              .update(gcpMarketplaceEntitlements)
              .set({ state: 'ENTITLEMENT_ACTIVE', updatedAt: new Date() })
              .where(eq(gcpMarketplaceEntitlements.id, entitlementId));
          } catch (dbErr) {
            console.warn('[GCP Marketplace DB Warn]', dbErr);
          }
        }
        break;
      }

      case 'ENTITLEMENT_PLAN_CHANGED': {
        console.log(`[GCP Marketplace] Approving plan change to ${forLog(planId)} for entitlement: ${forLog(entitlementId)}`);
        if (entitlementId) {
          try {
            await gcpProcurement.approveEntitlement(entitlementId);
            if (cloudDbAvailable()) {
              const db = getDb();
              await db
                .update(gcpMarketplaceEntitlements)
                .set({
                  planId: planId || 'updated',
                  state: 'ENTITLEMENT_ACTIVE',
                  updatedAt: new Date(),
                })
                .where(eq(gcpMarketplaceEntitlements.id, entitlementId));
            }
          } catch (procErr: any) {
            console.error('[GCP Marketplace] Failed to approve plan change for %s:', forLog(entitlementId), procErr);
            return NextResponse.json({ error: procErr.message }, { status: 500 });
          }
        }
        break;
      }

      case 'ENTITLEMENT_CANCELLED': {
        console.log(`[GCP Marketplace] Entitlement cancelled: ${forLog(entitlementId)}`);
        if (cloudDbAvailable() && entitlementId) {
          try {
            const db = getDb();
            await db
              .update(gcpMarketplaceEntitlements)
              .set({ state: 'ENTITLEMENT_CANCELLED', updatedAt: new Date() })
              .where(eq(gcpMarketplaceEntitlements.id, entitlementId));
          } catch (dbErr) {
            console.warn('[GCP Marketplace DB Warn]', dbErr);
          }
        }
        break;
      }

      default:
        console.log(`[GCP Marketplace] Unhandled event type: ${forLog(eventType)}`);
    }

    // Acknowledge Pub/Sub message
    return NextResponse.json({ status: 'ACK', eventId }, { status: 200 });
  } catch (error: any) {
    console.error('[GCP Marketplace Webhook Error]', error);
    return NextResponse.json({ error: error.message || 'Internal webhook error' }, { status: 500 });
  }
}
