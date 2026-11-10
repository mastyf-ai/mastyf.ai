import { NextResponse } from 'next/server';
import { extractRawBearerToken } from '../api-keys';
import { leadForLicenseKey, type LeadLookup } from './workspace-seats';

/** Shared by the routes Shield calls when a lead manages their team. */

export const NO_STORE = { 'Cache-Control': 'no-store' };
export const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://www.mastyf.ai').replace(/\/$/, '');

export function fail(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

export type LeadFailure = Extract<LeadLookup, { ok: false }>['reason'];

const REFUSALS: Record<LeadFailure, [string, number]> = {
  bad_key: ['Unauthorized', 401],
  member_key: ['Only your team lead can manage members.', 403],
  not_lead: ['Only a workspace owner or admin can manage members.', 403],
  device: ['This license key is active on another device.', 403],
};

export function refuse(reason: LeadFailure) {
  const [message, status] = REFUSALS[reason];
  return fail(message, status);
}

/** The lead behind this request's license key and device. */
export async function lookUpLead(request: Request): Promise<LeadLookup> {
  const key = extractRawBearerToken(request.headers.get('authorization')) ?? '';
  if (!key.startsWith('MG-')) return { ok: false, reason: 'bad_key' };
  return leadForLicenseKey(key, request.headers.get('x-mastyf-device')?.trim() ?? '');
}
