-- Suspect contests (2026-11-04, _product/specs/public-database.md line 7):
-- one row per notice against a listing of the suspect list (a website, a
-- sender address or a phone number), with the four elements a notice
-- carries (who, how to reach them, the exact address of the listing, why
-- it is wrong) and the good-faith statement, then the reviewer's decision:
-- upheld removes the listing (the entries stay in the library), dismissed
-- keeps it; the decision text is what the person who contested reads. The
-- indicator is stored normalised (lib/suspects.js) so a lookup finds its
-- contests; a number compares on its last 9 digits. Never a senior's data.
CREATE TABLE suspect_contests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  indicator_kind text NOT NULL CHECK (indicator_kind IN ('domain', 'email', 'phone')),
  indicator text NOT NULL,
  name text NOT NULL,
  email text NOT NULL,
  url text NOT NULL,
  reason text NOT NULL,
  good_faith boolean NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'upheld', 'dismissed')),
  decision text,
  decided_at timestamptz
);
CREATE INDEX suspect_contests_status_idx ON suspect_contests (status, created_at DESC);
CREATE INDEX suspect_contests_indicator_idx ON suspect_contests (indicator_kind, indicator);
