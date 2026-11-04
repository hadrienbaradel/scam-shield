# WhatsApp setup (the Meta side)

The channel is coded and tested (`_product/specs/whatsapp-channel.md`: forward a text, a picture or a voice note to the Prudence number, the verdict comes back in the chat). What is missing is Meta's side: an app with the WhatsApp product, its free test number, a token and the App Secret. Nothing here needs App Review, display-name review or business verification: a test number in Development mode talks to up to 5 allowlisted phones, which is all the demo needs.

Who does it: **Hadrien, under his own Meta account** (`_product/docs/secrets.md`, Accounts: Vlad's Meta registrations use vladztools@gmail.com, Hadrien registers under his own). On Nov 4, 2026 Vlad's developer account sat in an "unusual activity" confirmation checkpoint, so the Meta side moved to Hadrien. About 20 minutes, plus 5 for the webhook once a server is reachable.

## Part 1: Hadrien alone, in the Meta dashboard

1. **Developer account.** Open <https://developers.facebook.com/> and log in with your Facebook account. If Meta asks you to register as a developer, accept and confirm the email.
2. **Create the app.** My Apps → Create app. App name **Prudence** (if Meta refuses the name, **Hey Prudence**; the name is internal, the test number never shows it). Contact email: yours. Use case: a WhatsApp one if the list offers it, otherwise **Other**, then app type **Business**. Business portfolio: pick yours, or **Create a new business portfolio** named after yourself or **Hey Prudence** (on Nov 3 "Prudence" alone was refused as a business name). Create the app.
3. **Add WhatsApp.** In the app dashboard: Add products (or Use cases) → **WhatsApp** → Set up. If it asks for a business portfolio only now, create it here with the same naming rule.
4. **API Setup.** WhatsApp → **API Setup**. Write down three things from this page:
   - the test phone number in the **From** field (a real number, the one the phones will write to) and its **Phone number ID** (a long number, not the phone number);
   - the **WhatsApp Business Account ID**;
   - the **temporary access token** (24 hours; a stopgap for today only, step 6 gives the real one).
5. **Allowlist the phones.** In the **To** field → **Manage phone number list** → add your own mobile first; Meta sends a code to that phone by WhatsApp or SMS, type it. Up to 5 numbers. Vlad's phone and the demo phone can be added later by whoever holds the dashboard, with the phone's owner reading the code. Then click **Send message**: the `hello_world` template must arrive on your phone. That proves the number pair works.
6. **Permanent token (system user).** <https://business.facebook.com/settings> (the Business settings of the portfolio) → Users → **System users** → Add: name `prudence-server`, role **Admin** → **Add assets**: Apps → the app (Full control) and Accounts → WhatsApp accounts → the account (Full control) → **Generate new token**: app = the app, expiration **Never**, permissions `whatsapp_business_messaging` and `whatsapp_business_management` → Generate. Copy it at once: Meta shows it once.
7. **App Secret.** App settings → **Basic** → App secret → **Show** (Facebook asks for your password) → copy.
8. **Verify token.** Invent a random string of 20 characters or more (for example the output of `openssl rand -hex 16`). It goes into Meta's webhook form in Part 2 and to Vlad now.
9. **Optional, saves a round trip.** App roles → Roles → **Add people** → Administrators → Vlad's Facebook account (the one tied to vladztools@gmail.com). Once he accepts in his developer dashboard he can do Part 2, add phones and regenerate tokens without you. His account was in a confirmation checkpoint on Nov 4, so this may have to wait.
10. **Leave the app in Development mode.** Nothing else on Meta's side.

## What Vlad needs back

Over a private channel (iMessage, Signal, a WhatsApp message): never the repository, never a chat with an agent. Six values, named exactly as the credentials name them (`config/credentials.example`):

| Name | What it is | From step |
|---|---|---|
| `WHATSAPP_ACCESS_TOKEN` | the system-user token that never expires (the 24-hour one only if step 6 failed) | 6 (or 4) |
| `WHATSAPP_PHONE_NUMBER_ID` | the Phone number ID of the test number | 4 |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | the WhatsApp Business Account ID | 4 |
| `WHATSAPP_APP_SECRET` | the App secret | 7 |
| `WHATSAPP_VERIFY_TOKEN` | the string you invented | 8 |
| `WHATSAPP_PHONE_NUMBER` | the test number itself as digits only, country code first (for example 15551234567); not secret, it becomes the "Open WhatsApp" link in Settings | 4 |

Plus the App ID, not secret either.

Vlad stores them with `make secrets-set NAME=value` (six times, pasted from the clipboard, never typed in a chat), restarts his server, commits `config/credentials.enc` and runs `make deploy` so production has them too. Alternative once Vlad has sent you `config/master.key` (an open To do in `_product/log.md`): run the six `make secrets-set` yourself, commit `config/credentials.enc`, and tell him "pushed".

## Part 2: the webhook, 5 minutes, once the keys are on a server reachable over HTTPS

Whoever holds the dashboard (Hadrien, or Vlad after step 9), after Vlad confirms the keys are stored and names the host:

1. WhatsApp → **Configuration** → Webhook → **Edit**: Callback URL `https://<host>/api/whatsapp/webhook`, Verify token = the `WHATSAPP_VERIFY_TOKEN` string → **Verify and save**. The server answers the handshake with the verify token alone, so this works before any message flows. Hosts: Vlad's temporary tunnel today (a random `trycloudflare.com` name; it changes when his session ends), `heyprudence.com` once the production tunnel exists (then every redeploy keeps the URL and the webhook is set once for good).
2. Webhook fields → **Manage** → subscribe to **messages**.
3. **Test.** On an allowlisted phone, save the test number as "Prudence" and forward any text to it: the verdict comes back within seconds. A picture goes through Muse Spark's reading, a voice note through Muse Voice Transcribe (ffmpeg is on Vlad's Mac and in the production image). The **Test** button next to the `messages` field sends a sample signed delivery; the server log shows it with ids and types only.
4. The first live delivery is compared with the payload assumptions in `_product/specs/whatsapp-channel.md` (Open questions): `context.forwarded`, `audio.voice`, the media host.

## What the test number cannot do

- Only the 5 allowlisted phones can write to it; everyone else gets nothing.
- No display name: the number shows as a number until the person saves the contact.
- Replies only inside the 24-hour window that the person's own message opens; the bot only ever replies, so this never bites.
- For real seniors: an owned number, display-name review and business verification, all after the hackathon.
