# WhatsApp: forward it to Prudence
Status: Partial · Last updated: 2026-10-29

## Why
Most scams a senior wants to ask about already sit in WhatsApp (a chain message, a "new number" from a grandchild, a voice note). Forwarding it to a saved contact is three taps they already know, and the answer comes back in the same chat. For the hackathon video it is a Meta product (WhatsApp Cloud API) carrying Muse Spark's verdict, chosen by Hadrien on 2026-10-29 as the extra scene.

## Behavior
1. The senior saves the Prudence number once, then forwards any WhatsApp message to it (long-press, Forward, Prudence). Within seconds a reply appears in the same chat, quoted under the forwarded message: one verdict line (🔴 Scam, 🟠 Be careful or 🟢 Safe), the headline, up to three reasons, one next step, and who checked it ("Checked with Meta's Muse Spark").
2. A picture (screenshot or photo, JPEG, PNG or WebP, up to 8 MB) is read by Muse Spark word for word, then judged like text. A picture with no message in it gets "I could not find a message in this picture."
3. A voice note (WhatsApp records Ogg/Opus) is converted on the server to 16 kHz mono WAV, written down by Muse Voice Transcribe, and judged like a text from the channel "voice_transcript". The reply quotes what the note says (the first 200 characters). No words heard: "I could not hear any words in this voice note."
4. The reply is in the senior's language: French when the words are French or when the sender's number starts with +33, English otherwise.
5. A forwarded message says so in the reply ("This message was forwarded to you."). A message WhatsApp marks as forwarded many times adds "Chain messages like this are often scams.", and the engine sees the label "Forwarded many times" as the message's subject.
6. Stickers, videos, locations, contacts, PDFs and anything else get one plain reply: "I can only check texts, pictures and voice notes for now." Delivery receipts (statuses) get no reply.
7. Nothing is kept: not the message, the picture, the recording, nor the verdict. The sender's number is not matched to any account, so the check uses the shipped pattern cards and no personal context (see Open questions).
8. Each message is answered once, however many times Meta delivers it (retries run for 36 hours). A sender gets at most 10 checks a minute; the eleventh gets "Please wait a minute before sending another message." and the rest of that minute is silence.
9. Meta's webhook is verified (the GET handshake with the verify token) and every delivery must be signed (`X-Hub-Signature-256` with the app secret): an unsigned or mis-signed delivery is refused, and so is every delivery while the app secret is not set (the check is never skipped). Without the token and number the server still starts and the webhook answers 501; the handshake works with the verify token alone, so the dashboard can be wired first.
10. When Muse Spark is not switched on, a text is judged by the rules alone and the reply says so; a picture or a voice note gets "Checking pictures and voice notes needs Meta's Muse Spark. Please type the words instead."
11. When something fails on our side (download, transcription, the model), the reply is "Something went wrong on our side. To be safe, do not click anything in the message."

## Demo path
Linda's phone, WhatsApp open. 1) A chain message "Your USPS package is on hold, pay $1.99" arrives; she long-presses it, taps Forward, picks Prudence. 2) Four seconds later the reply lands under it: "🔴 Scam … Do not pay. USPS never asks for a fee by text. Checked with Meta's Muse Spark." 3) She forwards the voice note "Grandma, it's me, I had an accident…": the reply quotes the words and says Be careful, call him on the number you already have. 4) Optional, 4 s: a screenshot of a bank text, read by Muse Spark, red reply. Needs the Cloud API test number, Linda's phone on its allowlist and the tunnel in front of the server.

## Out of scope
Matching the sender to a Prudence account (no phone number on the senior's profile yet), "Ask my trusted person" from the chat, PDFs and `.eml` files, replies outside the 24-hour window (templates), a public number (display-name review, business verification), group chats, the QR deep link (`message_qrdls`), read receipts and typing indicators.

## Acceptance
- Tests (`tests/whatsapp.test.js`, mock LLM, fake Graph API): handshake good and bad token; signature good (200), bad (403) and app secret unset (403: the secret is required, validation is never skipped); a text gets exactly one reply with the verdict words; a forwarded message mentions the forward; a picture goes through the screenshot path, its bytes fetched only by media id from a Graph-returned https URL on Meta's media host, no redirects followed; a voice note goes through the voice path; a duplicate delivery is ignored; a sticker gets the plain reply; a French sender gets French; the eleventh message in a minute gets the wait reply; the server starts without the keys and the webhook answers 501.
- Live, to record: the handshake from the App Dashboard, a forwarded text from an allowlisted phone replied within 5 s through the tunnel, a voice note transcribed (needs ffmpeg on the host).

## Implementation pointers
src/channels/whatsapp.js (parseWebhook, detectLanguage, formatReply, ffmpegToWav, mediaUrl, createWhatsAppChannel: downloadMedia, judge, sendText), src/routes/whatsapp.js (GET and POST /api/whatsapp/webhook, raw body for the signature, 403 without a valid signature or without the app secret, 200 before the work), src/server.js (registration; the webhook is exempt from the browser Origin check because the signature authenticates Meta), lib/muse.js checkMessage, extractFromImage and transcribeVoice reused unchanged, data/patterns/cards.json (fallback when Postgres is down) and the live cards. Keys: `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET` (required for deliveries), optional `WHATSAPP_GRAPH_VERSION` (`_product/docs/secrets.md`).

## Open questions
- Personal context: the sender is a phone number, not a signed-in user, and the codebase stores a phone only for guardians (`guardianships.guardian_phone`), never for the senior. Decision for now: judge from the message alone, store nothing, and say "Checked with Meta's Muse Spark" without claiming to know the person. Next step if the scene needs "not Ethan's saved number": a WhatsApp number on the senior's profile, matched at webhook time to load their context (and the per-user cache and the checks row).
- Graph API version: `v22.0` by default, unverified offline; `WHATSAPP_GRAPH_VERSION` overrides it without a code change.
- Payload fields come from the research notes (`context.forwarded`, `context.frequently_forwarded`, `audio.voice`, `type: "unsupported"` for unknown types) and were not checked against a live event: log the first live delivery (ids and types only) and compare. The media `url` some webhooks carry is ignored on purpose (the token goes only to a URL the Graph API returned).
- Media host: the token is sent only to `lookaside.fbsbx.com` over https (Meta's Cloud API examples), never following a redirect; if a live lookup returns another host the download fails with a log line naming it, and the list grows only once Meta's documentation names that host.
- ffmpeg must be on the host (`brew install ffmpeg`; the production image needs it too); `FFMPEG_PATH` points elsewhere. Without it, voice notes get the "something went wrong" reply.
- Reply wording after the forwarded flag: WhatsApp sets `forwarded` on every message the senior forwards to Prudence, so the line is on by default in the demo; is it worth its space on the screen?
- Ideas raised here, for the Ideas table when the file scope allows: "Reply 1 to send this to Thomas" from the chat; a WhatsApp number on the senior's profile; the fridge-magnet QR (`message_qrdls`).
