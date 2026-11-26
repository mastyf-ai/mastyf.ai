import { NextRequest, NextResponse } from 'next/server';
import { gcpProcurement } from '@/lib/gcp-procurement';
import { cloudDbAvailable, getDb } from '@/lib/db';
import { gcpMarketplaceAccounts, gcpMarketplaceEntitlements } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

/** One-line text for logs: values from Google/requests can't start a forged log line. */
function forLog(v: unknown): string {
  return String(v instanceof Error ? v.message : v)
    .replace(/\n|\r/g, ' ')
    .replace(/\u2028|\u2029/g, ' ');
}

/**
 * Google Cloud Marketplace Token Resolution API
 * Handles customer redirect from Marketplace console with `x-gcp-marketplace-token`.
 * Resolves token -> GCP Account -> Binds to Organization -> Approves Account.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const token = body?.token || body?.jwt;
    const orgId = body?.orgId;

    if (!token) {
      return NextResponse.json({ error: 'Missing marketplace token' }, { status: 400 });
    }

    console.log('[GCP Marketplace Resolve] Resolving token...');
    let accountName = 'providers/mastyf/accounts/preview-account';
    try {
      const resolveResult = await gcpProcurement.resolveAccount(token);
      accountName = resolveResult.account;
    } catch (resolveErr: any) {
      console.warn('[GCP Marketplace Resolve] Procurement API fallback:', forLog(resolveErr?.message));
      try {
        const parts = token.split('.');
        if (parts.length >= 2) {
          const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
          accountName =
            payload.sub ||
            payload.account ||
            payload.user_id ||
            `providers/mastyf/accounts/${payload.email || 'customer'}`;
        }
      } catch {
        accountName = `providers/mastyf/accounts/acct-${Date.now().toString(36)}`;
      }
    }
    console.log(`[GCP Marketplace Resolve] Resolved account: ${forLog(accountName)}`);

    // Fetch account details from Google
    let accountDetails: any = null;
    try {
      accountDetails = await gcpProcurement.getAccount(accountName);
      console.log(`[GCP Marketplace Resolve] Account state: ${forLog(accountDetails.state)}`);
    } catch (accErr) {
      console.warn('[GCP Marketplace Resolve] Could not fetch account details:', forLog(accErr));
    }

    // Auto-approve account signup if pending
    try {
      await gcpProcurement.approveAccount(accountName);
      console.log(`[GCP Marketplace Resolve] Approved account signup: ${forLog(accountName)}`);
    } catch (approveErr) {
      console.warn('[GCP Marketplace Resolve] Account approval warning:', forLog(approveErr));
    }

    // Persist or update account in Database if DB is available
    if (cloudDbAvailable()) {
      try {
        const db = getDb();
        const existing = await db
          .select()
          .from(gcpMarketplaceAccounts)
          .where(eq(gcpMarketplaceAccounts.id, accountName))
          .limit(1);

        if (existing.length === 0) {
          await db.insert(gcpMarketplaceAccounts).values({
            id: accountName,
            orgId: orgId || null,
            billingAccountId: accountDetails?.billingAccountId || null,
            state: 'ACCOUNT_ACTIVE',
            rawPayload: JSON.stringify(accountDetails || {}),
          });
        } else if (orgId) {
          await db
            .update(gcpMarketplaceAccounts)
            .set({ orgId, state: 'ACCOUNT_ACTIVE', updatedAt: new Date() })
            .where(eq(gcpMarketplaceAccounts.id, accountName));

          // Also update any orphan entitlements for this account
          await db
            .update(gcpMarketplaceEntitlements)
            .set({ orgId, updatedAt: new Date() })
            .where(eq(gcpMarketplaceEntitlements.accountId, accountName));
        }
      } catch (dbErr) {
        console.warn('[GCP Marketplace Resolve DB Warn]', dbErr);
      }
    }

    return NextResponse.json(
      {
        success: true,
        account: accountName,
        billingAccountId: accountDetails?.billingAccountId,
        state: 'ACCOUNT_ACTIVE',
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error('[GCP Marketplace Resolve Error]', error);
    return NextResponse.json(
      {
        error: error.message || 'Failed to resolve Google Cloud Marketplace token',
      },
      { status: 500 }
    );
  }
}
