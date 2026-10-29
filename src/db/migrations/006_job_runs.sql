-- Admin console (2026-10-29): every background run is written down (which
-- job, what started it, when, how long, the result counts or the error
-- line), so the jobs page and its health survive a restart. Never message
-- content. Kept 30 days (retention).
CREATE TABLE job_runs (
  id bigserial PRIMARY KEY,
  job text NOT NULL,
  trigger text NOT NULL CHECK (trigger IN ('schedule', 'startup', 'manual')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  ok boolean,
  result jsonb,
  error text
);
CREATE INDEX job_runs_job_started_idx ON job_runs (job, started_at DESC);
