# Messenger setup (the Meta side)

The channel is coded and tested (`_product/specs/messenger-channel.md`: send a forwarded message, a screenshot of the chat or of the profile, or a voice message to the Prudence Page on Messenger; the verdict comes back in the chat, judged on the whole conversation). What is missing is Meta's side: a Facebook Page, an app with the Messenger use case, a Page access token, the App Secret, and the webhook. Nothing here needs App Review or Business Verification: with Standard Access, the Page answers the accounts that hold a role on the app (the team, up to 50 testers), which is all the video needs. Facts checked on Nov 4: `_product/research/messenger-platform.md`.

Who does it: **Vlad, under vladztools@gmail.com** (`_product/docs/secrets.md`, Accounts), in Chrome, about 40 minutes. His developer account sat in an "unusual activity" confirmation checkpoint on Nov 4 (the code went to vladztools@gmail.com; type it in the Facebook tab first). The scammer writes to Vlad's **personal** Facebook account; that account only takes a Tester role on the app (step 7), it registers nothing.

## Part 1: in the Meta dashboard, with the agent driving Chrome

1. **Developer account.** <https://developers.facebook.com/> logged in as the vladztools Facebook account. Clear the confirmation checkpoint if it shows.
2. **The Page.** <https://www.facebook.com/pages/create>: name **Prudence** (taken: **Hey Prudence**), category "App page" or "Software"; add the logo later. Open the Page → set its **username** (Settings → Page setup → Username, or the "Create @username" link): it makes the link the seniors open, `https://m.me/<username>`, and goes in `MESSENGER_PAGE_LINK`. The **Page ID**: Page → About → Page transparency, or `Settings → Page details`.
3. **The app.** My Apps → Create app → use case **"Engage with customers on Messenger from Meta"** (older dashboards: Other → Business). Name **Prudence** (refused: **Hey Prudence**; internal only), contact email vladztools@gmail.com. If a business portfolio is demanded, create one named after Vlad or **Hey Prudence**, never "Prudence" (refused on Nov 3).
4. **Messenger API Setup**, in the app's left menu: **Generate access tokens** → Connect → tick the Page → Continue → Save → **Generate** next to the Page → copy the **Page access token** (shown once; regenerate if lost). Then **Add Subscriptions** → tick **messages** only (not `message_echoes`) → Confirm.
5. **App Secret.** App settings → Basic → App secret → Show (Facebook asks the password) → copy. On the same page fill **Privacy policy URL** (`https://heyprudence.com/privacy` once it exists; the landing page URL meanwhile) and **Category**: both are needed to switch the app Live (step 8).
6. **Verify token.** A random string of 20 characters or more: `openssl rand -hex 16`.
7. **Roles.** App roles → Roles → **Add people** → Testers → Vlad's personal Facebook account (the one the stranger writes to) and Hadrien's; each accepts at <https://developers.facebook.com/requests> (or the Facebook notification). Only role holders reach the webhook before App Review.
8. **Live mode.** The App Mode switch at the top of the dashboard: **Live**. Standard Access still limits the Page to role holders; Meta's webhook prerequisites ask for a published app to deliver notifications. If the switch refuses (missing privacy policy, icon or category), fill what it names.

## What the server needs

Stored with `make secrets-set NAME=value` (pasted from the clipboard, never typed in a chat; names only ever appear in reports), then the server restarted, `config/credentials.enc` committed and `make deploy` run so production has them too:

| Name | What it is | From step |
|---|---|---|
| `MESSENGER_PAGE_ACCESS_TOKEN` | the Page access token | 4 |
| `MESSENGER_PAGE_ID` | the Page ID | 2 |
| `MESSENGER_APP_SECRET` | the App secret | 5 |
| `MESSENGER_VERIFY_TOKEN` | the string invented in step 6 | 6 |
| `MESSENGER_PAGE_LINK` | `https://m.me/<username>` (not secret; shown in Settings) | 2 |

Optional: `MESSENGER_GRAPH_VERSION` (default `v26.0`), `MESSENGER_GROUP_MS` (how long Prudence waits after the last message of a burst, default 3000).

## Part 2: the webhook, 5 minutes, once the keys are on a server reachable over https

1. A public https address in front of the server: the production host (`https://heyprudence.com` once its tunnel runs, `_product/docs/ops.md`) or a quick tunnel on the laptop, `cloudflared tunnel --url http://localhost:3000` (a random `trycloudflare.com` name that changes when the process ends).
2. Messenger API Setup → **Configure webhooks** → Callback URL `https://<host>/api/messenger/webhook`, Verify token = `MESSENGER_VERIFY_TOKEN` → **Verify and save**. The server answers the handshake with the verify token alone, so this works before any message flows. If the subscription of step 4 did not stick, tick **messages** again here.
3. **Test.** From Vlad's personal account (a Tester since step 7), open `https://m.me/<username>` and send "hello": the typing dots, then a reply within seconds. Then long-press one of the stranger's messages → More → **Forward** → Prudence; if the Page is not offered as a target, send a screenshot of the chat instead (same verdict, read by Muse Spark).
4. The first live delivery is compared with the assumptions in `_product/specs/messenger-channel.md` (Open questions): the attachment host and URL lifetime, the audio container of a voice message, and whether the Send API accepted the token in the `Authorization: Bearer` header (an error 190 or 104 on the first reply means it wants `?access_token=`: one-line change in `src/channels/messenger.js`).

## What the Page cannot do yet

- Answer anyone without a role on the app: App Review for `pages_messaging` (a screencast) plus Business Verification, after the hackathon.
- Reply outside the 24-hour window the person's own message opens (the bot only ever replies, so this never bites).
- Know who the sender is: no account matching, no life context, nothing stored.
