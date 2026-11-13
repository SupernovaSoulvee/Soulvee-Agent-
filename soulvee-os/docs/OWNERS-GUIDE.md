# Soulvee OS: owner's guide

Start here. This guide is written for you as the owner: how to run Soulvee OS, keep it safe, fix it and extend it, without needing whoever built it. Every developer term is defined in six words in [GLOSSARY.md](GLOSSARY.md). Every file is explained in [FILE-MAP.md](FILE-MAP.md).

## At a glance

- **10 tabs:** Command, Skills → Revenue, CRM, Inbox, Accounts, Content, Money, AI Agent, Learn and Setup.
- **10 platforms connected directly:** Facebook Pages, Instagram, Threads, X, LinkedIn, Telegram, WhatsApp, Reddit, Gmail and Signal. TikTok, YouTube and Pinterest go through Buffer.
- **363 automatic checks** confirm it works. One command runs them: `npm test`.
- **₦0 to run on your own computer**, plus what you use of AI, images and paid platforms (see "What it costs").
- **About ₦17,000 a month** in a typical month on your own computer. **About ₦27,000** hosted online.

## How it fits together

Soulvee OS has two halves:

- **The app** is what you see. It runs in your browser and keeps your business records (deals, invoices, contacts, content plans) in that browser.
- **The server** is a program that runs on your computer, or on a rented computer online. It keeps your keys private, talks to Claude, OpenAI, Buffer and the platforms, collects your messages, sends scheduled posts and runs the weekly autopilot.

In one line: browser (the app and your records) ↔ server (your keys and the timers) ↔ Claude, OpenAI, Buffer, Facebook, X and the rest.

## Run it for the first time

1. **Install Node.js.** Node.js is the engine that runs the server. Download the version marked LTS (the one with long-term security fixes) from nodejs.org and install it like any program.
2. **Get the code.** On GitHub, open SupernovaSoulvee/Soulvee-Agent-, choose Code → Download ZIP and unzip it. Until pull request #6 (changes proposed for review before merging) is merged, first switch GitHub to the branch (a parallel copy for changes) called `claude/soulvee-os-working-app-ndfjyx`.
3. **Open a terminal in the `soulvee-os` folder.** A terminal is a window where you type commands. On a Mac, open Terminal, type `cd ` and drag the folder in. On Windows, right-click the folder and choose Open in Terminal.
4. **Run `npm install`.** It downloads the code libraries (ready-made code a project reuses) Soulvee OS uses into a `node_modules` folder. It takes about a minute, and you only do it once (and again after an update).
5. **Create your settings file.** Copy `.env.example` to a new file called `.env`: on a Mac, `cp .env.example .env`; on Windows, `copy .env.example .env`. Open `.env` in a text editor and paste your keys after the `=` signs. Start with `ANTHROPIC_API_KEY`, which turns on the AI.
6. **Run `npm start`.** It starts the server. Open http://localhost:8787 in your browser.
7. **Keep that terminal window open** while you use Soulvee OS. To stop it, click the window and press Ctrl+C.

The app works without any keys: AI stays off and you post by hand. Add keys one at a time as you need them. [README.md](../README.md) lists every setting, and [PLATFORMS.md](PLATFORMS.md) covers connecting each platform.

## Your routine

- **Daily:** open Command. It shows overdue invoices, follow-ups due, tasks due today and offers without a price.
- **Weekly:** export a backup when Command asks, and save the file somewhere other than this device, such as Google Drive or an email to yourself.
- **Weekly:** review the autopilot's drafts in Content. Nothing is published until you approve it.
- **Monthly:** check what you spent: Usage in the Claude Console (where you got your API key), Usage in your OpenAI account, and Billing in Buffer.

## Use it on your phone

1. In `.env`, set `SOULVEE_ACCESS_TOKEN` to a long password only you know, then restart the server.
2. Your phone needs to reach the server. On the same Wi-Fi, use your computer's local address, for example http://192.168.1.20:8787 (your computer's network settings show its address). Away from that Wi-Fi, the server needs a public address: see Hosting in [README.md](../README.md).
3. Open the app on your phone once with `?token=` and your password at the end of the address. The server remembers that phone.
4. In the browser menu, choose Add to Home Screen (or Install app).

Without the token, AI, images, publishing, accounts and the inbox only work on the computer running the server, so nobody else can spend your credit or post as you.

## Keep your data safe

- **Business records** live only in the browser on each device. Clearing the browser's data, or losing the phone, deletes them. Command shows a backup reminder whenever there's no backup from the last 7 days. To move to a new device, use Setup → Backup & restore → Restore from file.
- **Server data** is in the `data` folder: your connected accounts with their sign-in tokens (passes proving Soulvee OS may post as you), the inbox, the posting queue and the autopilot. Back it up with your computer and never share it.
- **Keys** are in `.env`. Never share them and never upload them. Your GitHub repository (the project's online folder, with its full history) is public, so anyone can read the code. The file `.gitignore` keeps `.env` and `data` out of it: never remove those lines.
- **If a key leaks**, cancel it on the provider's website, create a new one, paste it into `.env` and restart the server.

## When something breaks

Each problem below says what it means and what to do.

1. **The page won't open.** The server isn't running. In the terminal, in the `soulvee-os` folder, run `npm start` and read any error it prints.
2. **"Cannot find module".** The libraries aren't installed. Run `npm install`, then `npm start`.
3. **"EADDRINUSE" or "address already in use".** Soulvee OS is already running in another window, or another program uses port 8787 (the numbered door Soulvee OS listens on). Close the other window, or add `PORT=8788` to `.env` and open http://localhost:8788.
4. **The AI says it's off.** Open the AI Agent tab: it says why. Usually the key is missing from `.env` (add it and restart), or you're on another device without the token.
5. **A post failed.** Content shows the reason for each account, such as "Instagram needs an image" or "reconnect it in Accounts". Fix that, then choose Try again on the post: only the failed accounts are ticked again.
6. **An account shows an error.** Open Accounts and choose Test. If a sign-in has expired, reconnect it. Gmail expires every 7 days while your Google app is in testing, and LinkedIn every 60 days.
7. **Nothing arrives in the Inbox.** The server must be running. Choose Check now. Facebook and Instagram messages need Meta's App Review first, and WhatsApp needs a public address (see [PLATFORMS.md](PLATFORMS.md)).
8. **A scheduled post went out late.** Posts to connected accounts only go out while the server runs. When it starts again, it sends anything that fell due while it was off. Posts scheduled in Buffer don't depend on it.
9. **Your records are gone.** The browser's data was cleared, or you're on a different device or browser. Restore your latest backup in Setup.
10. **Something broke after a change.** Run `npm test`, then `npm run test:browser`. The name of each failed check says what broke, and screenshots and logs are in `test/output`.

## Check it's working

- `npm test` runs the server checks in about 10 seconds: the device lock, the access token, signed webhooks (messages to your server that prove they're genuine), private files, connected accounts, publishing and the inbox.
- `npm run test:browser` runs every check, including ones that click through the app like a person would, in about 3 minutes. The first time, run `npm install` and then `npx playwright install chromium`, which downloads a test browser of about 150 MB.
- The tests start pretend versions of Claude, Buffer and every platform, called stand-ins. They never use your keys, touch your accounts or spend money.
- The result is either "All 363 checks passed" or the names of the checks that failed. Every check is listed in plain English in `test/output/<suite>/checks.txt`.
- GitHub also runs the checks on every change and shows a green tick or a red cross.

## Change or extend it

The easiest way is to open Claude Code (Claude working directly in your project folder) in the `soulvee-os` folder and describe the change in business terms. It reads [CLAUDE.md](../CLAUDE.md), your build protocol, at the start of every session, so it explains each step and runs the checks.

Where common changes live:

- **A brand's voice, or a platform's rules for posts:** `public/shared.js`.
- **VAT, withholding tax, invoice numbering, exchange rates or the H2 target:** Setup, no code needed.
- **A new tab or screen:** `public/index.html` (the "App shell" section lists the tabs).
- **A new tool for the AI Agent:** `public/index.html`, the "AI sub-agent" section.
- **A new platform:** a new file in `lib/providers/` (`telegram.js` is the simplest to copy), listed in `lib/providers/index.js`, with a stand-in and checks in `test/`.
- **Styles:** Tailwind class names (ready-made style names for page design) in `public/index.html`, then run `npm run build:css`.

After any change, run `npm test` and `npm run test:browser` before saving it to GitHub.

## What it costs

Figures use ₦1,345 to the US dollar, the mid-market rate in early November 2026. Your bank's rate and card fees will make them higher. Prices change, so check each provider's page before relying on these.

- **Running on your own computer:** ₦0, apart from electricity and data.
- **AI Agent (Claude Opus 5.5):** about ₦60 for a typical question, up to about ₦150 for a long one. Claude charges about ₦5,400 per million tokens (chunks of text AI bills by) it reads and ₦26,900 per million it writes.
- **Content plan:** about ₦120 for five posts for one brand.
- **Images:** about ₦70 each (OpenAI, medium quality).
- **Weekly autopilot, 4 brands × 5 posts with images:** about ₦2,000 a week (₦500 writing, ₦1,400 for 20 images), so about ₦8,200 a month.
- **Buffer:** free for up to 3 channels. Beyond that, the Essentials plan is about ₦8,100 per channel a month, or ₦6,700 billed yearly.
- **Hosting online (Render, a hosting service):** about ₦9,750 a month for an always-on server with a small disk.
- **WhatsApp (Meta, Nigeria):** about ₦83 per marketing template. Press reports say that since 1 October 2026 Meta also charges about ₦14 per reply inside the 24-hour window, which used to be free. I couldn't check Meta's own rate card, so confirm it there.
- **X:** about ₦20 per post, and about ₦270 for a post with a link, from third-party reports.
- **Facebook, Instagram, Threads, LinkedIn, Telegram, Reddit, Gmail and Signal:** no per-post fees.
- **Automatic checks on GitHub:** ₦0, because the repository is public.

A typical month: 5 AI Agent questions a day (about ₦9,000), the weekly autopilot with images (about ₦8,200) and Buffer's free plan. That's about ₦17,000 on your own computer, or about ₦27,000 hosted online.

## Maintenance calendar

- **Every week:** export a backup (Command reminds you) and approve the autopilot's drafts.
- **Every 7 days:** Gmail's sign-in ends while your Google app is in "Testing". Publishing the Google app stops this (see [PLATFORMS.md](PLATFORMS.md)).
- **Every 60 days:** reconnect LinkedIn; Accounts warns you a week before. Threads renews itself.
- **About August 2027:** LinkedIn retires its API (the door apps use to reach LinkedIn) version `202608` after about a year. When LinkedIn posts start failing with "version not active", change `LINKEDIN_VERSION` in `.env` to a newer version.
- **April 2027:** Node.js 22 stops getting security fixes. Install the newer LTS from nodejs.org, and change the first line of `Dockerfile` (the recipe Docker uses to package the app for hosting) to `FROM node:24-alpine`.
- **About every two years:** Meta retires versions of its Graph API, the door apps use to reach Facebook and Instagram. When Meta says `v26.0` is too old, change `META_GRAPH_VERSION` in `.env`.

## Where to look next

- [README.md](../README.md): every feature and every setting.
- [PLATFORMS.md](PLATFORMS.md): connecting each platform, with its limits.
- [SOCIAL-AUTOMATION.md](SOCIAL-AUTOMATION.md): Buffer, webhooks, autopilot and images.
- [FILE-MAP.md](FILE-MAP.md): what every file does.
- [GLOSSARY.md](GLOSSARY.md): every developer term in six words.
- [BUILD-LOG.md](BUILD-LOG.md): what each session built, and what's next.
- [AUDIT.md](AUDIT.md): the check of Soulvee OS against your build protocol.
