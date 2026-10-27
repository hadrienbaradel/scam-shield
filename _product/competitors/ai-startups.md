# AI-first scam checkers and new entrants

Category: LLM or ML checkers without a senior focus, plus the generic chatbots people already use.

- Scamnetic KnowScam 2.0 (July 2025): proprietary ML (not external LLMs, per vendor); scores emails, texts, QR codes, links, images and paper mail (3-point score with an explanation and advice by scam type); automatic scanning for Outlook and Android RCS; IDeveryone identity verification for video, audio and text counterparties (dating, Marketplace, crypto, land); deepfake checks; 24/7 recovery specialists. Sold through banks: Commerce Bank, $7.99/mo for its customers; direct access via waitlist, no public price. Vendor claims about nine in ten scams flagged.
- ScamAdviser (Netherlands): website Trust Score 1-100 from 40+ data feeds (domain age, IP, contact details); free web check; browser extension (Chrome, Firefox, Edge, Safari per third parties); Maltego API; ScamCheck with SIDN. Trustpilot complaints about pay-to-change scores. Web reputation only.
- Catch (catch.app; Google Workspace Marketplace add-on updated March 9, 2026): "works behind the scenes" in Gmail, AI checks each email and attachment, flags scams Google's filter lets through, optional training mode; paid with a 30-day trial; requests read and send Gmail scopes and connects to an external service, so content is probably processed off Google (inference). No independent review found. The closest architecture to ours (Gmail add-on), but generic and business-flavoured.
- Small LLM checkers (Chrome Web Store and web, 2025-2026): TrustScan (green, amber, red badges in Gmail; 95 users), Mail P.I. (right-click check in Gmail, Yahoo, Outlook; one free scan a day), Gmail Guardian, Gmail AI Malware & Phishing Detector, RealCheck (paste text, links or screenshots; 0-100% score with the reason), Scam Doctor (upload an image; Stop, Verify or Continue), Cautellus (claims screenshot checks). Unknown teams, no accuracy evidence.
- Generic chatbots: ChatGPT, Gemini and Meta AI (inside WhatsApp) answer "is this a scam?" for free from a paste. The real default competitor for the tech-savvy relative, not the senior. They lack inbox access, sender authentication, link resolution and the person's context.

For whom: consumers directly; banks (Scamnetic). Channels: email (Catch, Scamnetic, extensions), SMS/RCS (Scamnetic), web (ScamAdviser), paste anything (chatbots). Detection: LLM or proprietary ML plus reputation. Install: extension, add-on or web. Price: free to about $8/mo.

## Strengths
- Fast to try; some automate the inbox (Catch, Scamnetic for Outlook); plain-English scores; bank distribution (Scamnetic).

## Weaknesses
- No personal context; opaque teams and privacy (full Gmail scopes); no senior UX (small badges, right-click menus); no family loop; accuracy unproven.

## What Scam Shield can learn
- Google verification and CASA are the moat every Gmail add-on must cross; budget for it.
- Show restricted-scope discipline as a feature: no send, no trash, no delete, versus Catch's read-and-send scopes.
- "Score with reasons" is standard (Scamnetic, RealCheck); our evidence-linked reasons and real_company_says go further; keep them visible.
- QR and paper-mail checks (Scamnetic) are cheap additions via the photo check.

## Links (accessed 2026-10-27)
- https://www.helpnetsecurity.com/2025/07/02/scamnetic-knowscam-2-0/ and https://www.commercebank.com/personal/bank/checking/knowscam
- https://www.sidn.nl/en/news-and-blogs/scamcheck-lets-you-see-how-trustworthy-a-website-is (ScamAdviser)
- https://workspace.google.com/marketplace/app/catch/942447107973
- https://trustscan.email/ ; https://tryrealcheck.com/ ; https://www.scam.doctor/scam-checker/
- https://chromewebstore.google.com/detail/mail-pi-%E2%80%94-scam-email-chec/jjedjbndnnkjmlojfkofbciklkejnibb
