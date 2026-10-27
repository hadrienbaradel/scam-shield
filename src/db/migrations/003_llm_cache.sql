-- Live AI checks (Codex review 2026-10-26): the same message with the same
-- context, prompt and model is never paid for twice. Keyed by a hash of the
-- exact request; deleted with the account; kept 30 days.
CREATE TABLE llm_cache (
  key text PRIMARY KEY,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  verdict jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX llm_cache_created_idx ON llm_cache (created_at);
