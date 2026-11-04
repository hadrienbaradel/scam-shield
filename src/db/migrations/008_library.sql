-- Public scam library (2026-11-04, _product/specs/public-database.md line 2
-- and 5): what people submit through /public/ or share from the app, held
-- here until a reviewer approves it (the entry is then served next to the
-- files of data/library/ until a script exports it) or rejects it. The
-- message is stored redacted (lib/library.js redactExample); proposed is
-- Muse Spark's classification for the reviewer to correct; verdict is the
-- app's verdict when a senior shares; submitter_hash is a hash of the
-- address a public submission came from, never the address. user_id goes
-- with the account: the senior consented per message and the published
-- entry carries nothing of hers, so the row stays, anonymous.
CREATE TABLE library_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  channel text NOT NULL,
  message jsonb NOT NULL,
  proposed jsonb,
  body_hash text NOT NULL,
  country text,
  language text,
  note text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  reason text,
  entry jsonb,
  entry_id text UNIQUE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  from_app boolean NOT NULL DEFAULT false,
  submitter_hash text,
  verdict jsonb,
  decided_at timestamptz
);
CREATE INDEX library_submissions_status_idx ON library_submissions (status, created_at DESC);
CREATE INDEX library_submissions_body_hash_idx ON library_submissions (body_hash);
