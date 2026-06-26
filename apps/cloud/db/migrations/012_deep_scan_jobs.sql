-- Deep scan async job queue (worker runs outside Vercel serverless)
CREATE TABLE IF NOT EXISTS deep_scan_jobs (
  id TEXT PRIMARY KEY,
  package_name TEXT NOT NULL,
  org_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'done', 'failed')),
  result_json JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_deep_scan_jobs_status_created
  ON deep_scan_jobs (status, created_at);

CREATE INDEX IF NOT EXISTS idx_deep_scan_jobs_package
  ON deep_scan_jobs (package_name, created_at DESC);
