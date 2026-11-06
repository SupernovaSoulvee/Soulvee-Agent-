# Soulvee OS

The command centre for DJ Soulvee, Soulveetainment Media Consults, Soulvee's Emporium, EFR and digital products, as a standalone app. It started as the Soulveetainment Control Unit artifact on claude.ai.

## What's in it

- **Command**: revenue, costs, outstanding invoices, weighted pipeline and progress towards the H2 target, all in NGN.
- **Skills → Revenue**: an offer catalogue, with an AI converter that turns a skill into a priced offer.
- **Pipeline**: deals by stage, next steps, and AI-written follow-up emails in each brand's voice.
- **Money**: invoices (VAT and WHT, `INV-SMC-…` numbering), an income and expense ledger, FX and allocation buckets.
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

On a phone, open the URL and choose **Add to Home Screen** to install it like an app.

## Data

Data is saved in the browser on the device you use (localStorage), so it stays private and works offline once loaded. Use **Setup → Backup & restore** to export a JSON backup or move your data to another device.

## Hosting

- **Docker**: `docker build -t soulvee-os . && docker run -p 8787:8787 -e ANTHROPIC_API_KEY=... soulvee-os`
- **Render / Railway / Fly.io**: deploy this folder as a Node service with start command `node server.js` and set `ANTHROPIC_API_KEY`.

If the app is public, set `SOULVEE_ACCESS_TOKEN` so strangers can't spend your Claude credit. Then open it once as `https://your-host/?token=YOUR_TOKEN`; a cookie remembers it after that.

## Not in the standalone app

Gmail lead radar, Gmail drafts and Google Calendar booking use claude.ai connectors. They only work in the claude.ai version of the page. Everywhere else, follow-ups can be copied and pasted.

## Developing

The UI is one file, `public/index.html` (React + htm, no build step). Styles are precompiled Tailwind in `public/vendor/app.css`. If you add new Tailwind classes, run `npm run build:css`. `public/os-runtime.js` provides storage and AI, in place of the claude.ai platform the page was first built for.
