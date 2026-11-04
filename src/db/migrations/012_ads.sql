-- Ad studio (2026-11-04, _product/specs/ad-studio.md): ideas for Prudence's
-- own Facebook ads, written by Muse Spark, photographed by Muse Image,
-- approved by an admin. Nothing here is a senior's data: an ad knows only
-- what Prudence is. One row per idea; each change (the first draft, every
-- edit by prompt) is a version, so Undo is a pointer move.
CREATE TABLE ads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The landing variant's address: heyprudence.com/a/<code>.
  code text UNIQUE NOT NULL CHECK (code ~ '^[a-z0-9]{8}$'),
  status text NOT NULL DEFAULT 'drafting' CHECK (status IN
    ('drafting', 'draft', 'editing', 'publishing', 'published', 'paused', 'rejected', 'failed')),
  brief text,
  -- The current version in ad_versions (0 while the first one is drafted).
  version int NOT NULL DEFAULT 0,
  network text,
  -- As the network answered: {campaignId, adsetId, creativeId, adId, imageHash, adsManagerUrl}.
  external jsonb,
  -- Meta's review, in our words: {state, effectiveStatus, reasons, checkedAt}.
  review jsonb,
  -- What was published: {daily, currency, days, endsAt}.
  budget jsonb,
  -- The last failure in plain words; never a token.
  error text,
  rejected_reason text,
  -- Counted by GET /a/<code> (robots, previews and admins excluded).
  visits int NOT NULL DEFAULT 0,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);
CREATE INDEX ads_created_idx ON ads (created_at DESC);

CREATE TABLE ad_versions (
  ad_id uuid NOT NULL REFERENCES ads(id) ON DELETE CASCADE,
  version int NOT NULL CHECK (version >= 1),
  -- {headline, primary_text, description, cta, photo_brief, landing: {headline, lead}}
  words jsonb NOT NULL,
  photo bytea,
  photo_mime text,
  -- {pass, problems, fixed, summary, model}
  photo_check jsonb,
  -- {words, image, check}: the labels of the models that made this version.
  models jsonb,
  -- The admin's prompt that made this version (null for the first draft).
  instruction text,
  -- Images the image model returned for this version (the day's count and cost).
  photos_made int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ad_id, version)
);
CREATE INDEX ad_versions_created_idx ON ad_versions (created_at);

-- The one Prudence campaign per network, created on the first publish.
CREATE TABLE ad_campaigns (
  network text PRIMARY KEY,
  external_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Which landing variant an early-access request came from (an ads.code), if any.
ALTER TABLE early_access_requests ADD COLUMN variant text;
