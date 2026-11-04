# WhatsApp setup (the Meta side)

The channel is coded and tested (`_product/specs/whatsapp-channel.md`: forward a text, a picture or a voice note to the Prudence number, the verdict comes back in the chat). Meta's side runs on the same app as the Messenger channel, under Vlad's account (vladztools@gmail.com, the rule in `_product/docs/secrets.md`, Accounts). Nothing here needs App Review, display-name review or business verification: a test number talks to up to 5 allowlisted phones, which is all the demo needs.

## Where it stands (Nov 4, 2026, 10:00 CET)

| Piece | State |
|---|---|
| Business portfolio | **Hey Prudence**, id `4686439461680708`, the Page claimed into it, Vlad full control |
| App | **Hey Prudence**, id `974018515302637` (the Messenger app), WhatsApp use case added |
| Test number | **+1 (555) 623-9145**, digits `15556239145` |
| Phone number ID | `1392583843943808`, stored as `WHATSAPP_PHONE_NUMBER_ID` |
| WhatsApp Business Account ID | `1817793229233892`, stored as `WHATSAPP_BUSINESS_ACCOUNT_ID` |
| `WHATSAPP_PHONE_NUMBER`, `WHATSAPP_GRAPH_VERSION` | stored (`15556239145`, `v25.0`) |
| Webhook | callback `https://<tunnel>/api/whatsapp/webhook` with the stored `WHATSAPP_VERIFY_TOKEN`, verified by Meta (its handshake answered 200 from a Meta address) |
| `WHATSAPP_ACCESS_TOKEN` | **missing**: dashboard step 1 below |
| `WHATSAPP_APP_SECRET` | **missing**: dashboard step 2 below (the same value as `MESSENGER_APP_SECRET`, one app) |
| Recipient allowlist | **empty**: dashboard step 3 below |

The three missing pieces are dashboard actions behind Meta's own dialogs (a Facebook Login popup, the password re-entry, a code sent to a phone), so Vlad does them by hand. Everything after that goes through the Graph API from the command line.

## Part 1: Vlad, three dashboard actions, about 5 minutes

Open <https://developers.facebook.com/apps/974018515302637/> as the vladztools account.

1. **Access token.** Left menu: Use cases → Connect on WhatsApp → **Step 1. Try it out** → **Generate token**. A Facebook Login popup asks to continue as the account and to grant the WhatsApp permissions: continue. Copy the token (24 hours; a system-user token that never expires replaces it later from <https://business.facebook.com/latest/settings/system_users?business_id=4686439461680708>: Add `prudence-server`, role Admin, assets = the app and the WhatsApp account, Generate token, expiration Never, permissions `whatsapp_business_messaging` and `whatsapp_business_management`). Then, in a terminal at the repo root, paste it into:
   ```
   make secrets-set WHATSAPP_ACCESS_TOKEN=<paste>
   ```
2. **App Secret.** Left menu: App settings → **Basic** → App secret → **Show** (Facebook asks for the password) → copy, then:
   ```
   make secrets-set WHATSAPP_APP_SECRET=<paste> MESSENGER_APP_SECRET=<paste>
   ```
   Both channels check every delivery's signature with it; until it is set every delivery is refused with 403.
3. **Recipient phones.** Step 1. Try it out → **Send a message from your test number** → Recipient → **Manage phone number list** → add your own mobile; type the code Meta sends to it. Up to 5 numbers: the demo phone and Hadrien's go in the same way, each with its owner reading the code.

Then `git add config/credentials.enc` and commit it (the values are encrypted), or tell the agent "keys in" and it commits.

## Part 2: the agent, by API

With the token and the secret stored, from the command line (`scripts/whatsapp-check.mjs`, see below):

1. `GET /{WABA}/subscribed_apps` and, if the app is not listed, `POST /{WABA}/subscribed_apps`: the business account must be subscribed to the app for deliveries to flow.
2. `GET /{app_id}/subscriptions` with the app token (`app_id|app_secret`): the `whatsapp_business_account` object must list the callback URL and the `messages` field; `POST /{app_id}/subscriptions` sets them when they are off, and the same call moves the callback to `https://heyprudence.com/api/whatsapp/webhook` once production is reachable.
3. `POST /{PHONE_NUMBER_ID}/messages` with the `hello_world` template to an allowlisted phone: proves the token, the number and the allowlist.
4. The first live delivery: the senior's phone forwards a text to the test number saved as "Prudence"; the server log shows the delivery (ids and types only) and the reply; the payload is compared with the assumptions in `_product/specs/whatsapp-channel.md` (Open questions).
5. Production: `make deploy` ships the keys; step 2 moves the callback URL.

## What the test number cannot do

- Only the allowlisted phones can write to it; everyone else gets nothing.
- No display name: the number shows as a number until the person saves the contact.
- Replies only inside the 24-hour window that the person's own message opens; the bot only ever replies, so this never bites.
- For real seniors: an owned number, display-name review and business verification, all after the hackathon.
