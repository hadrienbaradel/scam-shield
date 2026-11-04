Keywords: public database, scam library, corpora, datasets, licences, cc by, nazario, zenodo, uci sms, smishing, romance chats, robocalls, official sources, community galleries, signal-arnaques, bbb scam tracker, phishtank, repo as database

# Scam-example corpora, official sources and community galleries (research, 2026-11-04)

All URLs accessed 2026-11-04. "(unverified)" marks claims taken from search snippets or secondary pages, not confirmed at the source.

## Findings

### 1. Email datasets

| Dataset | Licence | Redistribute? | Real personal data? | Size / notes |
|---|---|---|---|---|
| Zenodo 8339691 "Phishing Email Curated Datasets" (Champa, Rabbi, Zibran) [S1] | CC BY 4.0 (record page) | Yes, with attribution. Caveat: the CC BY is the curators' wrapper; upstream Enron and SpamAssassin carry no licence (see rows below), TREC terms unchecked (unverified) | Yes: Enron is real corporate mail, SpamAssassin headers "as received" | 11 CSVs, 449 MB, 1995-2022: CEAS-08, Enron, Ling, Nazario (+Nazario_5), Nigerian_Fraud (+Nigerian_5), SpamAssassin, TREC-05/06/07. Per-source raw counts from the MeAJOR paper [S5]: Nazario 11,527; Nigerian 3,975; CEAS-08 39,154; Enron 517,401; Ling 2,893; SpamAssassin 6,047; TREC-05 92,189; TREC-06 37,822; TREC-07 75,419 |
| Figshare 25432108 "Seven Phishing Email Datasets" (same authors) [S2] | CC BY 4.0 (API record) | Yes | Same as above | 724 MB; Ling, SpamAssassin, TREC-05/06/07, Enron, CEAS-08 (no Nazario/Nigerian), raw + vectorised |
| Nazario phishing corpus, monkey.org [S3] | CC BY 4.0 (LICENSE.txt + README: "enabling derivative works and commercial use but does require attribution") | Yes | Partly: "Earlier mailboxes were anonimized (destination IPs and domain names) but later ones are not"; one personal inbox, hand classified | mbox files 2005-2007, 2018, then one folder per year 2015-2025 (phishing-2025 updated 2026-02-19, 18 MB). Still growing |
| CLAIR fraud emails (Radev 2008, ACL repository) [S4] | CC BY-SA 3.0 US | Yes, share-alike | Nigerian letters as received (names, addresses inside) | ">2,500" 419 letters from 1998, file FRAUD.gz. HF mirror tasksource/CLAIR_email_fraud declares cc-by-3.0 (mismatch) [S10] |
| Kaggle naserabdullahalam "Phishing Email Dataset" [S6] | CC BY-SA 4.0 (Kaggle Croissant metadata) | Yes, share-alike | Same upstream caveats | Files CEAS_08, Enron, Ling, Nazario, Nigerian_Fraud, SpamAssasin + merged phishing_email.csv; re-packaging of the Zenodo bundle |
| HF zefang-liu/phishing-email-dataset [S10] | LGPL-3.0 (mirror of Kaggle "Cyber Cop" set) | Odd licence for data; treat as unclear | Unknown | 10K-100K rows (Email4S = 18,650 in MeAJOR table, unverified link) |
| HF ealvaradob/phishing-dataset [S10] | Apache-2.0 | Yes | Unknown | 10K-100K rows, emails + SMS + URLs mixed |
| HF renemel/compiled-phishing-dataset; shaw/scambench-training [S10] | cc-by-sa-4.0 | Share-alike | Unknown; README is empty | 100K-1M rows / 10K-100K rows, aggregators without provenance |
| IEEE DataPort multi-source phishing/spam/ham (Dong, Taimur, 2026) [S7] | CC BY 4.0 | Yes, but download sits behind an IEEE DataPort subscription login | Includes phishing_pot and Enron | 546 MB CSV, features + text (unclear) |
| rf-peixoto/phishing_pot (GitHub) [S8] | CC BY-NC 4.0 (DATASET_CARD and LICENSE) | No commercial use; internal/research only unless the maintainer agrees | Real honeypot .eml; contributors told to replace sensitive data with `phishing@pot`; maintainer's own redaction not described | Count not stated; 483 stars, pushed 2026-10-28; accepts samples by email |
| SpamAssassin public corpus [S9] | None. "Copyright for the text in the messages remains with the original senders." | Grey: de facto redistributed for 20 years, no grant | Headers mostly as received, some obfuscation | 6,047 messages (1,897 spam) |
| Enron (CMU) [S11] | None; "please be sensitive to the privacy of the people involved" | Grey, de facto public (FERC release) | Yes, real employees' mail, some redacted on request | ~0.5M messages, ~150 users |
| Stanford M2122 "Email Scam Letters Collection" 2002-2014 [S12] | Reading-room access only; "permission to examine ... is not an authorization to publish" | No | Unknown | 50 GB |
| APWG eCrime Exchange [S13] | Member-only, Data Sharing Agreement; "distinctly not public open feeds - by design" | No | Holds reported phishing emails (headers, body, images) and SMS numbers | Not usable for a public library |
| MeAJOR corpus (arXiv 2507.17978) [S5] | Not stated for the data | Unknown | Built from Nazario, Nigerian, TREC | 135,894 labelled emails, no release URL on the page |

### 2. SMS / smishing datasets

| Dataset | Licence | Redistribute? | Personal data? | Size / notes |
|---|---|---|---|---|
| UCI SMS Spam Collection (Almeida, Hidalgo 2011) [S14] | CC BY 4.0 | Yes | Sample messages contain phone numbers; NUS volunteers were told messages would be public | 5,574 (747 spam, 4,827 ham); spam from Grumbletext UK forum. HF mirror ucirvine/sms_spam says licence "unknown" [S10] |
| Mishra, Soni "SMS Phishing Dataset for ML and Pattern Recognition" (Mendeley f45bkkt8pr) [S15] | CC BY 4.0 | Yes | Text transcribed from screenshots found online (Pinterest) | 5,971 (4,844 ham, 489 spam, 638 smishing); 4,753 rows overlap UCI (unverified, from a 2026 review) |
| Munoz, Islam balanced spam/smishing (Mendeley vmg875v4xs, 2025) [S16] | CC BY 4.0 | Yes | Largely LLM-generated (synthetic) | 3 x 3,397 = 10,191 |
| Smishtank (Timko, Rahman 2024, arXiv 2402.18430) [S17] | Paper page shows CC BY-NC-SA 4.0; dataset terms unverified (smishtank.com/dataset returned 404 today) | Non-commercial at best | Each message "includes information about the sender" | 1,090 community-submitted smishing samples (screenshot or text) |
| HF electricsheepafrica/africa-smishing-sms-phishing [S10] | "other" | Unclear | Unknown | 10K-100K rows, 2026 (content unverified) |
| MOZ-Smishing (Mozambique, Portuguese, AfricaNLP 2025) [S18] | Not found (unverified) | Unknown | Crowd-sourced | 552 smishing, 2,009 legitimate (unverified) |
| Singapore ScamShield [S19][S20] | No public dataset. Blocked-message database held by NCPC and the Anti-Scam Centre; model "not open-sourced" (GovInsider, unverified). scamshield.gov.sg Terms of Use clause 3.3.3 forbid to "reproduce, publish, distribute ... scrape, compile" the content | No | - | "Scam Vaccine" sends subscribers safe versions of new scams (homepage) |
| Kaggle SMS spam mirrors | Conflicting CC0 / CC BY-SA 4.0 labels (unverified) | Use UCI directly | - | - |

### 3. Phone-call and chat corpora

| Dataset | Licence | Real? | Notes |
|---|---|---|---|
| NCSU robocall-audio-dataset (Prasad, Reaves, TR-2023-1) [S21] | "The data itself is in the public domain" (recordings came from FTC cease-and-desist letters, Project Point of No Entry); README CC BY-ND | Yes, 1,432 real robocalls, Whisper transcripts | Best voice source: real audio + transcripts, redistributable |
| FTC Do Not Call reported-calls data [S22] | US government data, no licence text on page | Yes, complaint rows (number, date, subject, robocall flag), no message text | Daily CSV + API since 2020 |
| HF BothBosu/youtube-scam-conversations [S23] | apache-2.0 | 20 transcripts from 5 scam-bait YouTube channels | YouTube ToS forbids automated access and "reproduire, telecharger, distribuer" without written permission of YouTube and rights holders [S24]; the recordings belong to the creators. Not a lawful basis for republishing transcripts |
| HF BothBosu/Scammer-Conversation [S25] | apache-2.0 | Synthetic (gretelai), 1,000 rows | Other BothBosu sets are synthetic too (unverified) |
| HF menaattia/phone-scam-dataset; AmSpotNot1221/scam-call [S10][S26] | None declared | Unknown, no dataset card | 4,000 rows / unknown. Unusable without a licence |
| Paam1/ThaiScamCall; Atlas-AI-Labs/GCT-100K [S27] | - / apache-2.0 but "research and defensive purposes only" | TTS synthetic / partly synthetic | - |
| LoveFraud02 (Faber, U. Granada, Mendeley kmhvb4x5d8) [S28] | CC BY 4.0 | Yes, 83 real romance-scam chats, Jan 2021-Jun 2024, author posed as victim | No anonymisation statement; files named after scammers' fake names |
| "Love fraud conversations" (Faber, Mendeley fccb66s94k) [S29] | CC BY 4.0 | Yes, 73-75 fraudsters, ~898k words, Nov 2020-Apr 2024, Messenger/Instagram, plus 16 West-African scam "formats" | Same caveat |
| PreScam (arXiv 2605.12243) [S30] | Not stated | 11,573 conversations structured from 177,989 user-submitted reports (platform unnamed on page; BBB per search, unverified) | No release URL on the page |
| COVA / COVA-X (Lochstampfor, Roy) [S31] | Not stated | Synthetic, 3,201 / 10,985 elder-scam conversations, 8 categories | "released upon publication" (unverified) |
| Pig butchering: Oak, Shafiq SOUPS 2025 [S32]; Acharya, Holz 2412.15423 [S33] | - | 26 interviews, no dataset / 3,200+ victim narratives from public abuse databases (unverified) | Narratives, not chats |
| "Hi mum" SMS (UCL/Microsoft, UK operator data) [S34]; Surrey WhatsApp junk set (2.6M msgs, Indian public groups, by request) [S35] | Not public / by request | - | No public "hi mum" corpus found |
| Korea: FSS voice-phishing set used by hackathons; NAACL 2025 set of 94,602 phishing samples "available upon request" [S36] | Not open (unverified) | Real Korean calls | - |

### 4. Official bodies

| Body | Publishes message text / screenshots? | Licence (verbatim where fetched) |
|---|---|---|
| US FTC [S37][S38] | Consumer alerts are prose with short quoted phrases (Jan 2026 loan-text alert quotes "Just reply YES to confirm..."); screenshots occasional (unverified). Robocall audio released via cease-and-desist letters (feeds NCSU set) | "Most material on the FTC's website is considered work of the United States Government" (17 U.S.C. 105), attribution asked; third-party material excluded |
| FBI IC3 [S39] | PSA I-041825 (Apr 2025): prose, no verbatim message, banner image only | US government work, public domain (statement on ic3.gov unverified) |
| CISA | Guidance, not corpora (unverified) | US government work (unverified) |
| cybermalveillance.gouv.fr (GIP ACYMA) [S40] | Fiches with annotated example SMS/emails (e.g. fiche reflexe hameconnage, Feb 2026; examples not inspected) | "couverts par la Licence ouverte / open licence Etalab, en version 2.0, sauf mention explicite"; logos and third-party photos excluded; credit the source; "repartager les productions sous les memes conditions" |
| UK NCSC [S41] | Few real examples (SERS statistics) (unverified) | "Content on the Websites is, unless stated otherwise, subject to Crown copyright" reusable under OGL v3.0; logos and third-party images excluded |
| UK Action Fraud / reportfraud.police.uk [S42] | Alerts with example wording (unverified) | "should not be copied or re-used without the explicit permission of the City of London Police" (search snippet; page returned 403) |
| Australia Scamwatch (ACCC) [S43][S44] | Yes: alerts quote example texts and images credited to Scamwatch are reused by the press (unverified for images). Individual reports not published | CC BY 3.0 AU on the disclaimer page (search snippet; page 403); Little Black Book 2023/2024 says CC BY 4.0 |
| Canada CAFC [S45][S46] | Fraud A-Z and "Frauds by medium" pages, no screenshots on the home page | Government of Canada terms: non-commercial reproduction free with attribution; "you may not reproduce materials ... for the purposes of commercial redistribution" without permission; CAFC's own terms page only protects logos |
| Singapore ScamShield / ScamAlert [S19][S20] | "Latest Scam Alert" paraphrases, Monthly Scams Bulletin; scamalert.sg now redirects to scamshield.gov.sg | Reproduction, publication and scraping forbidden (Terms of Use 3.3.3) |
| Europol [S47] | Campaigns, not corpora | 2014 publications: "Reproduction is authorised provided the source is acknowledged"; current legal-notice page is a JS app (unverified) |

### 5. Community galleries and report sites

| Site | Collects | Moderation | Open data? | Size |
|---|---|---|---|---|
| Signal-Arnaques (HERETIC SAS, Legros and Boisseau, since 2014; also ScamDoc) [S48][S49] | Type, scammer pseudonym, email, phone, site, description | A-posteriori moderation, deletions for legal breaches (user forum threads, unverified) | No; site returns 403 to non-browser clients | "450 000 arnaques", ~1M visitors/month (July 2021 article) |
| BBB Scam Tracker (US/Canada) [S50] | Report with scam text, loss, contact used | "BBB reviews each report before it is published"; local BBBs vet with software + staff (2017 Senate testimony) | Searchable; no API or bulk download found; bbb.org blocks fetches | 83,000 published reports by 2017 (dated) |
| PhishTank (Cisco Talos) [S51] | Phishing URLs only | Community voting; "The number of people required to verify a phish ... will always be more than one" | Free API with key, commercial use "Yes, it is OK." | Not shown |
| Scamwatch reports [S43] | Reports to ACCC/NASC | Internal | Aggregates only (Targeting Scams reports, unverified) | - |
| Which? Scam Sharer / Scam Alert [S52] | Shared with Which? experts, newsletter alerts | Editorial | No | - |
| r/Scams [S53] | Posts/screenshots; rules forbid PII and scambaiting | Volunteer mods, "We review 100% of the reports" | Reddit API terms only; subscriber count not retrieved | - |
| Scam Sniffer scam-database [S54] | Web3 phishing hostnames | Maintainers' pipeline; issues only | GPL-3.0 JSON, 7-day delay | 358k+ domains (Oct 2026) |
| ScamSearch.io [S55] | Emails, phones, usernames, crypto addresses, sites | No moderation statement; anonymous operator | Free search, paid premium/API | Claims "Over 4 million" and "Over 1 Million" scammers on the same page |
| phishing.org (KnowBe4) [S56] | Redirects to KnowBe4 resource center; prose, no submissions | - | No | - |
| University "Phish Bowls" (Cornell, UT Tyler, Berry, UVic, Toronto, Montclair, WKU) [S57] | Real reported campus phishing emails, malicious parts removed | IT-security staff curate, dedupe | No licence stated | Dozens to hundreds each (unverified) |
| Malwarebytes Scam Guard / Scam Number Check [S58] | In-app submissions to the threat-intel team; number flags | Vendor | No | - |
| ScamAdviser report form [S59] | Category, loss range, free text, "evidence"; optional publication "for the entire Scamadviser community", anonymous allowed | No statement | No (commercial API elsewhere, unverified) | - |
| Chainabuse (TRM Labs) [S60] | Crypto scam reports with narratives | TRM | API on request | "nearly 700,000" victim reports (undated) |
| Smishtank [S17] | Community smishing submissions | Academic team | See section 2 | 1,090 |

### 6. "The repo is the database" precedents

| Repo | Content | Intake | Licence | Activity (GitHub API) |
|---|---|---|---|---|
| MetaMask/eth-phishing-detect [S61][S62] | src/config.json blocklist/allowlist of domains | Pull requests via CLI (`yarn add:blocklist`), audited with `git log -S` | "DON'T BE A DICK PUBLIC LICENSE" | 1,348 stars, pushed 2026-11-04 |
| Phishing-Database/Phishing.Database [S63] | 497k phishing domains, 784k links | Issue templates; data changes in a separate source repo (`additions/permanent/`) | MIT | 1,638 stars, pushed 2026-10-02 |
| scamsniffer/scam-database [S54] | Domains JSON | Issues only; "pull requests that edit them are overwritten" | GPL-3.0 | 270 stars, pushed 2026-11-03 |
| Discord-AntiScam/scam-links [S64] | 24-30k scam domains (list.json) | Issue templates "False Positive", "URL Request", Discord channel | None | Archived 2026-10-15 |
| jarelllama/Scam-Blocklist [S65] | Domains | Issues labelled "add domains" | GPL-3.0 | 107 stars, pushed 2025-11-24 |
| CryptoScamDB/blacklist [S66] | YAML/JSON scam URLs and Twitter profiles | PRs (historically) | None | 60 stars, last push 2023-04-29 (dormant) |
| rf-peixoto/phishing_pot [S8] | Real phishing .eml files | Samples by email | CC BY-NC 4.0 | 483 stars, pushed 2026-10-28 |
| techafreshh/magpie [S67] | "Community scam-message radar": 360 anonymised seed texts in data/seeds/corpus.jsonl (no verbatim upstream text), /report route, Qdrant search | App reports, PR #34 added the seed corpus | None | 0 stars, pushed 2026-11-01. Closest to our idea, tiny |
| Hugging Face | No community-contributed scam-message dataset found; aggregators (shaw/scambench-training, cc-by-sa-4.0) are single-author [S10] | HF PRs/discussions exist but unused here | - | - |

Gap: every message-text repo is single-maintainer (Nazario, phishing_pot) or a domain list; no categorised, multi-channel (email, SMS, chat, voice, letter), openly licensed library with PR/issue-form intake exists.

### Decision notes

- Redistributable with commercial use: Zenodo/Figshare bundles and Nazario (CC BY 4.0), UCI and Mishra-Soni SMS (CC BY 4.0), Faber romance chats (CC BY 4.0), NCSU robocalls (public domain), FTC/IC3 text (US public domain), cybermalveillance (Etalab 2.0), NCSC (OGL v3), Scamwatch (CC BY 3.0 AU). Share-alike strings: Kaggle bundle and CLAIR (CC BY-SA), which would force the derived library under SA.
- Internal use only: phishing_pot (NC), Smishtank (NC-SA), APWG, Stanford, ScamShield SG, Action Fraud, Canada for commercial use, YouTube transcripts, Reddit, Signal-Arnaques and BBB (no licence, bots blocked).
- Personal data is in most "real" sets (Enron mail, SpamAssassin headers, Nazario's later mailboxes, UCI phone numbers, Faber chats unredacted, Smishtank sender info). A public library needs a redaction pass before publishing, whatever the licence says; a scammer's phone number or email is still personal data under GDPR (our reading, not legal advice).

## Sources

- [S1] https://zenodo.org/records/8339691 — 2026-11-04
- [S2] https://api.figshare.com/v2/articles/25432108 — 2026-11-04
- [S3] https://monkey.org/~jose/phishing/ (+ LICENSE.txt, README.txt) — 2026-11-04
- [S4] https://www.aclweb.org/aclwiki/CLAIR_collection_of_fraud_emails_(Repository) — 2026-11-04
- [S5] https://arxiv.org/html/2507.17978v2 and https://arxiv.org/abs/2507.17978 — 2026-11-04
- [S6] https://www.kaggle.com/datasets/naserabdullahalam/phishing-email-dataset/croissant/download — 2026-11-04
- [S7] https://ieee-dataport.org/documents/multi-source-phishing-spam-ham-email-dataset-spf-url-and-structural-features — 2026-11-04
- [S8] https://github.com/rf-peixoto/phishing_pot (+ DATASET_CARD.md, LICENSE) — 2026-11-04
- [S9] https://spamassassin.apache.org/old/publiccorpus/readme.html — 2026-11-04
- [S10] https://huggingface.co/api/datasets/<id> for zefang-liu/phishing-email-dataset, ealvaradob/phishing-dataset, renemel/compiled-phishing-dataset, tasksource/CLAIR_email_fraud, electricsheepafrica/africa-smishing-sms-phishing, ucirvine/sms_spam, shaw/scambench-training, menaattia/phone-scam-dataset, AmSpotNot1221/scam-call — 2026-11-04
- [S11] https://www.cs.cmu.edu/~enron/ — 2026-11-04
- [S12] https://oac.cdlib.org/findaid/ark:/13030/c88p66vv/admin/ — 2026-11-04
- [S13] https://apwg.org/ecx — 2026-11-04
- [S14] https://archive.ics.uci.edu/dataset/228/sms+spam+collection — 2026-11-04
- [S15] https://data.mendeley.com/datasets/f45bkkt8pr/1 — 2026-11-04
- [S16] https://data.mendeley.com/datasets/vmg875v4xs/1 — 2026-11-04
- [S17] https://arxiv.org/abs/2402.18430 ; https://smishtank.com/ (dataset page 404) — 2026-11-04
- [S18] https://aclanthology.org/2025.africanlp-1.23 (search snippet) — 2026-11-04
- [S19] https://scamshield.gov.sg/terms-of-use/ — 2026-11-04
- [S20] https://www.scamshield.gov.sg/ ; https://govinsider.asia/intl-en/article/meet-singapores-latest-weapon-against-scams-open-government-products-scamshield (snippet) — 2026-11-04
- [S21] https://github.com/wspr-ncsu/robocall-audio-dataset — 2026-11-04
- [S22] https://www.ftc.gov/policy-notices/open-government/data-sets/do-not-call-data — 2026-11-04
- [S23] https://huggingface.co/datasets/BothBosu/youtube-scam-conversations — 2026-11-04
- [S24] https://www.youtube.com/t/terms — 2026-11-04
- [S25] https://huggingface.co/datasets/BothBosu/Scammer-Conversation — 2026-11-04
- [S26] https://huggingface.co/datasets/menaattia/phone-scam-dataset — 2026-11-04
- [S27] https://huggingface.co/datasets/Paam1/ThaiScamCall ; https://huggingface.co/datasets/Atlas-AI-Labs/GCT-100K/blob/main/README.md (snippets) — 2026-11-04
- [S28] https://data.mendeley.com/datasets/kmhvb4x5d8/1 — 2026-11-04
- [S29] https://data.mendeley.com/datasets/fccb66s94k/1 — 2026-11-04
- [S30] https://arxiv.org/abs/2605.12243 — 2026-11-04
- [S31] https://arxiv.org/pdf/2604.11752 ; https://arxiv.org/pdf/2606.06879 (snippets) — 2026-11-04
- [S32] https://arxiv.org/abs/2503.20821 — 2026-11-04
- [S33] https://arxiv.org/html/2412.15423v1 (snippet) — 2026-11-04
- [S34] https://discovery.ucl.ac.uk/10197841/1/Sharad_USENIX_StopScamsUK_SMS_Scams.pdf (snippet) — 2026-11-04
- [S35] https://netsys.surrey.ac.uk/datasets/whats-app (snippet) — 2026-11-04
- [S36] https://preview.aclanthology.org/vol-to-evt/2025.naacl-industry.18.pdf ; https://aclanthology.org/2026.lrec-1.585/ (snippets) — 2026-11-04
- [S37] https://www.ftc.gov/site-information/website-policy — 2026-11-04
- [S38] https://consumer.ftc.gov/consumer-alerts/2026/01/can-you-spot-fake-loan-text-scam — 2026-11-04
- [S39] https://ic3.gov/PSA/2025/PSA250418 — 2026-11-04
- [S40] https://www.cybermalveillance.gouv.fr/mentions-legales ; https://www.cybermalveillance.gouv.fr/medias/2026/02/260129_FicheReflexe_Hameconnage.pdf (not opened) — 2026-11-04
- [S41] https://www.ncsc.gov.uk/section/about-this-website/terms-and-conditions — 2026-11-04
- [S42] https://www.reportfraud.police.uk/terms-conditions/ (search snippet; fetch 403) — 2026-11-04
- [S43] https://www.scamwatch.gov.au/about-us/using-our-website/disclaimer-and-copyright (snippet; fetch 403) — 2026-11-04
- [S44] https://www.scamwatch.gov.au/system/files/little-book-scams-2024-english.pdf (snippet) — 2026-11-04
- [S45] https://www.canada.ca/en/transparency/terms.html — 2026-11-04
- [S46] https://www.antifraudcentre-centreantifraude.ca/index-eng.htm ; .../terms-avis/index-eng.htm — 2026-11-04
- [S47] https://www.europol.europa.eu/iocta/2014/copyright.html (snippet) ; https://www.europol.europa.eu/legal-notice (JS shell) — 2026-11-04
- [S48] https://monimmeuble.com/actualite/arnaques-en-ligne-une-plateforme-collaborative-pour-les-signaler (2021-07-02) — 2026-11-04
- [S49] https://www.signal-arnaques.com/forum/view/7307 and /forum/view/3341 (snippets; site 403 to fetch) — 2026-11-04
- [S50] https://www.aging.senate.gov/imo/media/doc/SCA_Barton_10_4_17.pdf ; https://www.bbb.org/scamtracker (snippets; fetch 403) — 2026-11-04
- [S51] https://phishtank.org/faq.php — 2026-11-04
- [S52] https://act.which.co.uk/page/77103/action/1 (snippet) — 2026-11-04
- [S53] https://reddit.sentinel-team.org/posts/1sxh4mc/snapshots/2026-04-28T01%3A21%3A43.295186Z (snippet) — 2026-11-04
- [S54] https://github.com/scamsniffer/scam-database — 2026-11-04
- [S55] https://www.scamsearch.io/ — 2026-11-04
- [S56] https://www.phishing.org/phishing-examples -> https://www.knowbe4.com/resource-center/phishing — 2026-11-04
- [S57] https://it.cornell.edu/node/3676 ; https://www.uttyler.edu/offices/information-security/phishbowl/ ; https://cybersecurity.berry.edu/phishbowl-1/ (snippets) — 2026-11-04
- [S58] https://help.malwarebytes.com/hc/en-us/articles/36738112474395-Using-Scam-Guard-to-detect-threats (snippet) — 2026-11-04
- [S59] https://www.scamadviser.com/report-a-scam — 2026-11-04
- [S60] https://www.trmlabs.com/post/combating-crypto-scams-the-power-of-community-reports-and-on-chain-analysis ; https://docs.trmlabs.com/guides/chainabuse/protecting-users (snippets) — 2026-11-04
- [S61] https://github.com/MetaMask/eth-phishing-detect — 2026-11-04
- [S62] https://raw.githubusercontent.com/MetaMask/eth-phishing-detect/main/LICENSE — 2026-11-04
- [S63] https://github.com/mitchellkrogza/Phishing.Database — 2026-11-04
- [S64] https://github.com/Discord-AntiScam/scam-links — 2026-11-04
- [S65] https://github.com/jarelllama/Scam-Blocklist (GitHub API) — 2026-11-04
- [S66] https://github.com/CryptoScamDB/blacklist (+ GitHub API) — 2026-11-04
- [S67] https://github.com/techafreshh/magpie — 2026-11-04
