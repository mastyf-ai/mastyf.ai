-- Industry standard hosted registry (certifications, MTX hub, public benchmarks)

CREATE TABLE IF NOT EXISTS public_mcp_certifications (
  id TEXT PRIMARY KEY,
  org_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  server_name TEXT NOT NULL,
  package_name TEXT NOT NULL,
  version TEXT NOT NULL,
  level TEXT NOT NULL,
  score INTEGER NOT NULL,
  attestation_jws TEXT NOT NULL,
  checks JSONB NOT NULL DEFAULT '[]',
  issued_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_public_cert_package ON public_mcp_certifications(package_name, version);
CREATE INDEX IF NOT EXISTS idx_public_cert_level ON public_mcp_certifications(level, expires_at DESC);

CREATE TABLE IF NOT EXISTS public_mtx_catalog (
  signature_hash TEXT PRIMARY KEY,
  mtx_record JSONB NOT NULL,
  report_count INTEGER NOT NULL DEFAULT 1,
  category TEXT,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mtx_last_seen ON public_mtx_catalog(last_seen DESC);

CREATE TABLE IF NOT EXISTS public_benchmark_scores (
  id TEXT PRIMARY KEY,
  org_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  profile TEXT NOT NULL,
  package_name TEXT,
  block_rate REAL NOT NULL,
  false_positive_rate REAL NOT NULL,
  p95_latency_ms REAL,
  scorecard JSONB NOT NULL,
  guardian_version TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_public_bench_profile ON public_benchmark_scores(profile, block_rate DESC);
