Keywords: breach, have i been pwned, hibp, xposedornot, leakcheck, hudson rock, infostealer, data breach lookup, free api, privacy

# Breach lookup sources (2026-11-04)

Which public list can tell a senior that their email address was in a known breach, what it costs, and what it says about what leaked. Each endpoint below was called live on Nov 4 with a throwaway address (`test@example.com`); the decision is in `feasibility.md` #17 and the behavior in `specs/breach-exposure.md`.

| Source | Key | Limits | Price | Per breach: what leaked | Verdict |
|---|---|---|---|---|---|
| Have I Been Pwned, search by email (`/api/v3/breachedaccount/{email}`) | paid | 10 a minute on Core 1 | $4.39 a month, billed $52.68 a year; "checking individual email addresses for your own users is permitted on any plan" | yes, including "Bank account numbers" (Bouygues 2025, Free Mobile 2024, La Poste Mobile 2022) | used when `HIBP_API_KEY` is set |
| Have I Been Pwned, breach catalogue (`/api/v3/breaches`) | none | none stated | free | yes: 1,049 breaches with title, domain, date and data classes | used without a key, to name a breach and complete what leaked |
| XposedOrNot (`api.xposedornot.com/v1/breach-analytics?email=`) | none | 2 a second, 25 an hour, 100 a day per IP; "for personal and low-volume use"; paid xonAPI+ for products | free | yes (796 breaches), but Bouygues 2025 and Free 2024 are listed without bank account numbers; names are compact ("BouyguesTelecom") | used without a key, for which breaches hold the address |
| LeakCheck public (`leakcheck.io/api/public?check=`) | none | 1 a second | free; commercial use needs a "Powered by LeakCheck" link; Pro from $9.99 a month | sources and dates only; the data fields are one aggregate list for the whole answer | not used: no per-breach data classes |
| Hudson Rock Cavalier (`cavalier.hudsonrock.com/api/json/v2/osint-tools/search-by-email`) | none | unstated | free | infostealer infections, not breaches: machine names, masked passwords and logins | out of scope: another question (an infected computer), and nothing a senior should read |
| HPI Identity Leak Checker, University of Bonn Leak Checker | none | n/a | free | sent by email to the address owner only | no API |
| Mozilla Monitor, Google's dark web report, Proton Pass monitoring | n/a | n/a | n/a | resell HIBP or stay closed | no public API |

What the live calls showed:
- XposedOrNot, `test@example.com`: 215 breaches, among them BouyguesTelecom 2025 (email, names, phone numbers, dates of birth, physical addresses), Free 2024, Orange 2025, LaPoste 2022, Boulanger 2024, Cultura 2024, LeSlipFrancais 2024, Intersport 2025. A no-match answers 404 `{"Error":"Not found"}` on `check-email`, and all-null fields with 200 on `breach-analytics`.
- HIBP catalogue: BouyguesTelecom 2025 and FreeMobile 2024 carry "Bank account numbers"; NationalPublicData 2024 and AllegedATT 2021 carry "Government issued IDs". Names match XposedOrNot's after stripping case and punctuation (BouyguesTelecom, LeSlipFrancais, Boulanger, Cultura); Free (XON) vs FreeMobile (HIBP) does not.
- LeakCheck public: 1,648 hits, 229 sources with a month each, 22 field names aggregated.
- Hudson Rock: two infected machines dated Nov 1, 2026 with masked passwords.

Privacy: every option sends the senior's address to a third party, so the lookup runs only on the senior's tap, with one sentence saying what is sent (feasibility #17; Limited Use allows a transfer for a visible feature with consent). XposedOrNot's terms place a product on the paid tier; the free tier covers the demo and a handful of users, then a Have I Been Pwned key ($4.39 a month) is the cheaper step.

## Sources
- https://haveibeenpwned.com/Subscription (accessed 2026-11-04)
- https://haveibeenpwned.com/API/v3 (accessed 2026-10-27)
- https://xon-beta.pages.dev/api_doc and https://github.com/XposedOrNot/XposedOrNot-API (accessed 2026-11-04)
- https://docs.leakcheck.io/overview (accessed 2026-11-04)
- https://www.hudsonrock.com/llms.txt and https://github.com/khast3x/h8mail/issues/171 (accessed 2026-11-04; `cavalier.hudsonrock.com/docs` answered 403)
- https://identeco.de/en/blog/german-alternative-hibp/ (accessed 2026-11-04)
- https://www.ionos.com/digitalguide/e-mail/e-mail-security/has-my-e-mail-been-hacked-these-tools-reveal-the-truth (accessed 2026-11-04)
