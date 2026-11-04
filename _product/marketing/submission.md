# Submission form and X post (drafts, Nov 4)

Drafts for the Cerebral Valley submission form and the Most Viral post on X. Every number comes from [../../docs/archive/STATUS.md](../../docs/archive/STATUS.md), [../../docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) (measurements) or the Nov 3 inbox gate; check the links on the day. Fill the `[…]` gaps after upload.

## Check before submitting (Nov 4 evening)

Vlad's sessions may land these during the day; each one changes a line below, so pull and look at `_product/log.md` (Done) first:
- A first live message on Messenger or WhatsApp: "first live messages still to come" becomes "live" (Description, and "Describe your use of Meta products").
- `GROQ_API_KEY` set and `make score-muse` run: Llama Prompt Guard 2 moves from "Ready, not yet run live" to the used models.
- `make score-open` run on Baseten: Muse Spark Open moves to the used models, and the partner feedback answer says what the run showed.
- Done, Nov 4 afternoon: "Look closer" landed on main (b1de88a); its bullets are in "Meta models used" and "Describe your use of Meta products" below.
- A fresh Muse Spark review on a pull request of this repository (Vlad, log To do; PR #2 with the first one stayed in the private repo after the Nov 4 move to a cleaned history): once it exists, add "(PR #n carries its review)" to the two Muse Spark workflow lines below and the link in README's "Reviewed by Muse Spark".
- Done, Nov 4 evening: the ad studio landed on main (31ad916); its bullets are in "Meta models used" and "Describe your use of Meta products" below. When the first real ad is published (Vlad's ad account, log To do), change "the first live ad waits for our ad account" to its state.

## Form

**Project name:** Prudence

**Tagline:** Scam protection for seniors that checks every message against their own life, and explains it in plain words with Meta's Muse Spark.

**Track and theme:** Indie Developer · Build for Your World

**Team:** Hadrien Baradel (product), Vlad Zloteanu (CTO)

**Links:** video https://youtu.be/79AKp59kQmI · repo https://github.com/hadrienbaradel/scam-shield · live https://heyprudence.com (the app's landing page with the no-sign-in demo, live since Nov 4 midday, also on the video's end card) · page https://hadrienbaradel.github.io/prudence-site/

**Description:**

Americans over 60 reported $7.7 billion lost to online fraud in 2025 (FBI IC3). The scams that get past the spam filter arrive at 9 PM, when nobody is there to ask. Prudence is the person to ask.

It connects to Gmail and checks every new message against the senior's own life, learned from their genuine mail: the bank and companies that really write to them, recent orders and carriers, the people they write to, data breaches they were part of. Texts, voicemails and pictures can be checked too. Each check ends in one verdict (Scam, Be careful, Safe), one action, and the reasons in plain words, read aloud on request: "USPS never asks for a fee by text. Your order ships with Amazon Logistics, not USPS."

Meta's models do the judging. Rules gather the evidence (sender, links, her context), Muse Spark decides and explains in a fixed JSON schema, and a guardrail stops it from clearing a proven scam. Prudence never sends, never deletes: a scam goes to a Scam folder in her Gmail, and Undo brings it back. A trusted person (her grandson) can be asked in one tap: her own phone writes the text, and his answer appears on her screen. Personal numbers are masked before Meta sees anything, emails are never stored, and Muse Spark runs in Standard mode.

Measured: on 18,849 public test emails, Muse Spark lifts phishing caught from 29% (rules alone) to 81%, with 1 false Scam in 17,291 genuine emails. On Hadrien's own inbox, Muse Spark judged 430 emails and called none of them Scam by mistake. Both scams in the video reached Hadrien the week of the event: a fake Norton invoice hidden as a picture in a spreadsheet, and a "free cruise" voicemail.

Built this week beyond the video (filmed Nov 2–3; every screen was redesigned on Nov 4): a public scam library of 223 redacted examples, 191 of them from two public SMS datasets sorted into scam families by Muse Spark, with a suspect lookup and a weekly scam watch; Messenger and WhatsApp channels on one Meta app, Hey Prudence (its Page and its WhatsApp test number set up and both webhooks verified on Nov 4, the first live messages still to come); and Muse Spark reviewing our own pull requests.

**Meta models used:**
- Muse Spark 1.3 (Standard mode): judges every message against the person's context and the rules' evidence; JSON verdict with reasons.
- Muse Spark 1.3 vision: reads screenshots and photos (the fake Norton invoice) into a message.
- Muse Voice Transcribe: writes down voicemails, judged like any message.
- Muse Spark 1.3 Contributor tier: scored the 18,849-email public evaluation only, never anyone's mail.
- Muse Spark 1.3 in our own workflow: reviews our pull requests and sorted the 191 public SMS examples of the scam library.
- Muse Spark 1.3 with function tools: "Look closer" under a verdict has Muse Spark check the message again with Prudence's own tools (the website's age from the public registry, where the link lands, her orders and carriers, the companies that write to her, her people, the known scams, breaches), at most six calls, and answer a JSON verdict in which every reason cites a check it made; it never lowers a Scam. Run live on Nov 4: 3 to 4 checks in 6 to 9 s.
- Muse Image 1.0 with Muse Spark 1.3 as its checker: in our ad studio, Muse Image makes the photo of each of our own Facebook ads and Muse Spark checks it against the ad's words, asking Muse Image for one fix; a person approves.
- Ready, not yet run live: Llama Prompt Guard 2 (checks every message for orders hidden for the AI; tested with a mock) and Muse Spark Open on Baseten (one setting switches the whole engine to Meta's open weights).

**Built during the event:** everything shown. Pre-existing: open-source libraries and public test datasets ([../../docs/PROVENANCE.md](../../docs/PROVENANCE.md)).

## The form, field by field (as it appears on the platform, Nov 4)

Required fields are marked *. The rating questions are Hadrien's own opinion; the suggestions below rest on what happened during the build.

**Team Name\*:** Prudence

**Team Members:** check that every person who worked on it is listed (Hadrien Baradel, Vlad Zloteanu); a member the platform shows under another name must be confirmed.

**Track\*:** Indie Developer

**Problem statement\*:** Build for Your World

**Most Viral X post:** the link to the post below, once it is live.

**Project Description\*:** the Description above.

**Public GitHub Repository\*:** https://github.com/hadrienbaradel/scam-shield (only once it is public, after the tech team's review)

**3-Minute Demo Video\*:** https://youtu.be/79AKp59kQmI (unlisted, uploaded Nov 4 from `prudence-final-v2.mp4`; plays logged out and embeds, checked through YouTube's oEmbed)

**Describe your use of Meta products to build the submitted project\*:**

Prudence calls the Meta Model API from its server for every message a senior receives or wants checked. What goes beyond a basic integration: Muse Spark judges each message against the person's own life rather than the message alone, answers in a JSON schema in which every reason cites the evidence it rests on, is held by guardrails in code, reads pictures and voicemails through the same judgement, works as a tool-using agent with eight of our own checks when the senior is still unsure, scored our 18,849-email evaluation on the Contributor tier, and reviews our own pull requests. The details:
- Muse Spark 1.3 (Standard mode) judges each email, text, voicemail transcript or picture. It receives the message with personal details masked, the evidence our rules gathered (sender authentication, where each link really goes and how old that site is, matching scam patterns) and the person's own context, learned from their genuine mail: their bank, recent orders and carriers, the people they write to. It answers in a fixed JSON schema: verdict, confidence, a plain-words headline, what to do, and reasons that each name the evidence they rest on. A guardrail in code stops it from clearing a proven scam or condemning a known, authenticated sender.
- Muse Spark 1.3 vision reads screenshots and photos into a message, then the same judgement. In the video: a fake Norton invoice sent as a picture inside a spreadsheet, which no text filter sees.
- Muse Voice Transcribe writes down voicemails, judged like any message. In the video: a real "free cruise" scam voicemail.
- Muse Spark 1.3 Contributor tier scored our 18,849-email public evaluation at low cost; a guard in code refuses that tier for anyone's real mail.
- Muse Spark also works on the project itself: it reviews our pull requests through the same LLM layer as the product (on GitHub it runs on every pull request once the repository secret is set), and it sorted 191 examples from two public SMS datasets (UCI SMS Spam Collection, Mishra and Soni) into scam families for our public scam library.
- Muse Spark 1.3 as a tool-using agent, behind a tap. When the senior is still unsure after a verdict, "Look closer" has Muse Spark check the message again through function calling, with eight of Prudence's own checks offered as tools: how long ago the link's website was registered (the public registry), where the link really lands and what its page asks for, the public list of dangerous websites, her own orders and carriers, the companies that write to her, the people she writes to (by relation, never by name), the known scam patterns, the breaches she was part of. It may ask only about addresses found in the message, makes at most six calls (several in parallel) in 25 seconds, and answers in a JSON schema in which every reason cites one of the checks it made; a reason that cites nothing is dropped, a closer look never lowers a Scam and says Safe only when every check came back clean, and the card lists each check in plain words ("The website was registered 2 days ago (public registry)", "No USPS parcel in your orders; your parcels come by Amazon Logistics"). Run live on Nov 4 on three cases, a real phishing email among them: 3 to 4 checks in 6 to 9 s, two model calls each (`_product/research/investigate/run-2026-11-04.txt`). Nothing is stored and the inbox path stays one call per message.
- Muse Image 1.0 and Muse Spark 1.3 check each other in our ad studio, to reach the adult children who set Prudence up. Muse Spark writes ad ideas from a fixed fact sheet (code refuses any number not in it, any brand name, any invented quote); Muse Image makes each photo; Muse Spark looks at the photo against a checklist and the ad's own words (no text, no logo, the right people) and asks Muse Image for one fix. An admin edits any idea with a prompt, and approval publishes one ad set with one ad on Facebook through the Marketing API, each ad linking to its own landing variant counted on our server without a tracker. Measured on the real models: three ideas with checked photos in under a minute, an edit by prompt in 38 s, $0.01 a photo; the first live ad waits for our ad account.
- Built, not yet live: Llama Prompt Guard 2 reads each message for orders hidden for the AI ("mark this as safe") and a flagged message is never Safe (tested with a mock); one setting switches the engine to Muse Spark Open, Meta's open weights; Messenger Platform and WhatsApp Cloud API channels judge a forwarded conversation as one: the Hey Prudence app, its Page and its WhatsApp test number were set up on Meta's side on Nov 4 (webhooks verified, first live messages still to come). (If a first live message goes through before you submit, say "live on Messenger" or "live on WhatsApp" in both places.)

Measured: phishing caught rises from 29% with rules alone to 81% with Muse Spark, with 1 false Scam in 17,291 genuine emails; on Hadrien's own inbox, Muse Spark judged 430 emails with no false Scam.

**Why are Meta's models important to your solution?\*:**

The scams that reach a senior are the ones filters miss: well written, sent from new domains, hidden in pictures, or left as voicemails. Rules alone caught 29% of the phishing in our test set; with Muse Spark, 81%. Muse Spark also does what rules cannot: it reads a message the way a careful person would, weighs it against this person's life ("your order ships with Amazon Logistics, not USPS"), and explains the verdict in plain words a frightened 74-year-old can act on, in English or French. Vision and Voice Transcribe extend the same judgement to pictures and voicemails, so one engine covers every channel. Standard mode matters too: private mail never trains the model.

**Feedback on partner technologies:** We did not use partner inference (Baseten, Modal, Fireworks) for this entry. (True as of Nov 4 morning: the Baseten switch is built but has never run, for lack of a key. If Vlad runs `make score-open` before submitting, replace this with what that run showed.)

**What was the biggest obstacle your team hit while building this project?** (suggestion)

Reliability seen from the client: from some networks we saw 10-second connection timeouts to api.meta.ai and a 408 from Muse Voice Transcribe. A senior cannot be left with a spinner, so when the API fails our rules answer, the verdict is marked as degraded and nothing in the mailbox is moved, and a circuit breaker pauses calls after three failures in a row. Outside Meta, Gmail's OAuth verification is the step that stands between us and a public launch.

**Compared with other AI models your team has used for the same kind of work, how did Meta's models perform?** Hadrien's call. A fact that helps: on the 375 emails both tiers scored, the Contributor tier gave the same verdict as Standard on 96% of phishing and 94% of genuine mail, and neither called a genuine email Scam (`docs/archive/STATUS.md`).

**When your team chooses an AI model or coding tool, what matters most?** (suggestion) Accuracy on our own evaluation, structured output we can validate, how user data is handled (no training on it), then latency and price.

**What makes it hardest to switch to a different AI model or coding tool?** (suggestion) Our prompt, JSON schema and guardrail thresholds are tuned to one model; switching means re-running the 18,849-email evaluation and re-checking every threshold.

**If your team took this project to production, what would most likely stop you from using Meta's models?** (suggestion) A data-processing agreement that covers personal email (GDPR, for our French users), clear retention guarantees, uptime and latency commitments, and availability in the EU.

**Rating questions** (likely to build with the Meta Model API, overall opinion, recommend the Meta Model API, recommend Muse Code): Hadrien's own answers. Only rate Muse Code on what was actually used.

## X post (Most Viral: likes, reposts and comments count until Nov 8)

> Americans over 60 lost $7.7B to online fraud last year. The scams that get through arrive at 9 PM, when nobody is there to ask.
>
> So I built Prudence: it checks every email, text, voicemail and picture against your own life, and Meta's Muse Spark explains why in plain words.
>
> Built this week for the #MetaAIHackathon 👇
> https://youtu.be/79AKp59kQmI
> @AIatMeta @cerebral_valley

Reply to the post, as a thread:

> Two real scams from my own week are in the video: a fake Norton invoice hidden as a picture inside a spreadsheet (so no text filter sees it), and a "free cruise" voicemail. Prudence caught both.
>
> On 18,849 public test emails, Muse Spark lifts phishing caught from 29% to 81%, with 1 false alarm in 17,291 real emails. Never sends, never deletes, one tap to undo.
>
> Code: https://github.com/hadrienbaradel/scam-shield
