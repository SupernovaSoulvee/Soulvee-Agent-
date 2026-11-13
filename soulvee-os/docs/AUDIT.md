# Audit: Soulvee OS against your build protocol

Done on 12–13 November 2026. The question: can you run, fix and extend Soulvee OS without the person who built it?

## Result

- **19 checks:** your 15 protocol rules, plus 4 ownership questions (run it, fix it, extend it, keep the data safe).
- **Before:** 1 passed, 8 partly, 10 failed.
- **After:** 18 pass, 1 partly. The one left is data safety: business records still live in one browser per device. A weekly backup reminder now protects them, and moving them to the server is first on the list of what's next.
- **The app itself held up well.** It asks before deleting or restoring, never publishes without your approval, and shows money in naira. Most failures were in what surrounds the app: missing documents, tests kept outside the project, and tests that could reach your real keys.
- **Proof:** 363 automatic checks pass, 42 of them written this session: 36 for the guardrails and 6 for backups. GitHub now runs them on every change.

## Before any work starts

1. **Restate the job in one sentence and wait for a yes.** Before: fail. It wasn't written down anywhere, so it depended on you pasting the protocol each time. Now: pass. `CLAUDE.md` holds your protocol, and Claude reads it at the start of every session in this folder.
2. **Name the one project and refuse scope creep.** Before: fail. The repository is mostly opencode, the tool Soulvee OS was forked from, and its `AGENTS.md` tells sessions to use opencode's conventions (Bun, TypeScript), which are wrong for Soulvee OS. Now: pass. `CLAUDE.md` names the `soulvee-os` folder as the only project and says the root `AGENTS.md` doesn't apply. New ideas go to "What's next" in the build log instead of being built.
3. **Flag guesses.** Before: partly. Platform rules and prices were marked as third-party reports, but the docs said "only the server's user can read" the accounts file on every computer, which isn't true on Windows. Now: pass. That's corrected in the README and the platforms guide, and every new price says where it comes from. The WhatsApp reply charge is marked as unconfirmed, because Meta's own rate card couldn't be reached from this session.

## While building

4. **Every step shaped as What / Why / Then do it.** Before: fail, because it wasn't recorded. Now: pass. It's in `CLAUDE.md`, including your point that "Why" means what the step unlocks for the business.
5. **Stop before anything that costs money, touches live client data or can't be undone.** Before: fail. The app itself asks first, but the server read `.env` even while tests ran, so on your computer the tests could have used your real AI credit and posted to your real accounts. Now: pass. The test runner tells the server to skip `.env` and passes on none of your settings. A new check proves that refused requests never reach Claude.
6. **Every file justified before it exists.** Before: fail. There was no file map; each file's purpose lived only in code comments. Now: pass. `docs/FILE-MAP.md` gives every file one line on why it exists and what breaks without it, and `CLAUDE.md` makes keeping it current part of the job.
7. **Every command explained before it runs.** Before: partly. The README listed commands with terse comments and gave only the Mac version of the copy command. Now: pass. Each command in the README says what it does, with the Windows version, and the owner's guide walks through every step.
8. **Every agent or subagent explained.** Before: partly. The app's AI Agent already states what each of its tools can do, and that it drafts but never sends, publishes or marks anything paid. The rule for sessions wasn't written down. Now: pass, through `CLAUDE.md`.
9. **A six-word definition for every developer term.** Before: fail. The README used about 25 undefined terms, among them OAuth (16 times), webhook (26) and API (46). Now: pass. `docs/GLOSSARY.md` defines 91 terms in exactly six words each (checked by a script), the README links to it in its first lines, and the owner's guide defines each term where it first appears.
10. **Explanations of 2–3 sentences.** Before: partly. The guides were mostly short, but some README entries ran to six sentences. Now: pass for everything written for you. The README stays the detailed reference, and the owner's guide is the short version.
11. **Say directly when something won't work or will cost later.** Before: pass. The guides already explained Reddit's approval, Signal's missing official API, TikTok going through Buffer and X's charges. Still a pass, and this audit adds one: a post that falls due while the server is off goes out as soon as it restarts, even days late. That's in the build log as the next fix, with a recommendation.

## Formatting

12. **Decisions and numbers first.** Before: partly. The README opens with a feature list, and no running cost was written down anywhere. Now: pass. The owner's guide opens with the numbers: 10 tabs, 10 platforms, 363 checks, and about ₦17,000 a month on your own computer or ₦27,000 hosted.
13. **Money in naira.** Before: partly. The app shows naira everywhere, but the guides gave the only prices in dollars. Now: pass. Every price is in naira, with the exchange rate used (₦1,345 to the dollar, early November 2026).
14. **ClickUp-bound writing pastes cleanly.** Before: fail. There was nothing ready for ClickUp, and the guides rely on tables. Now: pass. The owner's guide, build log, glossary, file map and this audit use only headings, short paragraphs and lists.

## End of the session

15. **A build log: what exists, what it does, how to run it, what's next.** Before: fail. Now: pass. `docs/BUILD-LOG.md` has this session's entry and a short history of the earlier sessions, and `CLAUDE.md` makes it part of ending every session.

## The goal: owning the system

16. **Can you run it?** Before: partly. The README's steps assumed a developer. Now: pass. The owner's guide covers installing, starting, stopping, using it on your phone and your weekly routine.
17. **Can you fix it?** Before: fail. The tests lived in a temporary workspace that disappears when a session ends, and troubleshooting covered only the AI. Now: pass. 363 checks live in the project and run with `npm test`. GitHub runs them on every change, the owner's guide lists 10 common problems with fixes, and a maintenance calendar covers expiring sign-ins and software deadlines.
18. **Can you extend it?** Before: fail. Nothing said where things live, and the interface is one file of about 3,000 lines. Now: pass. The file map includes a guide to that file's sections, the owner's guide says where common changes go, and Claude Code follows your protocol through `CLAUDE.md`.
19. **Is the data safe?** Before: partly. Backup and restore existed, but nothing reminded you to use them, and records live in one browser per device. Now: partly. Command asks for a backup when there's none from the last 7 days, and a restored device counts the file as its latest backup. The proper fix, storing records on the server, is next in the build log.

## Sources for the prices

- Exchange rate: [CurrencyBeacon](https://currencybeacon.com/rates/USD/NGN) and [MoneyExchangeRate](https://moneyexchangerate.org/currencyexchange/usd/ngn/1500), early November 2026.
- Claude Opus 5.5 (US$4 per million tokens read, US$20 written): Anthropic's model price table, November 2026.
- Images (US$0.053 at medium quality): [Pixazo's breakdown of OpenAI's rates](https://www.pixazo.ai/blog/gpt-image-2-api-cheapest-pricing).
- Buffer (free for 3 channels, US$6 a channel monthly): [SocialPilot's 2026 summary](https://www.socialpilot.co/blog/buffer-pricing).
- Render (US$7 a month, disks US$0.25 per GB): [Render's own cost article](https://render.com/articles/how-much-does-cloud-application-hosting-cost-for-small-businesses).
- WhatsApp in Nigeria (marketing about US$0.062, replies about US$0.0101 since 1 October 2026): [Yournotify](https://yournotify.com/blog/whatsapp-pricing-update-2026/) and [Arise News](https://www.arise.tv/meta-to-start-charging-businesses-for-whatsapp-customer-service-messages-from-october-1/). Not confirmed against Meta's rate card.
