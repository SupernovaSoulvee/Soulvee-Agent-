# Working on Soulvee OS

Claude reads this file at the start of every session that works in this folder. Part 1 is the owner's standing build protocol, in their words. Part 2 is how it applies here, plus the project facts every session needs.

## Part 1: Standing build protocol (Soulvee / Soulveetainment)

A teaching-while-building contract. Plain English over jargon. Every file justified before it exists. Every command explained before it runs. Short explanations, not lectures. And a strategist pass on the instructions before any work starts.

I'm a solo founder running four brands out of Lagos. I'm fluent in business, operations and client work. I'm a beginner at code, terminals and developer tooling. Treat me accordingly: never explain what a client or an invoice is, always explain what a script, a dependency or an agent is.

My operating principle is **systems over hustle**: build the workflow once so I never do it manually again. Every build should leave me able to run, fix and extend it without you.

**Before any work starts:**
1. Restate what you think I'm building in one sentence and wait for my yes.
2. Name the one project in scope. Refuse scope creep into my other brands.
3. Flag anything you'd be guessing at. Don't fill gaps silently.

**While building, every step follows this shape:**
- **What**: one line, plain English.
- **Why**: what it unlocks for the business, not the code.
- **Then do it**: don't wait for permission unless it costs money, touches live client data, or can't be undone.

**Rules:**
- Every file: say why it exists and what breaks without it, in one sentence, before you create it.
- Every command: say what it does in plain English before you run it. No bare commands.
- Every agent or subagent: say what job it's doing and why you're not doing it yourself.
- No developer term without a six-word definition the first time it appears.
- Keep explanations to 2–3 sentences. I want to learn, not read documentation.
- If I ask for something that won't work or will cost me later, say so directly and propose the better path. Don't quietly build the wrong thing.

**Formatting:** decisions and numbers first, skimmable. NGN for money. Anything ClickUp-bound must paste cleanly into a task description.

**End of every session:** a short build log: what exists now, what it does, how I run it, what's next. Written so I understand it in a month.

**The goal:** I finish each session owning the system and understanding it, not just holding it.

## Part 2: How this applies to Soulvee OS

### Scope
- The project is Soulvee OS: this `soulvee-os` folder and nothing else. The rest of the repository is opencode, the open-source tool it was forked from. The `AGENTS.md` at the repository root (Bun, TypeScript) is for opencode, not for this folder.
- Ideas outside the agreed task go under "What's next" in `docs/BUILD-LOG.md` instead of being built.

### Explaining
- Commands that only read (listing files, searching) get a one-line explanation. Commands that change, install, delete or publish anything get the full What / Why first.
- Every new developer term goes into `docs/GLOSSARY.md` with its six-word definition. Every new file goes into `docs/FILE-MAP.md` with why it exists and what breaks without it.

### Formatting
- Money is in naira (₦). When a service bills in dollars, give the naira figure and the exchange rate used, and say the rate needs checking.
- ClickUp-bound writing (the owner's guide, the build log, summaries) uses headings, short paragraphs, bullets and numbered lists only. No tables, no HTML and no bullets more than one level deep, because those don't paste cleanly into a ClickUp task description.

### End of the session
- Add the build log as a new entry at the top of `docs/BUILD-LOG.md`, and give the same log in the chat.

### Project facts
- Plain Node.js with no build step. The interface is React and htm loaded from `public/vendor`; the styles are precompiled Tailwind, so run `npm run build:css` after adding new Tailwind classes.
- Business data (deals, invoices, contacts, content) lives in the browser's storage on each device. The server keeps only what must run while the app is closed (connected accounts, the inbox, the posting queue, autopilot data, hosted images) in `data/`.
- Run: `npm start`, then open http://localhost:8787. `npm run dev` restarts the server whenever a file changes.
- Tests: `npm test` runs the server checks in seconds. `npm run test:browser` runs everything, about three minutes; the first time needs `npm install` and `npx playwright install chromium`. Run `npm test` before every commit and `npm run test:browser` before every push.
- Never skip, weaken or delete a check to get a green result. Fix the cause.
- Tests only talk to the stand-ins in `test/stand-ins` and never read `.env` (`SOULVEE_ENV_FILE=none`). Keep it that way: no test may call a real service, spend money or touch a real account.
- Never commit `.env`, `data/` or a real key: the GitHub repository is public.
- Publishing always waits for the owner's approval in the app, and the AI agent can draft but never send, publish or mark anything paid. Keep it that way.
- When behaviour changes, update the docs that describe it: `README.md`, `docs/OWNERS-GUIDE.md`, `docs/FILE-MAP.md`, `docs/GLOSSARY.md`, `docs/PLATFORMS.md`, `docs/SOCIAL-AUTOMATION.md`.
- A new file the app needs in order to start goes into the list in `public/sw.js`, with `CACHE` bumped, so the app still opens offline.
