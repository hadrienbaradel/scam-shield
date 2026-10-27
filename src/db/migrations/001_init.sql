-- Scam Shield schema. Privacy rule from the PRD: store verdicts and
-- features, never mail bodies. The only message text kept is what a
-- senior explicitly chose to share with a guardian (alerts.shared).

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  google_sub text UNIQUE NOT NULL,
  email text NOT NULL,
  name text,
  locale text NOT NULL DEFAULT 'en-US',
  text_scale real NOT NULL DEFAULT 1.0,
  act_mode text NOT NULL DEFAULT 'move' CHECK (act_mode IN ('label', 'move')),
  auto_alert boolean NOT NULL DEFAULT false,
  onboarded boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz
);
CREATE INDEX users_email_idx ON users (lower(email));

CREATE TABLE google_tokens (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_enc text,
  access_token_enc text,
  expires_at timestamptz,
  scopes text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'reauth_needed', 'revoked')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE gmail_state (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  email text NOT NULL,
  history_id text,
  watch_expiration timestamptz,
  label_scam text,
  label_careful text,
  backfill_done boolean NOT NULL DEFAULT false,
  sync_status text NOT NULL DEFAULT 'pending',
  sync_error text,
  last_sync_at timestamptz
);

CREATE TABLE contexts (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data jsonb NOT NULL,
  built_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gmail_message_id text,
  gmail_thread_id text,
  channel text NOT NULL DEFAULT 'email',
  sender_domain text,
  verdict jsonb NOT NULL,
  verdict_value text NOT NULL CHECK (verdict_value IN ('safe', 'be_careful', 'scam')),
  source text,
  latency_ms integer,
  action text NOT NULL DEFAULT 'none' CHECK (action IN ('none', 'labeled', 'moved')),
  restored_at timestamptz,
  user_feedback text CHECK (user_feedback IN ('not_scam', 'is_scam')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, gmail_message_id)
);
CREATE INDEX checks_user_created_idx ON checks (user_id, created_at DESC);

CREATE TABLE guardianships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  senior_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  guardian_id uuid REFERENCES users(id) ON DELETE CASCADE,
  guardian_name text NOT NULL,
  guardian_email text NOT NULL,
  relation text,
  status text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'revoked')),
  invite_hash text UNIQUE,
  invite_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz
);
CREATE INDEX guardianships_senior_idx ON guardianships (senior_id);
CREATE INDEX guardianships_guardian_idx ON guardianships (guardian_id);

CREATE TABLE alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  senior_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  guardianship_id uuid NOT NULL REFERENCES guardianships(id) ON DELETE CASCADE,
  check_id uuid REFERENCES checks(id) ON DELETE SET NULL,
  shared jsonb NOT NULL,
  answer text CHECK (answer IN ('scam', 'real', 'call_me')),
  answer_hash text UNIQUE,
  answer_expires_at timestamptz,
  answered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX alerts_senior_idx ON alerts (senior_id, created_at DESC);

CREATE TABLE pattern_cards (
  id text PRIMARY KEY,
  card jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('candidate', 'active', 'retired', 'rejected')),
  feed_item_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE feed_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  url text UNIQUE NOT NULL,
  title text NOT NULL,
  summary text,
  published_at timestamptz,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  card_id text,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'carded', 'no_card', 'error')),
  error text
);

CREATE TABLE devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text,
  token_hash text UNIQUE,
  pair_code_hash text UNIQUE,
  pair_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  revoked_at timestamptz
);

CREATE TABLE sessions (
  id_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE oauth_states (
  state_hash text PRIMARY KEY,
  verifier text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('gmail', 'basic')),
  invite text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  event text NOT NULL,
  detail jsonb,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_user_idx ON audit_log (user_id, at DESC);

-- Local development mailbox: used instead of a real email provider when
-- RESEND_API_KEY is not set. Viewable at /dev/outbox.
CREATE TABLE outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  to_email text NOT NULL,
  subject text NOT NULL,
  text_body text NOT NULL,
  html_body text,
  sent_via text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
