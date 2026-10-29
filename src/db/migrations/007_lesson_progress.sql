-- Micro-learning (2026-10-29): the signed-in person's lesson progress (best
-- stars per lesson, badges, days in a row) as one JSON document per person,
-- shaped by lib/lessons.js. Never message content. Deleted with the account.
CREATE TABLE lesson_progress (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  progress jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
