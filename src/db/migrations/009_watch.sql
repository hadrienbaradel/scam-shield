-- Scam watch (2026-11-04, _product/specs/public-database.md lines 8 to 10):
-- one row per item read from a public feed (a breach, a new technique or
-- something else), what the classifier made of it, whether the spec's rule
-- calls it important, the one action in both languages, and the review
-- outcome. An item is public only once a reviewer approved it; a technique
-- approved becomes a candidate pattern card (card_id). Never a senior's data.
CREATE TABLE watch_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  url text UNIQUE NOT NULL,
  title text NOT NULL,
  summary text,
  published_at timestamptz,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  kind text CHECK (kind IN ('breach', 'technique', 'other')),
  fields jsonb,
  important boolean NOT NULL DEFAULT false,
  importance_reasons jsonb,
  one_action jsonb,
  status text NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate', 'approved', 'rejected', 'error')),
  reason text,
  error text,
  card_id text,
  decided_at timestamptz
);
CREATE INDEX watch_items_status_decided_idx ON watch_items (status, decided_at DESC);
