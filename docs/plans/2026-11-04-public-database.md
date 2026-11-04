# Public database (scam library, suspect list, scam watch) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A public desktop site at `/public/` (not for seniors; another interface of heyprudence, never the senior's signed-in app) with a categorised, CC BY 4.0 library of redacted scam examples anyone can submit, an evidence-backed lookup of suspect sites, sender addresses and numbers with a contest form, and a daily watch that classifies breaches and new scam techniques for a reviewer, all served by the existing Fastify app and reviewed from the existing admin console.

**Architecture:** The repo is the database: entries live as one JSON file each under `data/library/entries/`, families and sources as JSON, loaded and validated by `lib/library.js`; approved submissions live in Postgres until a script exports them to files. Three queues (submissions, contests, watch items) are Postgres tables reviewed on `/admin/`. The watch is a scheduler job next to the threat feed, reusing its feed parser and its candidate-card path. The public site is a vanilla ES-module SPA kept on disk under `public/db/` and served at the URL prefix `/public/` (a second `@fastify/static` mount with `prefix: "/public/"`, `root: public/db`, `decorateReply: false`, registered by agent A right after the existing `fastifyStatic` line in `src/server.js`), with the admin console's router pattern, strict CSP, no build step. It has no session and shares nothing with the senior's app.

**Tech Stack:** Node >= 22.9 ESM, Fastify (`@fastify/rate-limit`, `@fastify/static`), Postgres (`src/db/pool.js`: `q`, `one`, `many`), `node --test`, the LLM layer (`lib/muse.js` `museChat`, `lib/llm/mock.js` in tests), vanilla JS/CSS. No new npm dependencies.

**Spec:** `_product/specs/public-database.md` (Behavior lines 1-10). Research: `_product/research/public-database.md`.

## Global Constraints

- Node >= 22.9 ESM; the repo style for files is a top comment saying what the module is for and why; commit messages `Area: what changed, in plain words` (`_product/docs/git.md`).
- No new npm dependencies. Never read, cat or print `.env` or `config/master.key`; never commit a key or a value.
- Tests: `make test TEST_DB_SUFFIX=<your-agent-name>` (Postgres tests skip without a database; do not let that hide a failure: run `node scripts/doctor.mjs testdb` first). Line coverage on `lib/` and `src/` must stay at or above 94%: every branch you add gets a test (`_product/docs/testing.md`).
- Tests import `./helpers/env.js` first; the model layer in tests is `process.env.LLM_PROVIDER = "mock"` with `getProvider("mock").script(...)` from `lib/llm/index.js` and `lib/llm/mock.js` (see `tests/llm.test.js`, `tests/muse.test.js`).
- Strict CSP on every page: no inline scripts, no inline styles, no external CDN; fonts and icons from `/fonts` and `/icon.svg` only (`src/server.js` helmet block).
- Every POST from a browser must carry the app's own Origin (`src/server.js` onRequest hook); `fetch` with `credentials: "same-origin"` and a JSON body is enough.
- The admin console shows counts, statuses and ids for seniors' data; submissions to the public library are the one exception: a reviewer reads the redacted message because publishing it is the point (spec line 2).
- Personal data: an entry's body never holds an IBAN, a card number, a social-security number, a one-time code or the recipient's name (`redactExample` below); sender addresses, links and phone numbers inside the scam are the evidence and stay.
- Reserved and private hosts are never indicators: TLDs `test`, `example`, `invalid`, `localhost`, `local`, `onion`, bare IPs in private ranges.
- Language: English in code, docs and commits; public pages carry English copy with the French copy only where the spec says (watch actions, family names).
- Files you may touch are listed per agent below; nothing else. Shared files have an anchor line per agent so three branches merge clean.
- Do not push. Commit on your worktree branch in small steps; the coordinator merges and pushes.
- Your worktree may lack `node_modules` and `config/master.key`: `ln -s /Users/vlad.zloteanu/wrk/pers/scam-shield/node_modules node_modules` and, only when a script needs the Muse key (agent D), `ln -s /Users/vlad.zloteanu/wrk/pers/scam-shield/config/master.key config/master.key` (both are gitignored). `npm ci` is the fallback for node_modules.

## Review Focus

1. A submission whose body holds `<script>` or HTML: stored as text, rendered escaped on `/public/` and `/admin/` (test in Task A4 and S3: `esc` on every field).
2. A submission with an IBAN, a card number, a social-security number or "code 123456": never stored unredacted (Task A4: the row's body equals `redactExample(body)`).
3. The same phone number written `+33 6 12 34 56 78`, `0612345678` and `06.12.34.56.78` resolves to one indicator (Task B1).
4. One feed down or returning broken XML: the watch run records the error for that source and still processes the others; a run where every source failed throws so the job shows Failing (Task C3).
5. A second submission of a message already in the library (same `bodyHash`) answers 409 with the existing entry id and creates no pending row (Task A4).
6. `.test` demo domains and `[someone]@domain` placeholders never appear as suspects (Task A2, B1).

---

## File structure

| Path | Owner | Responsibility |
|---|---|---|
| `data/library/families.json` | A | The 21 families (20 + `recovery`): id, name en/fr, definition en/fr, cross-references |
| `data/library/sources.json` | A, D adds rows | Sources with licence and attribution text |
| `data/library/entries/<id>.json` | A (seed), D (import) | One entry per file |
| `lib/library.js` | A | Schema, loader, validation, redaction, indicators, filters, export |
| `lib/libraryMuse.js` | A | Muse classification of an example (schema + prompt) |
| `src/library/store.js` | A | The served library: files plus approved submissions, cached; submissions queue functions |
| `src/db/migrations/008_library.sql` | A | `library_submissions` |
| `src/routes/db.js` | A | Public `/api/public/*` for about, families, library, cards, submit; `/api/library/share*` for signed-in seniors |
| `src/routes/adminDb.js` | A | `/api/admin/db/submissions*` |
| `scripts/library-seed.mjs` | A | Entries from `testcases/cases.json` |
| `tests/library.test.js`, `tests/library-api.test.js` | A | Pure and HTTP tests |
| `public/db/index.html`, `db.css`, `db.js`, `views/library.js`, `views/submit.js`, `views/about.js`, `views/suspects.js` (placeholder), `views/watch.js` (placeholder) | S | The public site |
| `public/admin/console.js` (VIEWS), `public/admin/views/library.js`, `views/contests.js` (placeholder), `views/watch.js` (placeholder) | S | Admin pages |
| `lib/watch.js`, `lib/watchMuse.js`, `src/jobs/scamwatch.js`, `src/db/migrations/009_watch.sql`, `src/routes/dbWatch.js`, `tests/watch.test.js` | C | The watch |
| `public/db/views/watch.js`, `public/admin/views/watch.js` (replace placeholders) | C, phase 2 | Watch pages |
| `lib/suspects.js`, `src/db/migrations/010_contests.sql`, `src/routes/dbSuspects.js`, `public/db/views/suspects.js`, `public/admin/views/contests.js`, `tests/suspects.test.js` | B, phase 2 | Suspect lookup and contests |
| `lib/libraryImport.js`, `scripts/library-import.mjs`, `tests/library-import.test.js`, `data/library/entries/lib-uci-*.json`, `lib-mishra-*.json` | D, phase 2 | Corpus import |
| `src/server.js`, `src/config.js`, `tests/helpers/db.js` | shared, anchored | See each task |
| Docs (`_product/spec.md`, `_product/specs/*.md`, `docs/ARCHITECTURE.md`, `_product/docs/secrets.md`, `_product/docs/dx.md`, `_product/docs/llm.md`, `README.md`, `docs/PROVENANCE.md`, `config/credentials.example`, `_product/log.md`) | coordinator, phase 3 | Agents put their doc lines in their final report, exact text |

## Shared interfaces (every agent codes against these)

### Entry (the unit of the library)

```json
{
  "id": "lib-demo-a4",
  "family": "delivery",
  "channel": "sms",
  "country": "FR",
  "language": "fr",
  "brand": "Chronopost",
  "lure": "a parcel is waiting",
  "ask": "pay a small redelivery fee on a link",
  "message": { "from": "+33 7 00 00 00 01", "subject": null, "body": "Chronopost : votre colis est en attente...", "links": [{ "text": "chronopost.fr", "href": "https://chronopost-colis.test/pay" }] },
  "first_seen": "2026-10-20",
  "last_seen": "2026-10-20",
  "source": { "id": "prudence-demo", "url": null, "licence": "CC BY 4.0", "attribution": "Prudence demo cases" },
  "verdict": { "verdict": "scam", "headline": "...", "reasons": ["...", "..."] },
  "status": "published"
}
```

- `CHANNELS = ["email", "sms", "chat", "voice", "web", "letter"]`; `family` is an id from `families.json`; `country` ISO 3166-1 alpha-2 or null; `language` ISO 639-1 or null; `verdict.verdict` in `["scam", "be_careful"]` or `verdict` null; `message.body` 20 to 10,000 characters; `source.id` from `sources.json`; dates `YYYY-MM-DD`.
- `lib/library.js` exports: `CHANNELS`, `ENTRY_SCHEMA`, `validateEntry(entry, { families, sources }) → string[]`, `loadLibraryFiles(dir = data/library) → Promise<{ families, sources, entries }>`, `redactExample(message, { recipientName = "" } = {}) → message` (IBAN, card, SSN, one-time codes and the recipient name replaced as `redactForModel` does, email addresses inside `body` and `subject` replaced by `[someone]@domain`, `from`, `links` and phone numbers kept), `bodyHash(message) → sha256 hex of body lowercased, digits and punctuation removed, whitespace collapsed`, `indicatorsOf(entry) → { domains: string[], senders: string[], phones: string[] }` (hosts of `links[].href` and of URLs found in `body`, lowercased, `www.` stripped; `senders` = `from` when it is an email address, lowercased; `phones` = `from` when it is a phone number plus phone numbers found in `body`, as digits with a leading `+` when present; reserved hosts and `[someone]@...` excluded), `filterEntries(entries, { family, channel, country, language, q }) → entries` (`q` case-insensitive on brand, lure, ask, subject, body), `exportLibrary({ families, sources, entries }) → { licence: "CC BY 4.0", generated, families, sources, entries }`.
- `families.json` item: `{ "id": "delivery", "name": { "en": "Delivery or parcel", "fr": "Colis et livraison" }, "definition": { "en": "...", "fr": "..." }, "refs": { "scamclassifier": "Business Impostor", "ic3": "Phishing/Spoofing", "ftc": "Imposter Scams › Business Imposters", "scamwatch": "impersonation-scams", "fr": "hameconnage-phishing", "nfib": "NFIB5A" } }`. Ids: `delivery, bank, government, tech-support, family-emergency, new-number, romance, investment, prize, charity, job, rental, renewal, toll-fine, utility, account, sextortion, invoice, marketplace, health, recovery`; refs from `_product/research/public-database/taxonomy.md` section 2 (null where the table says none).
- `sources.json` item: `{ "id": "prudence-demo", "name": "Prudence demo cases", "url": "https://github.com/hadrienbaradel/scam-shield", "licence": "CC BY 4.0", "attribution": "Prudence demo cases (Scam Shield), CC BY 4.0" }`.

### Public API (served by `src/routes/db.js` unless stated)

| Method and path | Answer |
|---|---|
| `GET /api/public/about` | `{ operator, contact, licence: "CC BY 4.0", repo: "https://github.com/hadrienbaradel/scam-shield", counts: { entries, families } }` |
| `GET /api/public/families` | `{ families: [ { ...family, count } ] }` |
| `GET /api/public/library?family&channel&country&language&q&page` | `{ total, page, pageSize: 50, entries }` newest `first_seen` first |
| `GET /api/public/library/:id` | `{ entry, cards: [active pattern cards whose impersonated_brands include entry.brand] }`, 404 `{ error }` |
| `GET /api/public/library.json` | `exportLibrary(...)` |
| `GET /api/public/cards` | `{ cards }` active pattern cards (`pattern_cards` status active) |
| `POST /api/public/library/submit` (rate limit 10 a minute) | body `{ channel, message: { from?, subject?, body, links? }, country?, language?, note? }`; 202 `{ id, status: "pending", statusUrl: "/api/public/library/submit/<id>" }`; 400 `{ error }` on a missing channel or a body outside 20-10,000 characters; 409 `{ error, entryId }` when `bodyHash` matches a published entry or a pending submission |
| `GET /api/public/library/submit/:id` | `{ id, status: "pending"|"approved"|"rejected"|"withdrawn", reason, entryId }` |
| `POST /api/library/share` (`requireUser`, rate limit 20 a minute) | same body as submit plus `verdict`; 202 `{ id }`; the row carries `user_id` and `from_app = true` |
| `GET /api/library/shared` (`requireUser`) | `{ count, pending, approved }` for this user |
| `POST /api/library/shared/withdraw` (`requireUser`) | `{ withdrawn }` pending rows of this user set to `withdrawn` |
| `GET /api/public/suspects?q=` (B, `src/routes/dbSuspects.js`) | lookup result below plus `{ contested: boolean, removed: boolean }` |
| `POST /api/public/suspects/contest` (B, rate limit 5 a minute) | body `{ indicator, name, email, url, reason, goodFaith: true }`; 202 `{ id }`; 400 naming the missing element |
| `GET /api/public/watch?days=7` (C, `src/routes/dbWatch.js`) | `{ items: [ { id, kind, title, url, source, published_at, fields, important, one_action: { en, fr }, decided_at } ] }` approved only, newest first |

Admin (all behind `requireUser` + `requireAdmin` like `src/routes/admin.js`): `GET /api/admin/db/submissions` → `{ submissions, counts: { pending, approved, rejected } }`; `POST /api/admin/db/submissions/:id/approve` body `{ family?, brand?, lure?, ask?, country?, language? }` → `{ entry }` (400 when the built entry fails `validateEntry`); `POST /api/admin/db/submissions/:id/reject` body `{ reason }` → `{ ok: true }`; `GET /api/admin/db/contests` → `{ contests }`; `POST /api/admin/db/contests/:id/decide` body `{ status: "upheld"|"dismissed", decision }` → `{ ok: true }`; `GET /api/admin/db/watch` → `{ items, sources, lastRun }`; `POST /api/admin/db/watch/:id/approve` body `{ one_action? }` → `{ ok: true, cardId }`; `POST /api/admin/db/watch/:id/reject` body `{ reason }`; `POST /api/admin/db/watch/run` → 202 like `/api/admin/feed/run`.

### Suspect lookup (B, `lib/suspects.js`)

`normalizeIndicator(q) → { kind: "domain"|"email"|"phone", value } | null` (email when it contains `@`; phone when, after removing spaces, dots, dashes and parentheses, it is `+?` and 7 to 15 digits, value = digits with the leading `+` kept; otherwise a domain: scheme, path, port and `www.` stripped, lowercased, punycode left as is; null when empty or a reserved host). Phones compare on their last 9 digits. `lookupSuspect(entries, q, { now = new Date(), contests = [] }) → { indicator, reports, weight, firstSeen, lastSeen, contested, removed, entries: [{ id, family, channel, country, brand, first_seen }] }` with a per-entry weight of 1 when `last_seen` is within 90 days of `now`, 0.5 within 365 days, 0.25 after, `weight` the sum rounded to 2 decimals; `contested` when a contest with status `open` matches the indicator, `removed` when one is `upheld` (then `reports` is 0 and `entries` is empty).

### Watch (C)

`lib/watch.js`: `WATCH_KINDS = ["breach", "technique", "other"]`; `breachFromHibp(b) → { kind: "breach", title: b.Title, url: "https://haveibeenpwned.com/PwnedWebsites#" + b.Name, source: "hibp", published_at: b.AddedDate, fields: { org: b.Title, domain: b.Domain, people: b.PwnCount, dataClasses: b.DataClasses, verified: b.IsVerified && !b.IsFabricated && !b.IsSpamList && !b.IsMalware && !b.IsStealerLog, breachDate: b.BreachDate, addedDate: b.AddedDate, country: null, sourceKind: "hibp" } }`; `HIGH_DATA_CLASSES = ["Passwords", "Bank account numbers", "Credit cards", "Social security numbers", "Government issued IDs", "Health insurance information", "Medical records", "Dates of birth", "Physical addresses", "Phone numbers"]`; `importanceOf(item, { countries = ["US", "FR"], now = new Date() }) → { important, reasons }` (breach: `verified` and (`people >= 1000000` or a high data class) and `addedDate` within 30 days; technique: `novelty === "new"` and (`country` null or in `countries`)); `oneActionFor(item) → { en, fr }` (breach with Passwords: change the password there and anywhere it was reused; with bank or card classes: watch the bank statements and expect calls quoting the leak; otherwise: expect emails or calls that quote this leak, they prove nothing; technique: from `fields.one_action` when the classifier gave one, else a family template). Technique `fields`: `{ channel, family, brand, lure, ask, firstSeen, novelty: "new"|"variant", country, language, one_action: { en, fr } }`.

`lib/watchMuse.js`: `CLASSIFY_WATCH_SCHEMA`, `classifyWatchItem({ title, summary, url, source, families }) → { kind, fields, one_action }` via `museChat` with the schema; throws when `!museConfigured()`.

`src/jobs/scamwatch.js`: `WATCH_SOURCES` = rows `{ id, name, url, kind: "rss"|"hibp"|"mastodon", country, licence }` (rss: `ic3-csa` https://www.ic3.gov/CSA/rss, `cisa-news` https://www.cisa.gov/news.xml, `ncsc-news` https://www.ncsc.gov.uk/api/1/services/v1/news-rss-feed.xml, `europol-news` https://www.europol.europa.eu/cms/api/rss/news, `cybermalveillance-fiches` https://www.cybermalveillance.gouv.fr/feed/atom-flux-fiches-reflexes, `krebs` https://krebsonsecurity.com/feed/, `bleepingcomputer` https://www.bleepingcomputer.com/feed/, `therecord` https://therecord.media/feed, `malwarebytes` https://www.malwarebytes.com/blog/feed/index.xml, `google-ti` https://cloudblog.withgoogle.com/topics/threat-intelligence/rss/, `which` https://www.which.co.uk/news/feed, `ransomware-live` https://www.ransomware.live/rss.xml, `hibp-latest` https://feeds.feedburner.com/HaveIBeenPwnedLatestBreaches; hibp: `hibp` https://haveibeenpwned.com/api/v3/breaches (header `user-agent: ScamShield/1.0 (scam watch)`, items with `AddedDate` within 30 days); mastodon: `mastodon-scam` https://mastodon.social/api/v1/timelines/tag/scam?limit=20 (JSON, `content` stripped of tags); the two IC3 PSA and cybermalveillance alert feeds are read by the threat feed already and are not listed). `runScamWatch({ fetchImpl = fetch, classify = museConfigured() ? classifyWatchItem : null, now = new Date() }) → { fetched, newItems, breaches, techniques, errors }`: per source fetch with a 15 s timeout, insert `watch_items` `ON CONFLICT (url) DO NOTHING`, HIBP rows filled by `breachFromHibp` without the classifier, other rows classified when `classify` is set (else `kind` null, status `candidate` so a human can still read them), `important` from `importanceOf`, `one_action` from `oneActionFor`; a source error goes to `errors` and the run continues; items from `which` whose title lacks "scam" are skipped. `watchQueue() → rows` candidates first; `approveWatchItem(id, { one_action } = {})` sets status approved, `decided_at`, and for a technique inserts a candidate `pattern_cards` row through `cardFromAlert` (id `watch-<slug>`, `sources: [source name, url]`) unless a `feed_items` row with the same url is already carded, returning `{ cardId }`; `rejectWatchItem(id, reason)`; `publicWatch({ days = 7 }) → rows` approved with `decided_at` within `days`. `scamWatchRun()` in `src/jobs/scheduler.js` mirrors `threatFeedRun` (errors noted, throws when every source failed).

### Public site contract (S)

`public/db/db.js` exports `api(path, { method, body })` (same as the admin console's, copied, not imported), `esc`, `$`, `$$`, `timeEl(iso)`, `chip(tone, word)`, `toast(text)`, `banner(err)`; `VIEWS` = `[{ path: "", label: "Library", view: library }, { path: "library", label: "Library", view: library }, { path: "suspects", label: "Suspects", view: suspects }, { path: "watch", label: "Watch", view: watch }, { path: "submit", label: "Submit", view: submit }, { path: "about", label: "About", view: about }]`; a view module exports `label` and `async render(root, params, ctx)` with `ctx = { stale(), onPage() }` exactly as `public/admin/console.js` does; routes `#/library`, `#/library/<id>`, `#/library?family=<id>`, `#/suspects?q=<indicator>`, `#/watch`, `#/submit`, `#/about`. Placeholders (`views/suspects.js`, `views/watch.js`, and the admin `views/contests.js`, `views/watch.js`) render `<p class="muted">Coming in this build.</p>` and are replaced in phase 2 by B and C.

### Shared-file anchors

- `src/server.js`: A inserts `await app.register(dbRoutes); await app.register(adminDbRoutes);` on the line after `await app.register(demoRoutes);`; C inserts `await app.register(dbWatchRoutes);` after `await app.register(messengerRoutes);`; B inserts `await app.register(dbSuspectsRoutes);` after `await app.register(lessonRoutes);`. Imports go next to the route imports in the same order (A after `demoRoutes` import, C after `messengerRoutes`, B after `lessonRoutes`).
- `src/config.js`: A adds `publicDb: { operator: env.PUBLIC_DB_OPERATOR || "Prudence (Scam Shield), Hadrien Baradel and Vlad Zloteanu", contact: env.PUBLIC_DB_CONTACT || "https://github.com/hadrienbaradel/scam-shield/issues" },` after the `adminEmails` line; C adds `bluesky: { identifier: env.BLUESKY_IDENTIFIER || "", appPassword: env.BLUESKY_APP_PASSWORD || "" },` after the `hibpKey` line (read by nothing yet: Bluesky search is a follow-up; the keys are declared so the docs can name them).
- `tests/helpers/db.js` `resetDb`: A adds `library_submissions` at the end of the `TRUNCATE` list; C adds a line `await pool.query("TRUNCATE watch_items");` after `await pool.query("DELETE FROM pattern_cards");`; B adds `await pool.query("TRUNCATE suspect_contests");` before the final `await migrate();`.
- `src/jobs/scheduler.js`: C only (import, `scamWatchRun`, one `job({...})` after the `threatfeed` entry).
- `public/admin/console.js`: S only (three imports after `outbox`, three VIEWS rows after `outbox`).

---

## Phase 1 (parallel): A, S, C

### Agent A: library data, API and seed

**Files:** create `data/library/families.json`, `data/library/sources.json`, `data/library/entries/*.json` (seed), `lib/library.js`, `lib/libraryMuse.js`, `src/library/store.js`, `src/db/migrations/008_library.sql`, `src/routes/db.js`, `src/routes/adminDb.js`, `scripts/library-seed.mjs`, `tests/library.test.js`, `tests/library-api.test.js`; modify `src/server.js`, `src/config.js`, `tests/helpers/db.js` at the anchors.

#### Task A1: families, sources, schema and validation

- [ ] Write `tests/library.test.js` with `test("the 21 families carry both names, both definitions and their references")` (loads `families.json`: 21 ids in the listed order, every `name.en/fr` and `definition.en/fr` non-empty, `refs` has the six keys), `test("validateEntry accepts the example entry and names what is wrong")` (the example above passes; missing `family` → `missing family`; unknown family `x` → `unknown family x`; channel `fax` → an error; body of 5 characters → an error; `source.id` unknown → an error; a body with `FR76 3000 6000 0112 3456 7890 189` → `body carries personal data`).
- [ ] Run `node --test tests/library.test.js`: fails (module missing).
- [ ] Write `data/library/families.json` from `_product/research/public-database/taxonomy.md` (definitions in plain words a reviewer understands, one sentence each, French included) and `data/library/sources.json` with `prudence-demo`.
- [ ] Implement `CHANNELS`, `ENTRY_SCHEMA` (JSON schema in the `lib/schema.js` style, checked with `schemaErrors`), `validateEntry`, `redactExample`, `bodyHash` in `lib/library.js`. `validateEntry` adds `body carries personal data` when `redactExample(message).body !== message.body` or `redactExample(message).subject !== message.subject`.
- [ ] Run the tests: pass. Commit `Library: families, sources and the entry schema`.

#### Task A2: redaction, indicators, filters, export, loader

- [ ] Add tests: `redactExample` keeps `from`, `links` and a phone number in the body, replaces the IBAN, a card number, `code 123456`, `Françoise` (given as `recipientName`) by `[name]`, and `linda@gmail.com` in the body by `[someone]@gmail.com`; `indicatorsOf` on the example gives `domains: ["chronopost-colis.test"]`... no: `.test` is reserved, so `domains: []`, `phones: ["+33700000001"]`; on an email entry with `from: "service@contestation-bouygues.example"` gives `senders: []` (reserved) and with `from: "alerts@secure-chase-login.com"` gives `senders: ["alerts@secure-chase-login.com"]`, `domains` includes `secure-chase-login.com` from a bare `https://secure-chase-login.com/verify` in the body; `bodyHash` equal for `"Pay $1.99 now!"` and `"pay 1 99 NOW"`; `filterEntries` by family, channel, country, language and `q` on brand; `exportLibrary` carries `licence: "CC BY 4.0"`; `loadLibraryFiles` reads a temp dir with one entry and validates it (an invalid file makes it throw naming the file).
- [ ] Run: fail. Implement. Run: pass. Commit `Library: redaction, indicators, filters and the loader`.

#### Task A3: migration, store and seed

- [ ] `src/db/migrations/008_library.sql`: `library_submissions (id uuid PK default gen_random_uuid(), created_at timestamptz default now(), channel text NOT NULL, message jsonb NOT NULL, proposed jsonb, body_hash text NOT NULL, country text, language text, note text, status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','withdrawn')), reason text, entry jsonb, entry_id text UNIQUE, user_id uuid, from_app boolean NOT NULL DEFAULT false, submitter_hash text, decided_at timestamptz)` with an index on `(status, created_at DESC)` and one on `body_hash`. Add `library_submissions` to `resetDb`.
- [ ] `src/library/store.js`: `getLibrary({ reload = false }) → { families, sources, entries }` (files via `loadLibraryFiles` once per process plus approved rows' `entry`, cache refreshed when `approve` runs or after 60 s), `submit({ channel, message, country, language, note, userId, fromApp, submitterHash, classify })` (redacts, computes `body_hash`, 409-style result `{ duplicate: entryId }` when a published entry or a pending row matches, otherwise classifies when `classify` is given and stores `proposed`, returns the row), `submissionStatus(id)`, `listSubmissions()`, `approveSubmission(id, overrides)` (builds the entry: id `lib-<yyyymmdd>-<6 hex>`, `first_seen`/`last_seen` today, `source` `prudence-submissions`, `status` published; validates; stores `entry`, `entry_id`, `status`, `decided_at`), `rejectSubmission(id, reason)`, `sharedCounts(userId)`, `withdrawShared(userId)`. Add the `prudence-submissions` source to `sources.json`.
- [ ] `lib/libraryMuse.js`: `CLASSIFY_SCHEMA` and `classifyExample({ channel, message, families })` (system prompt: classify a scam example into one family id from the list given with its definitions, name the impersonated brand or null, the lure and the ask in one short line each, the language and the country when the text shows them; answer JSON only).
- [ ] `scripts/library-seed.mjs`: reads `testcases/cases.json`, keeps `expected` scam or be_careful, maps each case to a family with the table below (correct a row only when the message text clearly says otherwise and say so in your report), builds the message (`channel`: `screenshot` → `web`, `voice_transcript` → `voice`, `whatsapp` → `chat`; `from`, `subject`, `body`, `links`), country and language from the profile (`francoise` FR/fr, `linda` US/en), `brand` from `claimedBrand`, `lure` and `ask` written by you in one line each, `first_seen`/`last_seen` `2026-10-27`, `verdict` from the expected verdict with a one-line headline, redacts with the profile's `userName`, validates, writes `data/library/entries/lib-demo-<id lowercase>.json`. Run it, commit the files. Table: A1 utility, A2 bank, A3 utility, A3b utility, A4 delivery, D1 delivery, D2 toll-fine, D3 government, D4 bank, D5 government, D6 tech-support, D7 renewal, D8 bank, B6 sextortion, B7 family-emergency, B8 health, B9 tech-support, B10 new-number, B11 recovery, B12 romance, B1 family-emergency, B2 new-number, B13 romance, B14 investment, C8 bank, C9 toll-fine, C10 account, A6 bank, A7 bank, A8 job, A9 sextortion.
- [ ] Tests: `test("the seed entries validate and cover the non-safe cases")` (count = number of cases with expected != safe, every file validates, every family in the table appears); `test("submit stores a redacted body and refuses a duplicate")` and `test("approve builds a valid entry and reject keeps the reason")` in `tests/library-api.test.js` against Postgres (skip without it, as `tests/integration.test.js` does).
- [ ] Commit `Library: submissions store, Muse classification and the 28 seed entries`.

#### Task A4: routes

- [ ] `src/routes/db.js` and `src/routes/adminDb.js` per the API table (rate limits via route `config.rateLimit`, like `src/routes/demo.js`); `submitterHash = sha256(request.ip)`; `classify` passed only when `museConfigured()`; `GET /api/public/cards` reads `pattern_cards` where status active.
- [ ] Register at the anchors in `src/server.js` (the two route plugins after `demoRoutes`, and the `/public/` static mount right after the existing `fastifyStatic` registration: `await app.register(fastifyStatic, { root: join(publicDir, "db"), prefix: "/public/", decorateReply: false, index: ["index.html"] });`); add `publicDb` to `src/config.js`. Test: `GET /public/` answers 200 with the site's HTML, `GET /public/db.js` 200.
- [ ] Tests in `tests/library-api.test.js` with `buildApp({ logger: false })` and `inject`: about and families answer; list filters and pages; detail 404; export has the licence; submit 202 then status pending; submit with a 5-character body 400; the same body twice → 409 with `entryId`; a body with `<script>alert(1)</script>` is stored as text (row's body contains the literal text, no HTML interpretation is the page's job); a body with an IBAN is stored redacted; `POST /api/library/share` without a session → 401/403; with a session (`makeUser` + `sessionFor`) → 202 and `GET /api/library/shared` counts 1, `withdraw` → 1 and the status reads `withdrawn`; admin list and approve/reject behind `requireAdmin` (admin = `admin@example.test` per `tests/helpers/env.js`; a non-admin gets 403); mock Muse classification used when `LLM_PROVIDER=mock` is set and scripted with a JSON answer, `proposed.family` stored.
- [ ] Run `make test TEST_DB_SUFFIX=agent_a`: green. Commit `Library: public API, submissions and the senior's share endpoints`.

**Report:** which cases you remapped, the doc lines (spec Behavior as built, README script table row for `library-seed`, `dx.md` row, `llm.md` line for the classification prompt, `secrets.md` lines for `PUBLIC_DB_OPERATOR` and `PUBLIC_DB_CONTACT`, `credentials.example` lines, `PROVENANCE.md` line), and anything you left out.

### Agent S: the public site and the admin pages

**Files:** create `public/db/index.html`, `public/db/db.css`, `public/db/db.js`, `public/db/views/library.js`, `views/submit.js`, `views/about.js`, `views/suspects.js` (placeholder), `views/watch.js` (placeholder); `public/admin/views/library.js`, `public/admin/views/contests.js` (placeholder), `public/admin/views/watch.js` (placeholder); modify `public/admin/console.js` (imports and VIEWS only).

- [ ] Task S1: shell. `index.html` (desktop-first, works down to 360 px, light and dark via `prefers-color-scheme` with `data-theme` overrides, `<title>Prudence scam database</title>`, a header with the name, the nav, a search box that routes to `#/suspects?q=`, every internal link relative to `/public/` (`href="#/library"`, assets as `db.css`, `db.js`, `views/...` relative paths, never `/db/...`), and a footer "CC BY 4.0 · operator and contact on About"), `db.css` (its own look: dense, readable, system fonts, tables with sticky headers, chips for family, channel and country, a two-column layout for the entry page; nothing imported from `/styles.css` or `/admin/console.css`), `db.js` (router and helpers per the contract). Placeholders for suspects and watch.
- [ ] Task S2: library view. `#/library`: a family rail (from `/api/public/families`, each with its count, the selected one highlighted), filters (channel, country, language, free text), the table (first seen, family, channel, country, brand, lure, the ask; a row opens `#/library/<id>`), paging. `#/library/<id>`: the entry page: the redacted message in a monospace block with links shown as text (never clickable: `href` printed, not linked), the family definition, the verdict with its reasons, the source and licence line with attribution, the related cards from the answer, "Look up" buttons for each indicator (sender, domains, phones) that route to `#/suspects?q=`, and a "Download the whole library (JSON)" link to `/api/public/library.json`. Every field through `esc`.
- [ ] Task S3: submit view. A form: channel (select), from, subject, body (textarea, 20 to 10,000 characters, counter), country, language, a note, and the line "Remove your own name and details before sending; the scam's links, numbers and sender stay: they are the evidence. What you send is redacted again, classified and read by a reviewer before it appears. Published under CC BY 4.0." On 202 show the status URL; on 409 link the existing entry; on 400 show the error. A "Check status" box that reads `/api/public/library/submit/<id>`.
- [ ] Task S4: about view. Operator, contact, licence, repo, counts (from `/api/public/about`), the three-paragraph description (what the library is, what the suspect list promises and does not, how the watch is reviewed), the removal and contest paths in one paragraph each, and the sources table from `/api/public/library.json` (`sources`).
- [ ] Task S5: admin page `views/library.js`: the submissions queue (pending first): created, channel, country, from-app flag, the proposed family, brand, lure, ask (editable selects and inputs, families from `/api/public/families`), the redacted message, Approve (sends the edited fields) and Reject (asks a reason) with `busy`/`toast` like `views/cards.js`; counts chips at the top. Register the three admin views in `console.js`.
- [ ] Check in a browser or with a headless pass that every page renders without console errors against a server running agent A's branch when available, else against mocked JSON (`fetch` stub in the devtools console is fine); keep screenshots out of the repo. Commit per task (`Public site: shell and router`, `Public site: library pages`, ...).

**Report:** the pages and routes built, what you could not check live, and doc lines (spec Behavior lines 1, 2, 4 as built; `admin-console.md` lines for the three new pages).

### Agent C: the watch (backend)

**Files:** create `lib/watch.js`, `lib/watchMuse.js`, `src/jobs/scamwatch.js`, `src/db/migrations/009_watch.sql`, `src/routes/dbWatch.js`, `tests/watch.test.js`; modify `src/jobs/scheduler.js`, `src/server.js`, `src/config.js`, `tests/helpers/db.js` at the anchors.

- [ ] Task C1: pure logic. Tests: `breachFromHibp` on a fixture with `IsVerified: true, PwnCount: 2500000, DataClasses: ["Email addresses", "Passwords"]` gives `verified: true, people: 2500000`; `IsSpamList: true` → `verified: false`; `importanceOf`: that breach added 3 days ago → important with reasons naming the count and `Passwords`; the same with `people: 1000` and `DataClasses: ["Email addresses"]` → not important; a breach added 45 days ago → not important; a technique `novelty: "new", country: "FR"` → important; `novelty: "variant"` → not; `country: "DE"` → not; `oneActionFor` gives both `en` and `fr` for a Passwords breach and for a technique without `one_action`. Implement `lib/watch.js`. Commit `Scam watch: breach fields, importance and the one action`.
- [ ] Task C2: migration `009_watch.sql`: `watch_items (id uuid PK default gen_random_uuid(), source text NOT NULL, url text UNIQUE NOT NULL, title text NOT NULL, summary text, published_at timestamptz, fetched_at timestamptz NOT NULL DEFAULT now(), kind text CHECK (kind IN ('breach','technique','other')), fields jsonb, important boolean NOT NULL DEFAULT false, importance_reasons jsonb, one_action jsonb, status text NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate','approved','rejected','error')), reason text, error text, card_id text, decided_at timestamptz)` with an index on `(status, decided_at DESC)`; `resetDb` anchor line.
- [ ] Task C3: the job. Tests (Postgres, `fetchImpl` injected, `classify` injected): a run over a fixture RSS (reuse `parseFeed` from `src/jobs/threatfeed.js`) and a fixture HIBP JSON inserts rows once (a second run adds 0 `newItems`), HIBP rows have `kind: "breach"` without calling `classify`, a feed answering 500 is listed in `errors` while the others proceed, every source failing makes `scamWatchRun` throw, `which` items without "scam" in the title are skipped, a Mastodon fixture (`[{ url, content: "<p>New <b>scam</b>...</p>", created_at }]`) yields a row whose summary has no tags, `approveWatchItem` on a technique inserts a candidate card `watch-<slug>` and returns its id, on a breach returns `cardId: null`, and skips the card when a `feed_items` row with that url is already carded; `rejectWatchItem` keeps the reason; `publicWatch({ days: 7 })` lists approved rows only. Implement `src/jobs/scamwatch.js`, `lib/watchMuse.js` (tested with the mock provider: a scripted JSON answer becomes `fields`), the scheduler job and `scamWatchRun`. Commit `Scam watch: the daily job over fifteen feeds and HIBP, with review`.
- [ ] Task C4: routes `src/routes/dbWatch.js`: public `GET /api/public/watch` and the four admin endpoints (admin group with the two preHandlers, `run` through `runJob("scamwatch", "manual")` like `/api/admin/feed/run`). Tests with `inject`: public answers approved items only; admin endpoints 403 for a non-admin; approve returns `cardId`. Register at the anchor; add `bluesky` to config. `make test TEST_DB_SUFFIX=agent_c` green. Commit `Scam watch: public feed and the review endpoints`.

**Report:** the sources that answered in a real run if you tried one (`node --import ./lib/credentials.js -e` is not needed; a plain `node -e "import('./src/jobs/scamwatch.js').then(m => m.runScamWatch({ classify: null }))"` against your test database is enough), doc lines (spec lines 8-10 as built, `admin-console.md` line 4 job list, `threat-feed.md` relationship line, `secrets.md` and `credentials.example` lines for `BLUESKY_IDENTIFIER` and `BLUESKY_APP_PASSWORD`, `llm.md` line).

## Phase 2 (parallel, after phase 1 is merged): B, C2, D

### Agent B: suspects

**Files:** create `lib/suspects.js`, `src/db/migrations/010_contests.sql`, `src/routes/dbSuspects.js`, `tests/suspects.test.js`; replace `public/db/views/suspects.js`, `public/admin/views/contests.js`; modify `src/server.js`, `tests/helpers/db.js` at the anchors.

- [ ] Task B1: `lib/suspects.js` with tests: `normalizeIndicator` on `"https://www.Secure-Chase-Login.com/verify?x=1"` → domain `secure-chase-login.com`; `"Alerts@Secure-Chase-Login.com"` → email lowercased; `"+33 6 12 34 56 78"`, `"0612345678"`, `"06.12.34.56.78"` → phone values that `lookupSuspect` treats as one (last 9 digits); `"contestation-bouygues.test"` → null; `""` → null. `lookupSuspect` over three entries (two with the same sender, `last_seen` 10 days and 200 days ago, one unrelated) → `reports: 2, weight: 1.5`, `firstSeen`/`lastSeen` right, `entries` of 2; with an open contest → `contested: true`; with an upheld one → `removed: true, reports: 0`.
- [ ] Task B2: migration `010_contests.sql`: `suspect_contests (id uuid PK default gen_random_uuid(), created_at timestamptz default now(), indicator_kind text NOT NULL, indicator text NOT NULL, name text NOT NULL, email text NOT NULL, url text NOT NULL, reason text NOT NULL, good_faith boolean NOT NULL, status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','upheld','dismissed')), decision text, decided_at timestamptz)`; `resetDb` anchor. Routes per the API table: `GET /api/public/suspects?q=` (entries from `getLibrary()`, contests from the table), `POST /api/public/suspects/contest` (400 names the missing element: "name", "email", "url", "reason" or "the good-faith statement"), admin list and decide. Tests with `inject`.
- [ ] Task B3: pages. `public/db/views/suspects.js`: the search box, the result card ("Reported N times, last seen <date>, weight W", "contested" or "removed after a contest on <date>" when so, the entries table linking to `#/library/<id>`), the empty state ("Nothing reported for this. A listing never says scam without an entry behind it."), and the contest form (the four elements plus the good-faith checkbox, the promise "a decision with its reason within 7 days", the operator line from `/api/public/about`). `public/admin/views/contests.js`: open contests first, Uphold/Dismiss with a decision text. Commit per task.

**Report:** doc lines (spec lines 6-7 as built, `admin-console.md` page line).

### Agent C2 (the phase-1 watch agent, continued): watch pages

- [ ] Replace `public/db/views/watch.js`: this week's approved items in two sections (Breaches, New techniques), each item with its kind chip, title linking to the source url (external links here are fine: they are news sources, `rel="noopener"`), source and date, the fields in plain words (people affected, data leaked, verified or claimed; channel, family, brand, lure, ask), the one action in English with the French line under it, and an "Important" chip when so. Replace `public/admin/views/watch.js`: candidates first, the classification shown, editable one-action fields, Approve/Reject, "Fetch now" calling `/api/admin/db/watch/run`, the sources list with the last run. Commit `Scam watch: public page and the review page`.

### Agent D: corpus import

**Files:** create `lib/libraryImport.js`, `scripts/library-import.mjs`, `tests/library-import.test.js`, `data/library/entries/lib-uci-*.json`, `lib-mishra-*.json`; modify `data/library/sources.json` (two rows).

- [ ] Task D1: `lib/libraryImport.js`: `parseUciSms(text) → [{ label, body }]` (tab-separated `ham|spam<TAB>text`), `parseMishraSoni(csv) → [{ label, body }]` (CSV with a `LABEL` column `ham|spam|smishing` and a `TEXT` column; handle quoted fields), `pickSamples(rows, { limit, existingHashes, seed = 1 }) → rows` (spam or smishing only, deduped by `bodyHash`, deterministic shuffle), `entryFromSample(sample, { id, source, classification, firstSeen })`. Tests on three-line fixtures.
- [ ] Task D2: `scripts/library-import.mjs --source uci-sms|mishra-soni --limit 100 [--dry]`: downloads into `.runtime/library/<source>/` (UCI: https://archive.ics.uci.edu/static/public/228/sms+spam+collection.zip, unzip with `node:zlib` is not enough for zip: use `unzip` from the shell; Mishra-Soni: the Mendeley record https://data.mendeley.com/datasets/f45bkkt8pr/1, download the file from its "Download" link; if the direct link needs a browser, say so and import UCI only), parses, picks, classifies each sample with `classifyExample` (Muse, `node --import ./lib/credentials.js`; `--family <id>` skips the model), redacts, validates, writes `lib-uci-<n>.json` / `lib-mishra-<n>.json` with `source` rows `uci-sms` (UCI SMS Spam Collection, CC BY 4.0, Almeida and Hidalgo 2011) and `mishra-soni` (SMS Phishing Dataset for Machine Learning and Pattern Recognition, Mendeley f45bkkt8pr, CC BY 4.0), `first_seen` the dataset's year (2011, 2022), `country` null, `language` en, `verdict` null. Run it for 100 UCI samples and up to 100 Mishra-Soni samples; look at ten entries by eye for leftover personal data; commit the entries. The raw files stay under `.runtime/` (gitignored).

**Report:** counts imported per source and per family, the ten you checked, doc lines (`PROVENANCE.md` rows, README script table row, `dx.md` row).

## Phase 3 (coordinator)

- [ ] Merge the branches in order A, S, C, then B, C2, D; resolve the anchored lines; `make check TEST_DB_SUFFIX=public_db`; `make readme-numbers` if coverage moved by more than a point.
- [ ] Docs: `_product/spec.md` feature row (Partial), the three Idea rows' Discussed column, `_product/specs/public-database.md` (Status Partial, Behavior as built, line 5's app-side tap as a To do for the redesign session), `docs/ARCHITECTURE.md` (Components, Data model, Decisions, Last updated), `_product/docs/secrets.md`, `config/credentials.example`, `_product/docs/dx.md`, `README.md` script table, `_product/docs/llm.md`, `docs/PROVENANCE.md`, `_product/specs/admin-console.md`, `_product/specs/threat-feed.md`; `node scripts/docs-check.mjs`.
- [ ] One reviewer agent on the merged diff (correctness, privacy, CSP, rate limits, SQL); fix what it finds.
- [ ] Log: Done line; To do for `Vlad · redesign` (the share tap and the Settings row with the API contract); push `HEAD:main`.
