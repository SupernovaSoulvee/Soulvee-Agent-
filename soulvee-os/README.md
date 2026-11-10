# Soulvee OS

The command centre for DJ Soulvee, Soulveetainment Media Consults, Soulvee's Emporium, EFR and digital products, as a standalone app. It started as the Soulveetainment Control Unit artifact on claude.ai.

## What's in it

- **Command**: revenue, costs, outstanding invoices, weighted pipeline and progress towards the H2 target, all in NGN.
- **Skills → Revenue**: an offer catalogue, with an AI converter that turns a skill into a priced offer. **Promote** on any offer sends it to Content.
- **Pipeline**: deals by stage and next steps. Follow-up emails are written by AI in each brand's voice and open in your email app. Calls are booked with a pre-filled Google Calendar link or a calendar file.
- **Content**: the Content Studio. AI writes posts in each brand's voice, with captions, hashtags, visual briefs, video scripts and posting times. You edit and approve them, then publish through Buffer or a Make, Zapier or n8n webhook, or copy and post by hand. See [docs/SOCIAL-AUTOMATION.md](docs/SOCIAL-AUTOMATION.md).
- **Money**: invoices (VAT and WHT, `INV-SMC-…` numbering, printable PDF), an income and expense ledger, FX and allocation buckets. A payment marked by mistake can be undone.
- **AI Agent**: chat that reads your real numbers and, when you ask, logs deals and offers, drafts invoices and adds post drafts to Content. Answers stream in as they're written.
- **Learn**: skill tracks with AI lessons from level 1 to 5, linked to offers.
- **Setup**: company details, tax rates, FX and allocation. Also a **Test AI** button, social publishing status with default Buffer channels for each brand, and **backup & restore**.

## Run it

You need Node 18 or newer.

```bash
cd soulvee-os
npm install
cp .env.example .env        # then add your keys (see below)
npm start                   # http://localhost:8787
```

Without any keys the app still works. AI features stay off, and posts are copied and posted by hand.

On a phone, open the URL and choose **Add to Home Screen** (or **Install app**) to use it like an app. After the first visit it also opens without a connection, as long as it's served over https or from localhost.

## Settings (.env)

| Variable | What it does |
|---|---|
| `ANTHROPIC_API_KEY` | Turns on all AI features. |
| `SOULVEE_MODEL` | The Claude model. Default `claude-opus-5-5`. |
| `BUFFER_API_KEY` | Publishes and schedules posts through Buffer (Buffer → Settings → API). |
| `SOCIAL_WEBHOOK_URL` | Sends posts to a Make, Zapier or n8n webhook at the scheduled time. |
| `SOCIAL_WEBHOOK_SECRET` | Optional. Signs every webhook call so the scenario can check it came from you. |
| `SOULVEE_ACCESS_TOKEN` | **Required before hosting publicly.** Locks AI and publishing; open the app once with `?token=YOUR_TOKEN`. |
| `SOULVEE_DATA_DIR` | Where the webhook posting queue is kept. Default `./data`. |
| `PORT` | Default `8787`. |

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

1. **Buffer** (recommended). One API key covers Instagram, TikTok, Facebook, LinkedIn, X, Threads, YouTube and Pinterest, and Buffer handles the scheduling.
2. **Webhook**. Soulvee OS sends the post to Make, Zapier or n8n at the scheduled time, and your scenario posts it. Failed calls are retried 3 more times (after 1, 5 and 15 minutes).
3. **By hand**. Copy the caption; X, Threads and LinkedIn open with it filled in.

Media must be a direct public link, such as Cloudinary or Cloudflare R2. Google Drive and Dropbox share links won't work.

Publishing reaches your real accounts, so without `SOULVEE_ACCESS_TOKEN` it only works from the computer running Soulvee OS.

The full guide, with the setup steps, platform rules and costs, is [docs/SOCIAL-AUTOMATION.md](docs/SOCIAL-AUTOMATION.md).

## Data

Your business data is saved in the browser on the device you use (localStorage), so it stays private and works without a connection. Each device has its own copy. Use **Setup → Backup & restore** to export a JSON backup or move your data to another device. Back up regularly, because clearing the browser's site data deletes it.

The server keeps only the webhook posting queue, in `data/`.

## Hosting

- **Docker**: `docker build -t soulvee-os . && docker run -p 8787:8787 -v soulvee-data:/app/data --env-file .env soulvee-os`. Your `.env` is never copied into the image.
- **Render / Railway / Fly.io**: deploy this folder as a Node service with build command `npm install` and start command `node server.js`, then set the variables above. If you use the webhook, give the service a persistent disk for `data/` and keep it running at posting times. Buffer needs neither.

Always set `SOULVEE_ACCESS_TOKEN` on a public host, so nobody else can spend your Claude credit or post to your accounts.

## AI says it's off?

The AI Agent tab says why:

- **Set ANTHROPIC_API_KEY**: the server has no key. Add it to `.env` and restart.
- **AI is locked on this device**: `SOULVEE_ACCESS_TOKEN` is set. Open the app once with `?token=YOUR_TOKEN`.
- **Claude rejected the API key**: the key is wrong or revoked. Replace it and restart.
- **Can't be reached**: you're offline or the server isn't running.

## Not in the standalone app

The Gmail lead radar and saving drafts straight into Gmail need claude.ai connectors, so the Google tab is hidden here.

## Developing

- `public/index.html`: the whole interface (React + htm, no build step).
- `public/os-runtime.js`: browser storage, the streamed AI client and agent loop, and the publishing API client.
- `server.js`: static files, access control and routing.
- `lib/claude.js`: Claude through the Anthropic SDK, streamed to the browser as server-sent events.
- `lib/social.js`: Buffer publishing, plus the webhook queue and scheduler.
- `lib/store.js`: the JSON file store for that queue.
- `public/sw.js`: makes the app open offline. If you add a file the app needs to start, list it there and bump `CACHE`.

Styles are precompiled Tailwind in `public/vendor/app.css`. If you add new Tailwind classes, run `npm run build:css`.
