# Google setup

Google Cloud project: **`scam-shield-hb26`** (number 917832658614, owned by Hadrien's Google account).

## Already done (from the command line)

- Project created; **Gmail API** and **Cloud Pub/Sub API** enabled.
- Pub/Sub topic `projects/scam-shield-hb26/topics/gmail-push`, with `gmail-api-push@system.gserviceaccount.com` allowed to publish (that is how Gmail announces new mail).
- Pull subscription `projects/scam-shield-hb26/subscriptions/gmail-push-local`, read by the local worker. No public URL is needed.
- `.env` holds `GMAIL_PUBSUB_TOPIC`, `GMAIL_PUBSUB_SUBSCRIPTION` and `ADMIN_EMAILS`.

The worker authenticates to Pub/Sub with Application Default Credentials if present (`gcloud auth application-default login`), otherwise with the signed-in gcloud CLI account.

## To do in the Cloud Console (about 5 minutes, needs your Google login)

Google has no command line for creating the consent screen or the OAuth client of an External app.

1. **Branding**: open <https://console.cloud.google.com/auth/overview?project=scam-shield-hb26>, click **Get started**.
   - App name: `Scam Shield`. User support email: your address.
   - Audience: **External**. Contact email: your address. Accept the policy, then **Create**.
2. **Test users**: go to **Audience → Test users → Add users**. Add yourself and every senior or guardian who will try it, up to 100 people. Leave the publishing status on **Testing**.
3. **Scopes**: go to **Data access → Add or remove scopes**. Add `https://www.googleapis.com/auth/gmail.modify`; `openid`, `email` and `profile` are added automatically. **Save**.
4. **Client**: go to **Clients → Create client**.
   - Application type: **Web application**. Name: `Scam Shield local`.
   - Authorized JavaScript origins: `http://localhost:3000`
   - Authorized redirect URIs: `http://localhost:3000/auth/google/callback`
   - Click **Create** and copy the Client ID and Client secret.
5. Back in the repo, store them without printing `.env`:
   ```bash
   node scripts/set-env.mjs GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com GOOGLE_CLIENT_SECRET=xxxx
   npm start   # then open http://localhost:3000
   ```

## What testers will see, and the limits of Testing mode

- A screen saying **"Google hasn't verified this app"**: click **Continue**. This is expected for test users.
- A checkbox for Gmail access. If it is left unticked, Scam Shield asks again; it cannot work without it.
- **Sign-ins expire after 7 days in Testing mode.** Google expires the refresh tokens, and Scam Shield shows a "Reconnect Gmail" banner. This goes away only after verification.
- At most 100 test users.

## Before real users (after the hackathon)

`gmail.modify` is a **restricted** scope, so a public launch requires:

1. A public HTTPS domain with homepage, privacy policy (`/privacy.html` is the draft) and terms.
2. Google OAuth verification, including a demo video of the consent flow and how the data is used.
3. A yearly **CASA** security assessment by an authorised lab. Budget it, and plan several weeks.
4. Moving off localhost (Railway EU is the plan). Before any public deployment, run the organisation's public-publication warning and data scan.
