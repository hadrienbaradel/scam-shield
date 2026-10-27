-- Mail safety (Codex review 2026-10-26):
-- * label-only until the person explicitly chooses "move" (consent time recorded)
-- * the intended Gmail action is written down BEFORE touching Gmail, so a
--   crash between the two is finished on the next sync instead of losing
--   track of a moved message
ALTER TABLE users ALTER COLUMN act_mode SET DEFAULT 'label';
ALTER TABLE users ADD COLUMN move_consent_at timestamptz;
UPDATE users SET act_mode = 'label' WHERE move_consent_at IS NULL AND NOT onboarded;

ALTER TABLE checks DROP CONSTRAINT checks_action_check;
ALTER TABLE checks ADD CONSTRAINT checks_action_check CHECK (action IN ('none', 'pending', 'labeled', 'moved'));
ALTER TABLE checks ADD COLUMN planned jsonb;
CREATE INDEX checks_pending_idx ON checks (user_id) WHERE action = 'pending';
