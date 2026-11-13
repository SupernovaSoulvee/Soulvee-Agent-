# File map

Every file in Soulvee OS: why it exists, and what breaks without it. Files marked "not in GitHub" exist only on the computer running Soulvee OS.

## The main folder

- `README.md`: every feature and setting. Without it, nobody knows how to start or configure the app.
- `CLAUDE.md`: your build protocol and the project facts, read by Claude at the start of every session. Without it, each session starts without your rules.
- `server.js`: the server. It serves the app, keeps your keys private, enforces the device lock and passes each request to the right part of `lib/`. Without it, nothing runs.
- `package.json`: the project's name, its commands (`npm start`, `npm test`) and the libraries it needs. Without it, no `npm` command works.
- `package-lock.json`: the exact version of every library, so every install is identical. Without it, an install can pull a different version and break the app.
- `.env.example`: a template listing every setting. Without it, you'd have to guess the setting names.
- `.env` (not in GitHub): your real keys and settings. Without it, the app runs with AI and publishing off.
- `.gitignore`: keeps `.env`, `data/`, `node_modules/` and test results out of GitHub. Without it, your keys could end up in the public repository.
- `.dockerignore`: keeps your keys, data and tests out of the Docker image. Without it, secrets could be packed into the image.
- `Dockerfile`: the recipe for packaging the app with Docker for hosting. Without it, Docker hosting isn't possible.
- `data/` (not in GitHub): the server's private files: connected accounts and their sign-in tokens, the inbox, the posting queue, autopilot settings and drafts, and hosted images. Without it, connected accounts and queued posts are lost.
- `node_modules/` (not in GitHub): the installed libraries, rebuilt by `npm install`. Without it, the server won't start.

## lib/: the server's parts

- `lib/claude.js`: talks to Claude through Anthropic's SDK and streams answers to the app. Without it, no AI features work.
- `lib/social.js`: publishing. It holds the posting queue and the scheduler, and posts to connected accounts, Buffer and webhooks, retrying when a network is down. Without it, nothing publishes.
- `lib/accounts.js`: the list of connected accounts and their tokens, kept on the server. Without it, no platform can be connected.
- `lib/inbox.js`: collects messages from connected accounts and sends your replies. Without it, there's no Inbox.
- `lib/oauth.js`: one-time sign-in links that keep platform sign-ins secure. Without it, signing in to Facebook, X, LinkedIn, Threads or Gmail fails.
- `lib/net.js`: the shared way of calling platforms, with time limits and plain-English errors. Without it, every platform file breaks.
- `lib/store.js`: saves the server's data files safely. Without it, the server forgets everything when it restarts.
- `lib/autopilot.js`: the weekly autopilot: its schedule, the drafting run and the drafts waiting for you. Without it, there's no autopilot.
- `lib/images.js`: makes images from visual briefs and hosts them. Without it, Make image doesn't work.

## lib/providers/: one file per platform

Without one of these, that platform disappears from Accounts; the others keep working.

- `index.js`: the list of platforms, their shared settings and token renewal. Without it, the Accounts tab can't list or use any platform.
- `meta.js`: Facebook Pages and Instagram: connecting, posting and messages.
- `whatsapp.js`: WhatsApp Business: incoming messages through Meta's webhook, replies and templates.
- `threads.js`: posting to Threads.
- `x.js`: posting to X, with images.
- `linkedin.js`: posting to LinkedIn profiles and company pages.
- `telegram.js`: Telegram bots: channel posts and messages to your bot.
- `reddit.js`: Reddit posts and private messages.
- `gmail.js`: Gmail messages and replies in the same email thread.
- `signal.js`: Signal chats through the Signal bridge.

## public/: what the browser loads

- `index.html`: the whole interface: every tab and every window. Without it, there's no app.
- `os-runtime.js`: the browser side of Soulvee OS. It saves your business records, talks to the server (AI, publishing, accounts, inbox) and handles backup and restore. Without it, the app can't save anything or reach the server.
- `shared.js`: brand voices, platform rules and the instructions given to the AI, shared by the browser and the server so both write posts the same way. Without it, AI posts lose the brand voice and the autopilot breaks.
- `sw.js`: the service worker that lets the app open without internet. Without it, the app won't open offline.
- `manifest.webmanifest`: the app's name, icons and colours for Add to Home Screen. Without it, installing on a phone fails or looks wrong.
- `icon.svg`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`: the app's icons. Without them, the icons are blank.
- `vendor/react.production.min.js` and `vendor/react-dom.production.min.js`: React, which draws the screens. Without them, the page is blank.
- `vendor/htm.umd.js`: lets the interface be written without a build step. Without it, the page is blank.
- `vendor/app.css`: every style, prepared in advance from Tailwind. Without it, the page has no styling.

## tailwind/: rebuilding the styles

- `tailwind.config.js`: tells Tailwind which files to read for style names. Without it, `npm run build:css` makes the wrong styles.
- `input.css`: the starting point for `vendor/app.css`. Without it, `npm run build:css` fails.

## docs/: the guides

- `OWNERS-GUIDE.md`: run, fix, extend, back up and costs, in plain English. Start here.
- `FILE-MAP.md`: this file.
- `GLOSSARY.md`: every developer term in six words.
- `BUILD-LOG.md`: what each session built and what's next, newest first.
- `AUDIT.md`: the check of Soulvee OS against your build protocol.
- `PLATFORMS.md`: connecting each platform, with the developer app it needs and its limits.
- `SOCIAL-AUTOMATION.md`: Buffer, webhooks, the autopilot, images and platform costs.

Without these, the knowledge lives only in someone's head.

## test/: the automatic checks

- `run.js`: the test runner. It starts fresh stand-ins and servers for each suite, runs it and prints the results. Without it, `npm test` doesn't work.
- `suites/server.js`: the guardrails: device lock, access token, signed webhooks, private files, the AI key staying on the server.
- `suites/accounts-api.js`: connected accounts, publishing to them, the inbox and webhooks, checked through the server.
- `suites/growth.js`: the autopilot, images from briefs and learning from Buffer results, in a browser.
- `suites/ai-social.js`: AI features, Content Studio and publishing, in a browser.
- `suites/crm.js`: contacts, follow-ups, the timeline and CSV import and export, in a browser.
- `suites/accounts-ui.js`: the Accounts and Inbox tabs on desktop and phone, in a browser.
- `suites/full.js`: deals, invoices and payments, Setup, the backup reminder, backup and restore, the AI lock and offline use, in a browser.
- `stand-ins/claude.js`, `social.js`, `media.js`, `platforms.js`: pretend versions of Claude, Buffer and webhooks, OpenAI and Cloudinary, and every platform, so the tests never touch anything real. Without them, the tests can't run.
- `stand-ins/sample.jpg`: a tiny image the stand-ins hand out.
- `output/` (not in GitHub): the list of checks, screenshots and server logs from the latest run.

Without a suite, the features it covers can break without anyone noticing.

## Outside this folder

- `.github/workflows/soulvee-os.yml`, at the top of the repository: tells GitHub to run every check whenever something in `soulvee-os` changes. Without it, a change that breaks something can be saved without anyone noticing until it fails in use.

## Inside public/index.html

`index.html` holds the whole interface in one file of about 3,000 lines, split into sections. Line numbers change as the file grows, so search for the section's heading instead: each starts with a line like `/* ---------------- Command ---------------- */`.

- **constants**: brands, tabs, money settings and other defaults.
- **helpers**: money formatting in naira, dates and other small tools.
- **data store**: how the screens read and save your records.
- **UI atoms**: buttons, cards and windows every screen uses.
- **Command**: the dashboard, including the backup reminder.
- **Skills → Revenue**: offers and the skill-to-offer converter.
- **Pipeline**: deals.
- **CRM**: contacts, follow-ups and the timeline.
- **Accounts**: connecting platforms.
- **Inbox**: messages from every connected account.
- **Content Studio**: writing, approving and publishing posts.
- **Autopilot and results**: the weekly autopilot and What's working.
- **Setup: AI check and social publishing**: the Test AI button and publishing status.
- **Printable invoice**: the invoice PDF.
- **Money**: invoices, the ledger, exchange rates and allocation.
- **Google Workspace**: the Gmail lead radar, hidden outside claude.ai.
- **AI sub-agent**: the AI Agent and the tools it can use.
- **Learn**: skill tracks and lessons.
- **Setup**: company details, tax rates, backup and restore.
- **App shell**: the tabs, navigation and the parts every screen shares.
