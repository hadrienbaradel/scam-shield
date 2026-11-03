# Submission form and X post (drafts, Nov 4)

Drafts for the Cerebral Valley submission form and the Most Viral post on X. Every number comes from [../../docs/STATUS.md](../../docs/STATUS.md), [../../docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) (measurements) or the Nov 3 inbox gate; check the links on the day. Fill the `[…]` gaps after upload.

## Form

**Project name:** Prudence

**Tagline:** Scam protection for seniors that checks every message against their own life, and explains it in plain words with Meta's Muse Spark.

**Track and theme:** Indie Developer · Build for Your World

**Team:** Hadrien Baradel (product), Vlad Zloteanu (CTO)

**Links:** video [YouTube link] · repo https://github.com/hadrienbaradel/scam-shield · live [heyprudence.com, only if it answers on the day]

**Description:**

Americans over 60 reported $7.7 billion lost to online fraud in 2025 (FBI IC3). The scams that get past the spam filter arrive at 9 PM, when nobody is there to ask. Prudence is the person to ask.

It connects to Gmail and checks every new message against the senior's own life, learned from their genuine mail: the bank and companies that really write to them, recent orders and carriers, the people they write to, data breaches they were part of. Texts, voicemails and pictures can be checked too. Each check ends in one verdict (Scam, Be careful, Safe), one action, and the reasons in plain words, read aloud on request: "USPS never asks for a fee by text. Your order ships with Amazon Logistics, not USPS."

Meta's models do the judging. Rules gather the evidence (sender, links, her context), Muse Spark decides and explains in a fixed JSON schema, and a guardrail stops it from clearing a proven scam. Prudence never sends, never deletes: a scam goes to a Scam folder in her Gmail, and Undo brings it back. A trusted person (her grandson) can be asked in one tap: her own phone writes the text, and his answer appears on her screen. Personal numbers are masked before Meta sees anything, emails are never stored, and Muse Spark runs in Standard mode.

Measured: on 18,849 public test emails, Muse Spark lifts phishing caught from 29% (rules alone) to 81%, with 1 false Scam in 17,291 genuine emails. On Hadrien's own inbox, Muse Spark judged 430 emails and called none of them Scam by mistake. Both scams in the video reached Hadrien the week of the event: a fake Norton invoice hidden as a picture in a spreadsheet, and a "free cruise" voicemail.

**Meta models used:**
- Muse Spark 1.3 (Standard mode): judges every message against the person's context and the rules' evidence; JSON verdict with reasons.
- Muse Spark 1.3 vision: reads screenshots and photos (the fake Norton invoice) into a message.
- Muse Voice Transcribe: writes down voicemails, judged like any message.
- Muse Spark 1.3 Contributor tier: scored the 18,849-email public evaluation only, never anyone's mail.

**Built during the event:** everything shown. Pre-existing: open-source libraries and public test datasets ([../../docs/PROVENANCE.md](../../docs/PROVENANCE.md)).

## X post (Most Viral: likes, reposts and comments count until Nov 8)

> Americans over 60 lost $7.7B to online fraud last year. The scams that get through arrive at 9 PM, when nobody is there to ask.
>
> So I built Prudence: it checks every email, text, voicemail and picture against your own life, and Meta's Muse Spark explains why in plain words.
>
> Built this week for the #MetaAIHackathon 👇
> [video link]
> @AIatMeta @cerebral_valley

Reply to the post, as a thread:

> Two real scams from my own week are in the video: a fake Norton invoice hidden as a picture inside a spreadsheet (so no text filter sees it), and a "free cruise" voicemail. Prudence caught both.
>
> On 18,849 public test emails, Muse Spark lifts phishing caught from 29% to 81%, with 1 false alarm in 17,291 real emails. Never sends, never deletes, one tap to undo.
>
> Code: https://github.com/hadrienbaradel/scam-shield
