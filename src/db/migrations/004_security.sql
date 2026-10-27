-- Login CSRF (Codex review 2026-10-26): the sign-in state is bound to the
-- browser that started it (hash of a short-lived httpOnly cookie).
ALTER TABLE oauth_states ADD COLUMN browser_hash text;
