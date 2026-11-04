# What was built during the hackathon

Everything in this repository was written during the Meta Global AI Developer Hackathon. No code from before the event is in it, and its git history starts during the event.

**When the event started.** The kickoff livestream was on Monday, Oct 26, 2026 at 12:00 PM ET (the participant guide: "All times are in Eastern Time (ET)"). The organizers answered on the hackathon Discord (#questions, Oct 26–27): "Building started when the Oct 26 kickoff ended (hacking was announced at 12:24 PM ET), so anything written before then counts as pre-existing." An organizer confirmed that answer. So building counts from **Oct 26, 12:24 PM ET (16:24 UTC)**, even though the guide's schedule lists a "Building period: Oct 27 – Nov 4".

All times below are Eastern daylight time (UTC−4) on Oct 26 unless stated. They come from the files' creation times and the git history, which anyone can check.

| Time (ET) | UTC | What happened |
|---|---|---|
| 12:02 PM | 16:02 | An empty project folder was created during the kickoff. The first files in it are from 12:54 PM. |
| 12:24 PM | 16:24 | Building starts (organizers' announcement) |
| 12:54–12:55 PM | 16:54–16:55 | A first rough draft: a keyword-rules demo, a basic page and stylesheet, one test (12 files). Almost all of it was replaced the same day (see below). |
| 7:49–7:55 PM | 23:49–23:55 | The product's core written: detector, brand list, Muse Spark layer, link inspector, system prompt, test cases, PRD |
| 8:12 PM | 00:12 Oct 27 | First commit (`d43ced6`) imports that work |
| 8:13 PM onward | | Every later change is a commit in this repository: server, Gmail sync, guardians, web app, Android app, evaluation, fixes |

**What happened to the 12:54 PM first draft** (written after the start, so it is hackathon work too; listed for completeness):
- Its rules engine, explanation and demo code, server and test were deleted in the second commit (`877a27d`, 8:13 PM).
- Its Gmail stub and page script were replaced by the real server and web app (`a285eb3`, `1b7bd99`).
- Its stylesheet was rewritten from scratch on Oct 27 for the new design (`git log -- public/styles.css`); no line of the original remains.
- What is left of it is boilerplate only: standard tags in `public/index.html` (doctype, `<head>`, meta charset and viewport, the stylesheet link, the header and its check-mark logo), five ordinary `.gitignore` entries (`node_modules/`, `.env`, `.DS_Store`, `*.log`, `.tokens.json`), and two headings in `README.md` ("Scam Shield", "What it does").

**Not code, used as data:**
- The real scam emails in `testcases/` were received by Hadrien. They are redacted test cases, not code.
- Public phishing datasets (Zenodo 8339691, an OpenPhish sample) were used for evaluation only. They are not in the repository (see [archive/STATUS.md](archive/STATUS.md)).

**Third-party code (open source, labelled as the organizers ask):** the npm dependencies listed in `package.json` and the Android dependencies in `android/`, under their own licences.

**Models:** Meta's Muse Spark (Meta Model API) judges every message and reads screenshots; the deterministic detector in `lib/` is our own code, written during the event.
