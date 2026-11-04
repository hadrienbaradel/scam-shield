-- Meta glasses on Check (2026-11-04, _product/specs/check-glasses.md): what
-- the person told Prudence about a pair of Meta glasses. NULL: never asked;
-- 'none': said they have none; 'have': said they have a pair; 'ready': heard
-- the test sentence in them. Read by the Check choice, the Settings row and
-- the protection score.
ALTER TABLE users ADD COLUMN glasses text CHECK (glasses IN ('none', 'have', 'ready'));
