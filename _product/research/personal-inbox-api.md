Keywords: messenger inbox, personal profile, professional mode, message requests, spam, instagram requests folder, allow access to messages, conversations api, standard access, advanced access, app review, data portability, export your information, social technologies mcp, threads, whatsapp coexistence, platform terms, automated access

# Reading a senior's own inbox through Meta APIs: what exists (research, 2026-11-04)

Asked by Vlad on Nov 4 ("scan all my messages", with a screenshot of his Messenger Message requests), under his rule that Prudence reads inboxes through Meta's APIs only, never a browser session or scraping. Checked against Meta's developer docs, help centres and terms on 2026-11-04 by a research agent (web only). Most developer pages show no "last updated" date; the terms pages do, given below.

## Bottom line

**Facebook.** No API reads what lands in a personal Messenger inbox. That holds with professional mode on or off, and covers the main inbox, Message requests and Spam.
- Meta's messaging APIs reach only Facebook Pages, Instagram professional accounts and WhatsApp Business numbers.
- The API for a person's own inbox (`/{user_id}/inbox` with `read_mailbox`) was deprecated in Graph API v2.4, in 2015.
- So the route for Facebook stays the one built in `specs/messenger-channel.md`: the senior forwards, pastes or screenshots the stranger's message (or the Message requests list) into a chat with the Prudence Page.
- A slow official route exists for later: Prudence as a "data portability" destination, the senior scheduling a daily "Export Your Information" transfer of their Messages. It needs outside vetting and Meta's review, and the export may miss encrypted chats, so it is not a hackathon item.

**Instagram.** A real automatic route exists.
- The senior's account must be professional (switching to Creator is free) and they turn on Allow Access to Messages.
- Then the Instagram API with Instagram Login sends every DM to the webhook and lists conversations, including the Requests folder where strangers land.
- The API does not say which folder a message came from; a follower check stands in for it.
- The catch is access: strangers have no role on the app, and Meta's docs and developer reports say their messages arrive only with Advanced Access for `instagram_business_manage_messages`, which needs App Review and Business Verification.
- For a demo: the senior's account and the "scammer" account both as testers on the app; App Review after the hackathon.
- Prudence must never reply from the senior's account: a reply moves the chat out of Requests and marks it Read.

**Muse Spark** (asked directly through `lib/llm` on Nov 4, and per `meta-ai-stack.md`): the Meta Model API sees only the prompt; its tools are function tools we define and one built-in web search (Responses API). It has no access to accounts, inboxes, message requests or account metadata, and cannot look an account up.

## 1. Can a professional-mode Facebook profile be connected like a Page? NO

- The Messenger Platform is for "a business' Facebook Page or Instagram Professional account" [1].
- The Messenger docs index has no page about professional mode, personal profiles, message requests or spam folders [2].
- The Conversations API is `GET /{PAGE-ID}/conversations?platform=messenger|instagram`, with a Page token from someone with the `MESSAGING` or `MODERATE` task, plus `pages_manage_metadata`, `pages_read_engagement` and `pages_messaging` [3].
- The Page conversations reference lists a `folder` parameter, but no values are documented [8].
- Webhooks are described only for "your Facebook Page or Instagram Professional account" [4].
- The only mention of a "professional mode profile" on developers.facebook.com is in the Live Video API, as a condition for going live (100 followers) [5].
- Meta's pro mode help lists what changes: insights, Moderation Assist, discovery, monetisation and public followers. Nothing about messaging, inbox access or apps [6].
- Meta's help on choosing between a Page and pro mode says a Page represents a business, pro mode shares updates from your own profile; nothing about messaging tools [7].
- With no endpoint, the questions about permissions, Message requests and role holders do not apply.

## 2. Instagram professional account: strangers' messages through the API? PARTLY

**What the API covers**
- Instagram has three inbox folders: Primary, General and Requests. "All new conversations from Instagram users who aren't followers of your app user will appear in the Requests folder" [9].
- The webhook fires when anyone messages the account; Meta's docs do not exclude Requests [9][11].
- The webhook carries the sender's Instagram-scoped ID and the message [9].
- "Inbox folders are not supported": neither the webhook nor the API says which folder a message is in [9][11].
- The Conversations API (Instagram Login) is `GET graph.instagram.com/{IG_ID}|me/conversations?platform=instagram`, then `/{CONVERSATION_ID}?fields=messages` and `/{MESSAGE_ID}` [10].
- Only the 20 most recent messages in a conversation can be read in detail [10].
- Requests conversations inactive for 30 days are not returned [10][11].
- Reading through the API does not mark messages Read [9][11]; Requests messages are not marked Seen until accepted [11].
- Replying through a third-party app moves the conversation to General [11].
- Stand-in for "stranger": the User Profile API returns `is_user_follow_business`, `false` for a non-follower [18].
- Unverified: whether Instagram's "Hidden requests" (its spam-filtered requests) reach the webhook. No Meta source found.
- A ManyChat community thread (April 2024 to February 2025) reports that messages landing in the business's own Requests folder did not trigger automations; unresolved, possibly specific to ManyChat [21].

**The setting the account holder turns on**
- Instagram Settings > Messages and story replies > Message controls > Connected Tools > Allow Access to Messages [13]; the Instagram Help article describes the same toggle (seen in a search snippet only; the live page did not render) [20].

**Permissions**
- Instagram Login: `instagram_business_basic` + `instagram_business_manage_messages`; no linked Page needed [9][15].
- Facebook Login for Business: `instagram_basic`, `instagram_manage_messages`, `pages_manage_metadata`, plus `pages_read_engagement` and `pages_show_list` for the `messages` webhook field [15][13].
- With Facebook Login, a Creator account must make one Conversations API call before it receives webhooks [11].

**Development mode and access**
- The app must be published (Live) to receive notifications [14][12]; Hey Prudence has been Live since Nov 4 (`messenger-platform.md`).
- To add an Instagram account in the dashboard, the account "must be public" [16].
- Standard Access covers "accounts you own or manage and have added to your app in the App Dashboard" [9][10]; the webhook setup table lists Advanced Access for Instagram Login [14]; "Instagram requires successful completion of the App Review process before your app can access live data" [16].
- Under Standard Access, "Webhooks will only be sent if the person using your app has a role on the app" [12]; "Apps with Standard Access can only interact with people who have a role on the app" [11].
- Messenger's webhook docs say the same: Standard Access gets notifications "from people who have a role on your app"; Advanced Access, after App Review, for everyone else [4].
- Advanced Access needs Business Verification [19]. Instagram App Review is "Not required" for an app used only by a business you own or manage [17].
- Developer reports agree: webhooks fire only for admin or tester senders [21]; Chatwoot saw `(#200) App does not have Advanced Access ... recipient user does not have role on app` [21].
- Verdict: the senior's messages from strangers will likely not arrive without App Review. Unverified live; the test is a message from an account with no role.

## 3. Other official routes to a personal inbox

- **Graph API `/me` inbox fields: NO.** v2.4 deprecated `GET /{user_id}/inbox` and `read_mailbox` [22]. The User reference still lists a `conversations` edge; its reference page returns 404 and no permission is listed that would open it to a person's token [23]. Behaviour with a person's token untested.
- **Download / Export Your Information: PARTLY, official but slow and vetted.** Developers can be listed as a destination in Export Your Information after onboarding [24]; data types include Facebook "Messages" (`MESSENGER_V2`) and Instagram "Messages" (`IG_MESSAGES`); transfers are started by the user and can repeat, up to `ONCE_A_DAY_FOR_THREE_YEARS`. Requirements [24]: a Level 2 entry in the Data Transfer Initiative (DTI) Trust Registry for archives, a verified business portfolio, OAuth 2.0 on our side, Meta's pre-approval review, an adapter for the Data Transfer Project. The archive schema shows "Your messages: Messages you've exchanged", no Requests or Spam sub-folders [25]; unverified whether they are included. Encrypted chats have their own download (computer only, Messenger > Chat history > Download chat backup) [26]; personal Messenger chats have been end-to-end encrypted by default since the rollout begun in December 2023 [26]; unverified whether an export transfer includes them (if not, it misses most person-to-person chats).
- **Messenger "Business Integration" (Facebook Login for Business): NO.** It grants access to business assets: Pages, Instagram accounts, ad accounts, WhatsApp Business accounts; no personal inbox [27].
- **Social Technologies MCP: NO.** Endpoint `https://mcp.facebook.com/devtools`, beta, 17 `devtools_*` tools: app settings, App Review, compliance, API usage, webhook topics and subscriptions, test payloads; the six new lifecycle tools create an app, list or add use cases, list or create business portfolios, link an app to a portfolio. No tool reads messages or user data [28]. The rename from Developer Tools MCP is dated Aug 18, 2026 only by a secondary source.
- **Threads API: NO.** The Threads docs index (49 entries) covers posts, replies, profiles, insights and web intents; no direct-message endpoint [29].
- **WhatsApp Cloud API for a personal number: NO.** "Coexistence" (Cloud API and the app on the same number) exists only for WhatsApp Business app numbers, through a Solution Partner or Tech Provider; it can sync the last 6 months of 1:1 chats and mirror them afterwards [30]. Personal WhatsApp is not covered.

## 4. Do Meta's terms forbid reading the inbox by automating the user's own browser? PARTLY

They forbid it, in the Terms of Service rather than in the Platform Terms or Developer Policies by name.
- Platform Terms 1.b (last updated Feb 3, 2026): developers also agree to the Meta Terms of Service [31].
- Terms of Service 3.2 (effective Jan 1, 2025) forbids to "access or collect data from our Products using automated means", logged in or not [33].
- Platform Terms 6.a.iii: "must not separately request or collect a Meta user's login credentials" [31].
- Developer Policies 2 (last updated Feb 3, 2026): respect "the limits we've placed on product functionality" [32].
- Automated Data Collection Terms (effective Oct 7, 2024): the definition covers "user-agents", and "such permission must be obtained separately through Meta's formal authorization process" [34].

## Sources (all accessed 2026-11-04)

1. https://developers.facebook.com/documentation/business-messaging/messenger-platform/overview.md
2. https://developers.facebook.com/documentation/business-messaging/messenger-platform/llms.txt
3. https://developers.facebook.com/documentation/business-messaging/messenger-platform/conversations.md
4. https://developers.facebook.com/documentation/business-messaging/messenger-platform/webhooks.md
5. https://developers.facebook.com/documentation/live-video-api/getting-started.md
6. https://www.facebook.com/help/2978174759158711
7. https://www.facebook.com/help/203141666415461
8. https://developers.facebook.com/docs/graph-api/reference/page/conversations/
9. https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api.md
10. https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/conversations-api.md
11. https://developers.facebook.com/documentation/business-messaging/instagram-messaging/overview.md
12. https://developers.facebook.com/documentation/business-messaging/instagram-messaging/webhooks.md
13. https://developers.facebook.com/documentation/business-messaging/instagram-messaging/get-started.md
14. https://developers.facebook.com/documentation/instagram-platform/webhooks/setup.md
15. https://developers.facebook.com/documentation/instagram-platform/webhooks/fields.md
16. https://developers.facebook.com/documentation/instagram-platform/create-an-instagram-app.md
17. https://developers.facebook.com/documentation/instagram-platform/app-review.md
18. https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api/user-profile.md
19. https://developers.facebook.com/docs/graph-api/overview/access-levels
20. https://help.instagram.com/ipad-app/791161338412168 (search snippet only)
21. Developer reports, not Meta: https://community.manychat.com/general-q-a-43/how-to-enable-manychat-to-respond-to-message-request-in-instagram-1205 ; https://yomotherboard.com/?p=234812 ; https://github.com/chatwoot/chatwoot/issues/11578 ; https://community.zapier.com/troubleshooting-99/facebook-messenger-10-cannot-message-users-who-are-not-admins-developers-or-testers-of-the-app-until-pages-messaging-permission-is-reviewed-and-the-app-is-live-29039
22. https://developers.facebook.com/docs/graph-api/changelog/version2.4
23. https://developers.facebook.com/docs/graph-api/reference/user/ (its `/user/conversations/` page returns 404)
24. https://developers.facebook.com/documentation/data-portability.md ; https://developers.facebook.com/documentation/data-portability/overview.md ; https://developers.facebook.com/documentation/data-portability/onboarding-guide.md ; https://developers.facebook.com/documentation/data-portability/deep-link-guide.md ; https://developers.facebook.com/documentation/data-portability/deep-link-params.md ; https://developers.facebook.com/documentation/data-portability/core-data-types.md
25. https://www.facebook.com/dyi/schema-bundle/?format=fb (schema generated 2026-11-04)
26. https://www.facebook.com/help/messenger-app/677912386869109 ; https://www.facebook.com/help/messenger-app/713635396288741 ; https://about.fb.com/news/2024/03/end-to-end-encryption-on-messenger-explained/ (Mar 28, 2024)
27. https://developers.facebook.com/documentation/facebook-login/facebook-login-for-business.md
28. https://developers.facebook.com/documentation/mcp/devtools-mcp ; https://ppc.land/metas-developer-mcp-gains-six-tools-that-let-ai-agents-create-apps/ (secondary)
29. https://developers.facebook.com/documentation/threads/llms.txt
30. https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users.md
31. https://developers.facebook.com/terms/dfc_platform_terms/ (last updated Feb 3, 2026)
32. https://developers.facebook.com/devpolicy/ (last updated Feb 3, 2026)
33. https://www.facebook.com/terms.php (effective Jan 1, 2025)
34. https://www.facebook.com/legal/automated_data_collection_terms (effective Oct 7, 2024)
