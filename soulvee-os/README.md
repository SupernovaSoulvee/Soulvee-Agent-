# Soulvee OS

The command centre for DJ Soulvee, Soulveetainment Media Consults, Soulvee's Emporium, EFR and digital products, as a standalone app. It started as the Soulveetainment Control Unit artifact on claude.ai.

**New to running it? Start with the [owner's guide](docs/OWNERS-GUIDE.md):** running, fixing, extending, backups and costs in plain English. Every developer term used here is defined in six words in the [glossary](docs/GLOSSARY.md), and every file is explained in the [file map](docs/FILE-MAP.md).

## What's in it

- **Command**: revenue, costs, outstanding invoices, weighted pipeline and progress towards the H2 target, all in NGN.
- **Skills → Revenue**: an offer catalogue, with an AI converter that turns a skill into a priced offer. **Promote** on any offer sends it to Content.
- **CRM**:
  - **People**: every client, lead and fan, with phone, email, WhatsApp, Instagram, Telegram and other handles, brands, tags, stage and notes. Each contact shows their deals, invoices, payments, follow-ups and a timeline of calls, meetings and notes, plus an AI summary with the next step. Import contacts from a CSV (Google Contacts, Outlook or a spreadsheet) and export them again.
  - **Pipeline**: deals by stage and next steps. Every deal is linked to a contact, and a new client is added to People automatically. Follow-up emails are written by AI in each brand's voice and open in your email app. Calls are booked with a pre-filled Google Calendar link or a calendar file.
  - **Tasks**: follow-ups and reminders, overdue first. Ones due today also appear on Command.
- **Content**: the Content Studio. AI writes posts in each brand's voice, with captions, hashtags, visual briefs, video scripts and posting times. It can also make an image from each brief. **Autopilot** drafts the coming week's posts on a weekly schedule, and **What's working** reads your Buffer results so the AI does more of what performs. You edit and approve everything, then tick the accounts to post to (your connected Pages and profiles, and Buffer channels), use a Make, Zapier or n8n webhook, or copy and post by hand. Each post shows how it went on every account, with a link to the live post. See [docs/SOCIAL-AUTOMATION.md](docs/SOCIAL-AUTOMATION.md).
- **Inbox**: WhatsApp, Messenger, Instagram, Telegram, Gmail, Reddit and Signal messages in one list. Reply from the app (it goes out from the account the message came in on), let the AI draft a reply in the brand voice, and add the person to your contacts or link them to one.
- **Accounts**: connect several of each: Facebook Pages, Instagram, Threads, X and LinkedIn profiles and company pages, Telegram bots and channels, WhatsApp numbers, Reddit accounts, Gmail mailboxes and Signal numbers. TikTok, YouTube and Pinterest come in through Buffer. Give each account its brands, so posts for a brand go to the right Pages, and switch accounts on or off. See [docs/PLATFORMS.md](docs/PLATFORMS.md).
- **Money**: invoices (VAT and WHT, `INV-SMC-…` numbering, printable PDF), an income and expense ledger, FX and allocation buckets. A payment marked by mistake can be undone.
- **AI Agent**: chat that reads your real numbers and contacts and, when you ask, logs deals, offers, contacts, activities and follow-ups, drafts invoices and adds post drafts to Content. Answers stream in as they're written.
- **Learn**: skill tracks with AI lessons from level 1 to 5, linked to offers.
- **Setup**: company details, tax rates, FX and allocation. Also a **Test AI** button, publishing status with default Buffer channels for each brand, and **backup & restore**.

## Run it

You need Node 18 or newer.

```bash
cd soulvee-os
npm install                 # downloads the libraries Soulvee OS uses (once, and after updates)
cp .env.example .env        # creates your settings file (Windows: copy .env.example .env), then add your keys
npm start                   # starts the server: open http://localhost:8787
```

To check everything works, run `npm test` (the server checks, about 10 seconds) or `npm run test:browser` (every check, about 3 minutes; the first time, run `npx playwright install chromium`). The checks use stand-ins for Claude, Buffer and every platform, and never read your `.env`.

Without any keys the app still works. AI features stay off, and posts are copied and posted by hand.

On a phone, open the URL and choose **Add to Home Screen** (or **Install app**) to use it like an app. After the first visit it also opens without a connection, as long as it's served over https or from localhost. AI, images and publishing only work on the computer running Soulvee OS until you set `SOULVEE_ACCESS_TOKEN`; then open the app once on the phone with `?token=YOUR_TOKEN`.

## Settings (.env)

| Variable | What it does |
|---|---|
| `ANTHROPIC_API_KEY` | Turns on all AI features. |
| `SOULVEE_MODEL` | The Claude model. Default `claude-opus-5-5`. |
| `BUFFER_API_KEY` | Publishes and schedules posts through Buffer (Buffer → Settings → API). |
| `SOCIAL_WEBHOOK_URL` | Sends posts to a Make, Zapier or n8n webhook at the scheduled time. |
| `SOCIAL_WEBHOOK_SECRET` | Optional. Signs every webhook call so the scenario can check it came from you. |
| `OPENAI_API_KEY` | Makes an image from each post's visual brief. |
| `SOULVEE_IMAGE_MODEL` | The image model. Default `gpt-image-2`. |
| `SOULVEE_IMAGE_QUALITY` | `low`, `medium` (default) or `high`. Higher costs more per image. |
| `CLOUDINARY_URL` | Hosts the images at permanent public links, which Buffer needs. Copy it from your Cloudinary dashboard (`cloudinary://key:secret@cloud`). |
| `PUBLIC_URL` | Your server's public https address. Platforms send you back to it after signing in, Meta delivers WhatsApp messages to it, and without Cloudinary images are served from `PUBLIC_URL/media/…`. |
| `META_APP_ID`, `META_APP_SECRET` | Your Meta app: signs in to Facebook Pages and Instagram, and checks WhatsApp webhook calls. |
| `THREADS_APP_ID`, `THREADS_APP_SECRET` | The Threads use case of your Meta app. |
| `X_CLIENT_ID`, `X_CLIENT_SECRET` | Your X app (OAuth 2.0). |
| `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` | Your LinkedIn app. Add `LINKEDIN_SCOPES` for company pages. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Your Google Cloud OAuth client, for Gmail. |
| `SOULVEE_ACCESS_TOKEN` | **Needed on a public host, in Docker, or to use AI, images and publishing from another device.** Without it they only work on the computer running Soulvee OS. Open the app once on each device with `?token=YOUR_TOKEN`. |
| `SOULVEE_DATA_DIR` | Where the server keeps connected accounts, inbox messages, the posting queue, autopilot settings and drafts, and any images it hosts. Default `./data`. |
| `PORT` | Default `8787`. |
| `SOULVEE_ENV_FILE` | Set it when starting the server (not in `.env`) to read another settings file instead of `.env`. `none` reads no file; the tests use that, so they can never pick up your keys. |

Restart the server after changing `.env`. **Setup → AI connection → Test AI** confirms the key and model work.

## How the AI works

- It uses the official Anthropic SDK with **Claude Opus 5.5** by default. Change it with `SOULVEE_MODEL`.
- Replies stream in as they're written. Effort is set for each task: medium for the agent, content plans and offers, low for quick rewrites, follow-ups and lessons.
- Content plans and offers use structured outputs, so the AI always returns usable data.
- **Refusal fallbacks are on.** If Claude's safety filter declines a request, Anthropic retries it on its recommended fallback model in the same call. A request that is still declined shows a plain message.
- Repeated parts of each request are cached, which makes multi-step agent turns cheaper.
- The agent's tools run in your browser, on your own data. It can create drafts, but it can't send, publish or mark anything paid.

## Social publishing

The Content tab has three ways to publish:

1. **Accounts**. Tick the Pages, profiles and channels to post to. Connected accounts (Facebook Pages, Instagram, Threads, X, LinkedIn, Telegram channels, Reddit) are posted to by Soulvee OS itself at the scheduled time, retried if a network is down. Buffer channels (including TikTok, YouTube and Pinterest) are scheduled in Buffer. Accounts given the post's brand are ticked for you.
2. **Webhook**. Soulvee OS sends the post to Make, Zapier or n8n at the scheduled time, and your scenario posts it. Failed calls are retried 3 more times (after 1, 5 and 15 minutes).
3. **By hand**. Copy the caption; X, Threads, LinkedIn, Telegram, WhatsApp and Reddit open with it filled in.

Media must be a direct public link, such as Cloudinary or Cloudflare R2. Google Drive and Dropbox share links won't work.

Publishing reaches your real accounts, so without `SOULVEE_ACCESS_TOKEN` it only works on the computer running Soulvee OS. The same goes for AI and images, which spend your credit.

Connecting each platform, with the developer app it needs and its limits, is in [docs/PLATFORMS.md](docs/PLATFORMS.md). Buffer, the webhook, platform rules and costs are in [docs/SOCIAL-AUTOMATION.md](docs/SOCIAL-AUTOMATION.md).

Scheduled posts to connected accounts are sent by the server, so it must be running at the scheduled time (Buffer posts don't need it).

## Autopilot, images and results

- **Autopilot** (Content → ⟳ Autopilot): choose a day and time, for example Sunday 17:00 Lagos time, plus a plan for each brand (posts per week, platforms, goal, an offer to push, images on or off). Each week the server drafts the coming week's posts, learning from your Buffer results. Drafts appear in Content the next time you open the app, with a badge on the tab, and are never published until you approve them. **Run now** drafts straight away, and counts as the scheduled run if that is less than 48 hours away. With a webhook set, Soulvee OS also sends an `autopilot.ready` event, so a Make or Zapier scenario can text or email you.
- **Images**: **Make image** on a post, **Make image from brief** in the editor, or "Make an image for each post" in the generator and autopilot. Images use the brand's look and are hosted on Cloudinary so Buffer can post them. They avoid identifiable faces and only add text the brief asks for.
- **What's working**: reads up to 60 days of results from Buffer: engagement by platform, best posting hour and top posts. The generator, the autopilot and the AI agent's `get_social_results` tool use it to choose formats, topics and times. Posts you published through Buffer show their own numbers.

Autopilot runs on the server, so the server must be on at the scheduled time. If it was off, autopilot catches up when the server starts again.

## Data

Your business data is saved in the browser on the device you use (localStorage), so it stays private and works without a connection. Each device has its own copy. Use **Setup → Backup & restore** to export a JSON backup or move your data to another device. Back up regularly, because clearing the browser's site data deletes it. Command reminds you when you have records and no backup from the last 7 days, with an **Export backup** button.

The server keeps only what has to run while you're away, in `data/`:
- **Connected accounts**, with their access tokens, in `accounts.json`;
- **Inbox messages**, in `inbox.json`;
- the posting queue;
- autopilot settings and its waiting drafts, plus a copy of your offers and recent post titles for it;
- any images it hosts.

On Mac and Linux, only the server's user account can read `accounts.json` and `inbox.json`. Windows doesn't use those permission settings, so keep the project inside your own user folder there. Tokens are never sent to the browser. Back up `data/` like a password file.

## Hosting

- **Docker**: `docker build -t soulvee-os . && docker run -p 8787:8787 -v soulvee-data:/app/data --env-file .env soulvee-os`. Your `.env` is never copied into the image. Set `SOULVEE_ACCESS_TOKEN` in it too: inside Docker every visit counts as another device, so AI, images and publishing need the token.
- **Render / Railway / Fly.io**: deploy this folder as a Node service with build command `npm ci --omit=dev` (it skips the testing tools) and start command `node server.js`, then set the variables above. If you use the webhook or the autopilot, give the service a persistent disk for `data/` and keep it running. Otherwise a redeploy wipes the queue and autopilot settings. Buffer on its own needs neither.

On a public host, AI, images and publishing stay off until you set `SOULVEE_ACCESS_TOKEN`, so nobody else can spend your Claude credit or post to your accounts.

## AI says it's off?

The AI Agent tab says why:

- **Set ANTHROPIC_API_KEY**: the server has no key. Add it to `.env` and restart.
- **AI is locked on this device**: `SOULVEE_ACCESS_TOKEN` is set. Open the app once with `?token=YOUR_TOKEN`.
- **AI only works on the computer running Soulvee OS**: you opened the app from another device, or through Docker, a proxy or a tunnel, and `SOULVEE_ACCESS_TOKEN` isn't set. Set it, restart the server, and open the app once with `?token=YOUR_TOKEN`.
- **Claude rejected the API key**: the key is wrong or revoked. Replace it and restart.
- **Can't be reached**: you're offline or the server isn't running.

## Not in the standalone app

The Gmail lead radar and saving drafts straight into Gmail need claude.ai connectors, so the Google tab is hidden here.

## Developing

`CLAUDE.md` holds the build protocol Claude follows in this folder, and [docs/FILE-MAP.md](docs/FILE-MAP.md) explains every file. The main ones:

- `public/index.html`: the whole interface (React + htm, no build step).
- `public/os-runtime.js`: browser storage, the streamed AI client and agent loop, and the publishing API client.
- `server.js`: static files, access control and routing.
- `public/shared.js`: brand voices, platforms, the post schema and prompt builders, shared by the browser and the server so both write posts the same way.
- `lib/claude.js`: Claude through the Anthropic SDK, streamed to the browser as server-sent events (plus structured generation for the autopilot).
- `lib/social.js`: publishing to connected accounts, Buffer and the webhook, with the posting queue and scheduler.
- `lib/accounts.js`: connected accounts and their tokens.
- `lib/providers/`: one file per platform (Meta for Facebook and Instagram, WhatsApp, Threads, X, LinkedIn, Telegram, Reddit, Gmail, Signal): connecting, posting, reading messages and replying.
- `lib/inbox.js`: the inbox (checking accounts, webhooks, replies).
- `lib/oauth.js` and `lib/net.js`: platform sign-ins, and HTTP calls with plain-English errors.
- `lib/autopilot.js`: the weekly autopilot (schedule, run, draft inbox).
- `lib/images.js`: images from briefs (OpenAI), hosted on Cloudinary or this server.
- `lib/store.js`: the JSON file store for accounts, the inbox, the queue and the autopilot.
- `public/sw.js`: makes the app open offline. If you add a file the app needs to start, list it there and bump `CACHE`.

- `test/`: the automatic checks. `run.js` gives each suite in `suites/` fresh stand-ins (`stand-ins/`) and a fresh server with an empty data folder and no `.env`. Run `npm test` before every commit and `npm run test:browser` before every push; GitHub runs both on every change to this folder.

Styles are precompiled Tailwind in `public/vendor/app.css`. If you add new Tailwind classes, run `npm run build:css`.
