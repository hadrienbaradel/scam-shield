# Google setup

Google Cloud project: **`scam-shield-hb26`** (number 917832658614, owned by Hadrien's Google account). The project id and the repository keep the old name; on Google's screens the app is **Prudence**.

Google sign-in is coded (`src/routes/auth.js`, `src/google/oauth.js`: authorization code + PKCE; mode `gmail` for seniors, `basic` for trusted people). On 2026-10-30 the encrypted credentials still hold no OAuth client (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`), so `/auth/google` answers 503 and nobody can sign in with Google.

## Already done (from the command line)

- Project created; **Gmail API** and **Cloud Pub/Sub API** enabled.
- Pub/Sub topic `projects/scam-shield-hb26/topics/gmail-push`, with `gmail-api-push@system.gserviceaccount.com` allowed to publish (that is how Gmail announces new mail).
- Pull subscription `projects/scam-shield-hb26/subscriptions/gmail-push-local`, read by the local worker. No public URL is needed.
- `ADMIN_EMAILS` holds both our Google addresses in the encrypted credentials (2026-10-30): `/admin/` opens for them once sign-in works.

Gmail push stays off until `GMAIL_PUBSUB_TOPIC` and `GMAIL_PUBSUB_SUBSCRIPTION` hold the two full names above (`make secrets-set`; not set on 2026-10-30); meanwhile Gmail is polled every 2 minutes. The worker reads Pub/Sub with Application Default Credentials (`gcloud auth application-default login`), otherwise with the signed-in gcloud CLI account, so that machine needs a gcloud login with access to the project (Vlad's has none today).

## Who does the rest

Google has no command line for the consent screen or the OAuth client of an External app, so someone with access to `scam-shield-hb26` clicks through the steps below. Two ways:

- **Hadrien does it**: the console steps, then the import and the commit once Vlad has sent him `config/master.key` (a To do in `_product/log.md`). He keeps the downloaded file until then.
- **Hadrien adds Vlad to the project**: **IAM & Admin → IAM → Grant access**, principal `vladztools@gmail.com`, role **Owner** or **Editor**. Vlad then does everything on his machine, which has the master key; the console needs no gcloud login.

## In the Cloud Console (about 5 minutes)

1. **Branding**: open <https://console.cloud.google.com/auth/overview?project=scam-shield-hb26> and click **Get started**.
   - App name: `Prudence`: seniors read it on Google's consent page, and the video shows it. User support email: your address.
   - Audience: **External**. Contact email: your address. Accept the policy, then **Create**.
   - If the app already exists (Hadrien's live Gmail test on Oct 28), open **Branding** instead and set the App name to `Prudence`.
2. **Test users**: go to **Audience → Test users → Add users**. Add `vladztools@gmail.com` (Vlad), Hadrien's Google account, Linda's demo Gmail (the seeded inbox the video uses; Hadrien owns it) and every senior or trusted person who will try it, up to 100 people. Leave the publishing status on **Testing**.
3. **Scopes**: go to **Data access → Add or remove scopes**. Add `https://www.googleapis.com/auth/gmail.modify`; `openid`, `email` and `profile` are added automatically. **Save**.
4. **Client**: go to **Clients → Create client**.
   - Application type: **Web application**. Name: `Prudence web`.
   - Authorized JavaScript origins: `http://localhost:3000` and `https://demo.heyprudence.com`
   - Authorized redirect URIs: `http://localhost:3000/auth/google/callback` and `https://demo.heyprudence.com/auth/google/callback`
   - Click **Create**, then **Download JSON** in the dialog (the secret is shown only once). An older client whose JSON or `.env` values you still have (Hadrien's client of Oct 28) can stay: add the second origin and redirect URI to it and store its values as below; create a new one only when the secret is lost, since Google never shows it again.

`demo.heyprudence.com` is the Cloudflare tunnel's public hostname (`_product/research/ops-services.md`). Google wants HTTPS except on localhost, no raw IP address, and an exact match (scheme, case, trailing slash). The app builds its callback from `BASE_URL`, so the tunnel host runs with `BASE_URL=https://demo.heyprudence.com`.

## Storing the client

On a machine that has `config/master.key` (today only Vlad's), without copying the secret by hand or printing anything:

```bash
node scripts/import-google-client.mjs ~/Downloads/client_secret_*.json   # into config/credentials.enc
make server   # then open http://localhost:3000 and sign in
```

The script checks that the file is a Web client of `scam-shield-hb26` with the localhost redirect URI and origin, and names what to fix in the console. Then commit `config/credentials.enc` and push: everyone with the master key has Google sign-in after a pull. By hand instead: `make secrets-set GOOGLE_CLIENT_ID=… GOOGLE_CLIENT_SECRET=…`. `make secrets-keys` and `make doctor` report the keys by name, never a value.

Without the master key the script writes the client to that machine's `.env`, and sign-in works there only. `.env` wins over the credentials, so once the shared client is committed, delete the two `GOOGLE_CLIENT_*` lines from that `.env`.

After the first sign-in with Gmail access, wait for the first pass over recent mail, then check it from the database (no email is printed): `make gate`.

## Working without the client

On your own computer, without Google keys, the welcome buttons open a local sign-in, `/dev/signin`. It signs you in as anyone already in the database, or creates a person, with the same session as Google's; `/admin/` opens for an address in `ADMIN_EMAILS`. It never exists in production, answers only on loopback and refuses forwarded requests. It reads no Gmail, so real mail and the video still need the client above. Spec: `_product/specs/developer-sign-in.md`.

## What testers will see, and the limits of Testing mode

- A screen saying **"Google hasn't verified this app"**: click **Continue**. This is expected for test users; Google refuses an account that is not on the list.
- A checkbox for Gmail access. If it is left unticked, Prudence asks again; it cannot work without it.
- **Gmail access expires after 7 days in Testing mode.** Google expires the refresh tokens, and Prudence shows a "Reconnect Gmail" banner. This goes away only after verification.
- At most 100 test users.

## Before real users (after the hackathon)

`gmail.modify` is a **restricted** scope, so a public launch requires (`_product/specs/public-deployment.md`):

1. A public HTTPS domain with homepage, privacy policy (`/privacy.html` is the draft) and terms.
2. Google OAuth verification, including a demo video of the consent flow and how the data is used.
3. A yearly **CASA** security assessment by an authorised lab. Budget it, and plan several weeks.
4. A real host instead of a laptop (options in `_product/research/ops-services.md`). Before any public deployment, run the organisation's public-publication warning and data scan.
