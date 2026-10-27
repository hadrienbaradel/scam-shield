# Meta: WhatsApp Scam Alert, Messenger scam detection, Facebook and Marketplace

Category: platform built-in. Relevant twice: Meta is the hackathon host, and WhatsApp is where French and US seniors receive family-impersonation messages.

## What it does
- WhatsApp "Scam Alert" (limited beta from Aug 12, 2026, bug-bounty researchers first; wider release after the test): optional on-device model screens messages from non-contacts against patterns learned from user-reported scam chats (wording cues, conversation structure). A warning appears in the chat, invisible to the sender, with block / report / continue; marking a chat "trusted" silences it; opt-in sharing of the last five incoming messages to improve detection. Contacts and groups are not screened. Off by default per June 2026 beta coverage (unverified for release).
- WhatsApp also: warning on device-linking requests (March 2026); screen-share warning on video calls with unknown contacts (Oct 2025); Strict Account Settings.
- Messenger (test, Oct 2025): opt-in advanced scam detection; suspicious first messages from new contacts show "be cautious, you could be at risk of losing money" with common tactics, block/report, and an option to send recent messages to an AI reviewer.
- Facebook: friend-request warnings (few mutual friends, another country). Meta says it disrupted about 8M scam-linked accounts in H1 2025 and acted on 21,000+ Pages posing as customer support; Marketplace keeps pay-before-delivery alerts; Meta joined the National Elder Fraud Coordination Center (with AARP, Amazon, Google, Microsoft, Walmart, Capital One).
- Meta AI inside WhatsApp answers "is this a scam?" like any chatbot (no dedicated feature found).

For whom: all users; the Oct 2025 push was framed around older adults but has no senior mode. Channels: WhatsApp, Messenger, Facebook, Marketplace; no email, no SMS. Detection: on-device ML, cloud AI review, account signals. Install: built in, opt-in. Price: free.

## Strengths
- Reach; a warning at the moment of the message; non-contact scoping; a privacy framing that survives end-to-end encryption.

## Weaknesses
- Beta and opt-in; contacts excluded, so a hacked friend's account is invisible; no cross-channel view; no email; generic tactic cards; no guardian.

## What Scam Shield can learn
- Meta's own roadmap validates the problem; our wedge is what one app cannot do: judge across Gmail, SMS and pasted WhatsApp against the person's life, then loop in a trusted person.
- "Share the last five messages, opt-in" is a precedent for "the guardian sees exactly what the senior chose".
- Hacked-contact scams (in our detector) are a gap in WhatsApp's non-contact rule; show one in the demo.

## Links (accessed 2026-10-27)
- https://www.bleepingcomputer.com/news/security/whatsapp-rolls-out-new-feature-that-flags-potential-scam-messages/
- https://techcrunch.com/2025/10/21/whatsapp-and-messenger-add-new-warnings-to-help-older-people-avoid-online-scams
- https://techrepublic.com/article/news-meta-ai-scam-detection-facebook-messenger-whatsapp
- https://www.medianama.com/2026/06/223-whatsapp-scam-alert-feature/
- https://www.notebookcheck.net/WhatsApp-Scam-Alert-The-AI-only-checks-strangers-not-your-contacts.1369816.0.html
