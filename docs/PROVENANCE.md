# What was built during the hackathon

Scam Shield was written during the Meta Global AI Developer Hackathon. The event began with the kickoff livestream on **Monday, Oct 26, 2026**, announced by the organizers for "12:00 PM EST (9:00 AM PT)". Eastern clocks were on daylight time that day, so that is 12:00 PM EDT (16:00 UTC) if "EST" meant Eastern time, or 17:00 UTC if it was literal. We will ask the organizers to confirm and record their answer here.

All times below are Eastern daylight time (UTC−4) on Oct 26 unless stated. They come from the files' creation times and the git history, which anyone can check.

| Time (ET) | UTC | What happened |
|---|---|---|
| 12:02 PM | 16:02 | Empty project folder created |
| 12:54–12:55 PM | 16:54–16:55 | A throwaway first skeleton: a keyword-rules demo, a basic page and stylesheet, one test (12 files). It is not part of the product (see below). |
| 7:49–7:55 PM | 23:49–23:55 | The product's core written: detector, brand list, Muse Spark layer, link inspector, system prompt, test cases, PRD |
| 8:12 PM | 00:12 Oct 27 | First commit (`d43ced6`) imports that work |
| 8:13 PM onward | | Every later change is a commit in this repository: server, Gmail sync, guardians, web app, Android app, evaluation, fixes |

**What happened to the 12:54 PM skeleton:**
- Its rules engine, explanation and demo code, server and test were deleted in the second commit (`877a27d`, 8:13 PM).
- Its Gmail stub and page script were replaced by the real server and web app (`a285eb3`, `1b7bd99`).
- Its stylesheet was rewritten from scratch on Oct 27 (`git log -- public/styles.css`); no line of the original remains.
- What is left of it is boilerplate only: standard tags in `public/index.html` (doctype, `<head>`, meta charset and viewport, the stylesheet link, the header and its check-mark logo), five ordinary `.gitignore` entries (`node_modules/`, `.env`, `.DS_Store`, `*.log`, `.tokens.json`), and two headings in `README.md` ("Scam Shield", "What it does").

**Not code, used as data:**
- The real scam emails in `testcases/` were received by Hadrien. They are redacted test cases, not code.
- Public phishing datasets (Zenodo 8339691, an OpenPhish sample) were used for evaluation only. They are not in the repository (see [STATUS.md](STATUS.md)).

**Third-party code:** the npm dependencies listed in `package.json` and the Android dependencies in `android/`, under their own licences.
