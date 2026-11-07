# Soulvee OS

The command centre for DJ Soulvee, Soulveetainment Media Consults, Soulvee's Emporium, EFR and digital products, as a standalone app. It started as the Soulveetainment Control Unit artifact on claude.ai.

## What's in it

- **Command**: revenue, costs, outstanding invoices, weighted pipeline and progress towards the H2 target, all in NGN.
- **Skills → Revenue**: an offer catalogue, with an AI converter that turns a skill into a priced offer.
- **Pipeline**: deals by stage and next steps. Follow-up emails are written by AI in each brand's voice and open in your email app. Calls are booked with a pre-filled Google Calendar link or a calendar file.
- **Money**: invoices (VAT and WHT, `INV-SMC-…` numbering), an income and expense ledger, FX and allocation buckets. A payment marked by mistake can be undone.
- **AI Agent**: chat that reads your real numbers and can log deals, offers and draft invoices when you ask.
- **Learn**: skill tracks with AI lessons from level 1 to 5, linked to offers.
- **Setup**: company details, tax rates, FX, allocation, plus **backup & restore**.

## Run it

You need Node 18 or newer. There's nothing to install.

```bash
cd soulvee-os
cp .env.example .env        # then put your Claude API key in ANTHROPIC_API_KEY
npm start                   # http://localhost:8787
```

Without an API key the app still works fully; only the AI features are switched off.

On a phone, open the URL and choose **Add to Home Screen** (or **Install app**) to use it like an app. After the first visit it also opens without a connection, as long as it's served over https or from localhost.

## Data

Data is saved in the browser on the device you use (localStorage), so it stays private and doesn't need a connection. Each device has its own copy. Use **Setup → Backup & restore** to export a JSON backup or move your data to another device. Back up regularly, because clearing the browser's site data deletes it.

## Hosting

- **Docker**: `docker build -t soulvee-os . && docker run -p 8787:8787 -e ANTHROPIC_API_KEY=... soulvee-os` (your `.env` is never copied into the image)
- **Render / Railway / Fly.io**: deploy this folder as a Node service with start command `node server.js` and set `ANTHROPIC_API_KEY`.

If the app is public, set `SOULVEE_ACCESS_TOKEN` so strangers can't spend your Claude credit. Then open it once as `https://your-host/?token=YOUR_TOKEN`; a cookie remembers it after that.

## AI says it's off?

The AI Agent tab says why:

- **Set ANTHROPIC_API_KEY**: the server has no key. Add it to `.env` and restart.
- **AI is locked on this device**: `SOULVEE_ACCESS_TOKEN` is set. Open the app once with `?token=YOUR_TOKEN`.
- **Claude rejected the API key**: the key is wrong or revoked. Replace it and restart.
- **Can't be reached**: you're offline or the server isn't running.

## Not in the standalone app

The Gmail lead radar and saving drafts straight into Gmail need claude.ai connectors, so the Google tab is hidden here. Follow-ups open in your email app instead, and calls are booked through a Google Calendar link or a calendar file.

## Developing

The UI is one file, `public/index.html` (React + htm, no build step). Styles are precompiled Tailwind in `public/vendor/app.css`. If you add new Tailwind classes, run `npm run build:css`. `public/os-runtime.js` provides storage and AI, in place of the claude.ai platform the page was first built for. `public/sw.js` makes the app open offline; if you add a file the app needs to start, list it there and bump `CACHE`.
