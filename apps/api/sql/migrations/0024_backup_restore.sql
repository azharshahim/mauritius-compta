-- 0024_backup_restore.sql — Mission 34
-- Operational history of encrypted backups and company exports.
-- No accounting table is modified. Archives live on disk, never in PostgreSQL,
-- and no passphrase, token or cryptographic key is ever stored here.

CREATE TABLE IF NOT EXISTS backup_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            text NOT NULL CHECK (kind IN ('global_backup', 'company_export')),
  company_id      uuid REFERENCES companies(id) ON DELETE CASCADE,
  status          text NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running', 'completed', 'verified', 'failed')),
  actor_id        uuid REFERENCES app_users(id) ON DELETE SET NULL,
  archive_name    text,
  archive_sha256  text,
  archive_bytes   bigint CHECK (archive_bytes IS NULL OR archive_bytes >= 0),
  schema_versions jsonb,
  manifest        jsonb,
  error_code      text,
  error_message   text,
  started_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  verified_at     timestamptz
);

CREATE INDEX IF NOT EXISTS backup_runs_started_idx ON backup_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS backup_runs_company_idx
  ON backup_runs (company_id, started_at DESC)
  WHERE company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS backup_runs_status_idx ON backup_runs (status);

-- A company export must name its company; a global backup must not.
ALTER TABLE backup_runs DROP CONSTRAINT IF EXISTS backup_runs_scope_check;
ALTER TABLE backup_runs ADD CONSTRAINT backup_runs_scope_check CHECK (
  (kind = 'global_backup' AND company_id IS NULL)
  OR (kind = 'company_export' AND company_id IS NOT NULL)
);
