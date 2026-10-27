# Open-source scam and phishing detection (reference points)

Category: GitHub projects and papers; nothing joins email, SMS, personal context and a guardian.

- jannikhst/llm-phishing-detector ("MailCheck"): header analysis, link tests, ClamAV on attachments, LLM via OpenRouter for the text; "transparent, educational" reports. The closest in spirit to our evidence-plus-explanation design. https://github.com/jannikhst/llm-phishing-detector
- nkaps98/Phishing-Email-Detection-using-LLMs: LoRA fine-tune of Meta-Llama-3-8B on 19,000+ labelled emails versus few-shot and chain-of-thought prompting (3 stars). A precedent for a Meta-model judge if the Muse Spark API ever limits us. https://github.com/nkaps98/Phishing-Email-Detection-using-LLMs
- Abraham-shibesh21/scam-checker (2026 Maryland hackathon): screenshot in, Gemma 4 explains scam, suspicious, likely safe or not enough information. https://github.com/Abraham-shibesh21/scam-checker
- 1Okanguven/Phishing-Detection: XLM-RoBERTa classifier plus Mistral-written explanations (0 stars). https://github.com/1Okanguven/Phishing-Detection
- sbaresearch/benchmarking-SLMs with arXiv 2511.15434: small open models versus commercial services on phishing websites (late 2025). https://arxiv.org/pdf/2511.15434
- hyeonseo2/social-issue-aware-smishing-detector (Korea; updated April 2026): smishing detection fed by current social issues, the same idea as our threat-feed pattern cards.
- yogigodaraa/SOCShield: multi-provider LLM classification and IOC extraction for SOC teams.
- GitHub topic "phishing-detection": 454 public repositories in the Python view; mostly email and URL classifiers.
- Data and feeds we use or could: abuse.ch URLhaus, RDAP, HIBP, IC3 PSAs, cybermalveillance.gouv.fr; public corpora via scripts/eval-corpus.mjs.

## What Scam Shield can learn
- No open project does personal-context judging; that is the claim to make on stage.
- MailCheck's educational report is a UX precedent for the guardian summary.
- Licences and maintenance are unchecked; most repos have 0-3 stars. Reference, do not depend.

Accessed 2026-10-27.
