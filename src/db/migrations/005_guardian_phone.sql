-- Ask by text message (2026-10-28): the senior's own phone sends the
-- request, so the trusted person may have a mobile number on file.
ALTER TABLE guardianships ADD COLUMN guardian_phone text;
