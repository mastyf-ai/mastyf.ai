import { randomUUID } from 'crypto';
import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';

const MTX_VERSION = '1.0';

export type PublicCertification = {
  id: string;
  orgId: string | null;
  serverName: string;
  packageName: string;
  version: string;
  level: string;
  score: number;
  checks: unknown[];
  issuedAt: string;
  expiresAt: string;
  createdAt: string;
};

export type MtxCatalogEntry = {
  signatureHash: string;
  mtxRecord: Record<string, unknown>;
  reportCount: number;
  category: string | null;
  firstSeen: string;
  lastSeen: string;
};

export type BenchmarkScoreRow = {
  id: string;
  orgId: string | null;
  profile: string;
  packageName: string | null;
  blockRate: number;
  falsePositiveRate: number;
  p95LatencyMs: number | null;
  scorecard: Record<string, unknown>;
  guardianVersion: string | null;
  submittedAt: string;
};

function isMtxRecord(raw: unknown): raw is Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return false;
  const r = raw as Record<string, unknown>;
  return (
    r.mtxVersion === MTX_VERSION
    && typeof r.signatureHash === 'string'
    && typeof r.toolPattern === 'string'
    && typeof r.argPatternHash === 'string'
    && typeof r.category === 'string'
    && typeof r.blockReason === 'string'
    && typeof r.reportCount === 'number'
  );
}

export async function listPublicCertifications(opts?: {
  packageName?: string;
  limit?: number;
}): Promise<PublicCertification[]> {
  const limit = Math.min(opts?.limit ?? 100, 500);
  const db = getDb();
  const result = opts?.packageName
    ? await db.execute(sql`
        SELECT id, org_id, server_name, package_name, version, level, score,
               checks, issued_at, expires_at, created_at
        FROM public_mcp_certifications
        WHERE package_name = ${opts.packageName}
          AND expires_at > NOW()
        ORDER BY issued_at DESC
        LIMIT ${limit}
      `)
    : await db.execute(sql`
        SELECT id, org_id, server_name, package_name, version, level, score,
               checks, issued_at, expires_at, created_at
        FROM public_mcp_certifications
        WHERE expires_at > NOW()
        ORDER BY issued_at DESC
        LIMIT ${limit}
      `);

  return mapCertRows(result);
}

export async function submitPublicCertification(
  orgId: string | null,
  body: {
    serverName: string;
    packageName: string;
    version: string;
    level: string;
    score: number;
    attestationJws: string;
    checks?: unknown[];
    issuedAt?: string;
    expiresAt?: string;
  },
): Promise<{ id: string }> {
  const id = randomUUID();
  const issuedAt = body.issuedAt ?? new Date().toISOString();
  const expiresAt =
    body.expiresAt ?? new Date(Date.now() + 90 * 86400000).toISOString();
  const db = getDb();
  await db.execute(sql`
    INSERT INTO public_mcp_certifications (
      id, org_id, server_name, package_name, version, level, score,
      attestation_jws, checks, issued_at, expires_at
    ) VALUES (
      ${id},
      ${orgId},
      ${body.serverName},
      ${body.packageName},
      ${body.version},
      ${body.level},
      ${body.score},
      ${body.attestationJws},
      ${JSON.stringify(body.checks ?? [])}::jsonb,
      ${issuedAt}::timestamptz,
      ${expiresAt}::timestamptz
    )
  `);
  return { id };
}

export async function verifyPublicCertification(id: string): Promise<{
  found: boolean;
  valid: boolean;
  expired: boolean;
  attestationFormatOk: boolean;
  certification?: PublicCertification & { attestationPrefix: string };
}> {
  const db = getDb();
  const result = await db.execute(sql`
    SELECT id, org_id, server_name, package_name, version, level, score,
           attestation_jws, checks, issued_at, expires_at, created_at
    FROM public_mcp_certifications
    WHERE id = ${id}
    LIMIT 1
  `);
  const rows = mapCertRows(result);
  if (!rows.length) {
    return { found: false, valid: false, expired: false, attestationFormatOk: false };
  }
  const cert = rows[0]!;
  const raw = result as unknown as Array<{ attestation_jws?: string }>;
  const attestation = String(raw[0]?.attestation_jws ?? '');
  const expired = new Date(cert.expiresAt).getTime() < Date.now();
  const attestationFormatOk =
    attestation.startsWith('GUARDIAN-CERT-') || attestation.split('.').length === 3;
  const valid = !expired && attestationFormatOk && cert.score >= 0;
  return {
    found: true,
    valid,
    expired,
    attestationFormatOk,
    certification: { ...cert, attestationPrefix: attestation.slice(0, 32) },
  };
}

export async function contributeMtxRecord(
  record: Record<string, unknown>,
): Promise<{ signatureHash: string; reportCount: number }> {
  if (!isMtxRecord(record)) {
    throw new Error('invalid_mtx_record');
  }
  const hash = String(record.signatureHash);
  const category = String(record.category);
  const db = getDb();
  await db.execute(sql`
    INSERT INTO public_mtx_catalog (
      signature_hash, mtx_record, report_count, category, first_seen, last_seen
    ) VALUES (
      ${hash},
      ${JSON.stringify(record)}::jsonb,
      ${Number(record.reportCount) || 1},
      ${category},
      NOW(),
      NOW()
    )
    ON CONFLICT (signature_hash) DO UPDATE SET
      mtx_record = EXCLUDED.mtx_record,
      report_count = public_mtx_catalog.report_count + EXCLUDED.report_count,
      category = COALESCE(EXCLUDED.category, public_mtx_catalog.category),
      last_seen = NOW()
  `);
  const countResult = await db.execute(sql`
    SELECT report_count FROM public_mtx_catalog WHERE signature_hash = ${hash}
  `);
  const countRows = countResult as unknown as Array<{ report_count: number }>;
  return {
    signatureHash: hash,
    reportCount: Number(countRows[0]?.report_count ?? 1),
  };
}

export async function listMtxCatalog(limit = 100): Promise<MtxCatalogEntry[]> {
  const capped = Math.min(limit, 500);
  const db = getDb();
  const result = await db.execute(sql`
    SELECT signature_hash, mtx_record, report_count, category, first_seen, last_seen
    FROM public_mtx_catalog
    ORDER BY last_seen DESC
    LIMIT ${capped}
  `);
  const rows = result as unknown as Array<{
    signature_hash: string;
    mtx_record: Record<string, unknown>;
    report_count: number;
    category: string | null;
    first_seen: string;
    last_seen: string;
  }>;
  return rows.map((r) => ({
    signatureHash: r.signature_hash,
    mtxRecord: r.mtx_record,
    reportCount: Number(r.report_count),
    category: r.category,
    firstSeen: String(r.first_seen),
    lastSeen: String(r.last_seen),
  }));
}

export async function submitPublicBenchmark(
  orgId: string | null,
  body: {
    profile: string;
    packageName?: string;
    blockRate: number;
    falsePositiveRate: number;
    p95LatencyMs?: number;
    scorecard?: Record<string, unknown>;
    guardianVersion?: string;
  },
): Promise<{ id: string }> {
  const id = randomUUID();
  const db = getDb();
  await db.execute(sql`
    INSERT INTO public_benchmark_scores (
      id, org_id, profile, package_name, block_rate, false_positive_rate,
      p95_latency_ms, scorecard, guardian_version
    ) VALUES (
      ${id},
      ${orgId},
      ${body.profile},
      ${body.packageName ?? null},
      ${body.blockRate},
      ${body.falsePositiveRate},
      ${body.p95LatencyMs ?? null},
      ${JSON.stringify(body.scorecard ?? {})}::jsonb,
      ${body.guardianVersion ?? null}
    )
  `);
  return { id };
}

export async function listBenchmarkLeaderboard(opts?: {
  profile?: string;
  limit?: number;
}): Promise<BenchmarkScoreRow[]> {
  const limit = Math.min(opts?.limit ?? 50, 200);
  const db = getDb();
  const result = opts?.profile
    ? await db.execute(sql`
        SELECT id, org_id, profile, package_name, block_rate, false_positive_rate,
               p95_latency_ms, scorecard, guardian_version, submitted_at
        FROM public_benchmark_scores
        WHERE profile = ${opts.profile}
        ORDER BY block_rate DESC, false_positive_rate ASC
        LIMIT ${limit}
      `)
    : await db.execute(sql`
        SELECT id, org_id, profile, package_name, block_rate, false_positive_rate,
               p95_latency_ms, scorecard, guardian_version, submitted_at
        FROM public_benchmark_scores
        ORDER BY block_rate DESC, false_positive_rate ASC
        LIMIT ${limit}
      `);
  return mapBenchRows(result);
}

function mapCertRows(result: unknown): PublicCertification[] {
  const rows = result as Array<{
    id: string;
    org_id: string | null;
    server_name: string;
    package_name: string;
    version: string;
    level: string;
    score: number;
    checks: unknown;
    issued_at: string;
    expires_at: string;
    created_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    orgId: r.org_id,
    serverName: r.server_name,
    packageName: r.package_name,
    version: r.version,
    level: r.level,
    score: Number(r.score),
    checks: Array.isArray(r.checks) ? r.checks : [],
    issuedAt: String(r.issued_at),
    expiresAt: String(r.expires_at),
    createdAt: String(r.created_at),
  }));
}

function mapBenchRows(result: unknown): BenchmarkScoreRow[] {
  const rows = result as Array<{
    id: string;
    org_id: string | null;
    profile: string;
    package_name: string | null;
    block_rate: number;
    false_positive_rate: number;
    p95_latency_ms: number | null;
    scorecard: Record<string, unknown>;
    guardian_version: string | null;
    submitted_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    orgId: r.org_id,
    profile: r.profile,
    packageName: r.package_name,
    blockRate: Number(r.block_rate),
    falsePositiveRate: Number(r.false_positive_rate),
    p95LatencyMs: r.p95_latency_ms != null ? Number(r.p95_latency_ms) : null,
    scorecard: (r.scorecard as Record<string, unknown>) || {},
    guardianVersion: r.guardian_version,
    submittedAt: String(r.submitted_at),
  }));
}
