# Developer sign-in (local, without Google)
Status: Built · Last updated: 2026-10-30

## Why
Google sign-in needs an OAuth client that only the Cloud Console can create (Hadrien's project, `docs/GOOGLE_SETUP.md`); until it exists nobody can open a signed-in screen or `/admin/` on a laptop, and a judge who clones the repo has the same problem. A local sign-in, on the developer's own computer only, opens every screen today. The Google flow itself does not change.

## Behavior
1. On the developer's own computer (the app opened at localhost, not in production), "Protect my email" and "I'm someone's trusted person" work without Google keys: they open a local sign-in page (`/dev/signin`) instead of Google's consent screen, and the welcome banner says so.
2. The local page lists the people already in the database (name, email, senior or trusted person, admin) and signs in as one of them with one tap; or it creates a new person from an email, a name, a language and a role (senior with a mailbox, or trusted person), already past the welcome steps unless "Show the welcome steps" is ticked. An address already in the database signs in as that person (the one who came through Google when a local test person shares the address), and the name, role, language and welcome fields are ignored.
3. A person signed in this way has the same session as after a Google sign-in: Today, Check, People, Settings, Learn, the trusted-person loop, the audit list and "Delete my account" all work; an email listed in `ADMIN_EMAILS` opens `/admin/`.
4. A local senior has a mailbox entry but no Gmail access: Today says nothing needs them and "Up to date", with no error and no "Reconnect Gmail" banner; the background jobs (the poll, the push renewal and the push listener) never try to read their mail.
5. An invitation link followed on the developer's computer works too: the local sign-in accepts the invitation like the Google one does.
6. The page does not exist in production, and answers only to a browser on the same computer: a request through a tunnel or a proxy (a forwarding header, a non-local address) gets "not found", exactly like `/dev/outbox`.
7. Each local sign-in appears in the person's audit list as "signed in locally".
8. With Google keys set, the two buttons go to Google as before, and `/dev/signin` stays reachable on the developer's computer for local test people only; everyone else signs in with Google.
9. Nothing else changes in Google sign-in: PKCE, the 15-minute browser cookie, the two modes, the invitation handling.

## Demo path
Not in the video. It is the judge's path into the product: clone, `make server`, open http://localhost:3000, tap "Protect my email", sign in as Linda, see Today, Check something else, Learn and, with the address in `ADMIN_EMAILS`, `/admin/`.

## Out of scope
Any machine other than the developer's own; production; Gmail data for a local person (that is the real OAuth client, `docs/GOOGLE_SETUP.md`); bearer tokens for the phone app (pairing has its own flow); the WhatsApp channel.

## Acceptance
- `tests/dev-signin.test.js` (Postgres): 404 in production, from a non-loopback address, with a forwarding header, with a non-local Host; the page lists people; creating a person sets the session cookie, a mailbox entry for a senior and no token row, the audit event, and redirects by role; signing in as an `ADMIN_EMAILS` address opens `/admin` (200); an invitation is accepted; `/auth/google` without keys redirects locally and still answers 503 from elsewhere; with keys it redirects to Google as before (existing tests); the poll job skips a local senior; `/api/inbox?fresh=1` for a local senior answers 200, never 409.
- Review round: `tests/dev-signin.test.js`: a post from another site or with `Origin: null` answers 403 with no session; with Google keys set the page lists only local test people and a Google person, by the list or by address, gets 403 while a new local person is still created; an address shared by a Google person and a local one signs in as the Google person without keys; a push event reaches only a mailbox with a live Google token; X-Forwarded-Host, X-Forwarded-Proto and Via get "not found". `tests/security-headers.test.js` (no database): `/` and `/answer/:token` say `Referrer-Policy: same-origin` and keep their CSP, and a form post with `Origin: null` is still refused.
- Manual: the welcome page on localhost without keys shows the two buttons enabled and the local banner; through the Cloudflare tunnel `/dev/signin` is "not found".

## Implementation pointers
`src/routes/auth.js` (`/dev/signin` GET and POST, the redirect from `/auth/google` when Google is off, `/auth/config` says `devSignin`), `src/localDev.js` (the loopback-only rule, shared with `/dev/outbox` in `src/routes/admin.js`), `src/routes/mail.js` (`fresh=1` is a no-op without a token row), `public/js/views/pages.js` and `public/js/i18n.js` (the welcome page), `tests/dev-signin.test.js`, `docs/GOOGLE_SETUP.md` (the real client).

## Open questions
- The admin console's "Sign in first" page carries `next=/admin/` so a local sign-in lands on the console; `next` must be a same-origin path. Anything else worth a `next`?
