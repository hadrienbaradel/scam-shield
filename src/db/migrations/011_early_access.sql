-- Early access (2026-11-04, _product/specs/landing-page.md line 6): one row
-- per address a visitor of the landing page asked us to protect while the
-- Google client is in its test phase, with whose it is (the visitor's
-- parent's or their own), the optional first name and note, the page's
-- language, and whether we added it as a tester. The address is stored
-- lower-cased and trimmed, once: a second request for it stores nothing.
-- Nobody is mailed from here; retention deletes a row 90 days after it was
-- marked added (src/jobs/retention.js). A visitor's request, never a
-- senior's data.
CREATE TABLE early_access_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  email text UNIQUE NOT NULL,
  whose text NOT NULL CHECK (whose IN ('parent', 'mine')),
  name text,
  note text,
  language text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'added')),
  added_at timestamptz
);
CREATE INDEX early_access_requests_created_idx ON early_access_requests (created_at DESC);
