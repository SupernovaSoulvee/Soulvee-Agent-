# Build log

One entry per session, newest first: what exists now, what it does, how to run it and what's next. Written so it still makes sense in a month.

## 12–13 November 2026: the ownership pass

**What exists now**
- Soulvee OS: 10 tabs, 10 directly connected platforms (plus TikTok, YouTube and Pinterest through Buffer), a CRM, a unified inbox, publishing, the weekly autopilot and an AI agent.
- New this session: your build protocol saved as `CLAUDE.md`; an owner's guide, file map, glossary and protocol audit in `docs/`; 363 automatic checks inside the project; a backup reminder on Command; and automatic checks on GitHub.

**What it does**
- Claude now reads your protocol at the start of every session, so you never paste it again.
- The owner's guide covers running, fixing, extending and backing up Soulvee OS, and what it costs in naira.
- The checks confirm every feature still works after a change, using stand-ins, so they can never spend your money or touch your accounts. 36 of them are new and guard the device lock, the access token, signed webhooks and private files.
- Command asks for a backup when you have records and haven't exported one in 7 days.
- A safety gap is closed: the server used to read `.env` even during tests, so on your computer tests could have reached your real keys. Now they can't.

**How to run it**
- Start: `npm start` in the `soulvee-os` folder, then open http://localhost:8787.
- Check it works: `npm test` (about 10 seconds) or `npm run test:browser` (everything, about 3 minutes).
- Details: [OWNERS-GUIDE.md](OWNERS-GUIDE.md).

**What's next**
1. **Hold late posts.** A post that falls due while the server is off goes out as soon as it restarts, even days late ("Tonight at Quilox" three days later). Recommended: hold anything more than 2 hours late and ask you first.
2. **Keep business records on the server too.** Records live in one browser per device, so a lost phone without a backup loses them. Storing them on the server, with sync between phone and computer, is the proper fix and a separate build. Until then, the weekly backup reminder is the safety net.
3. **Confirm WhatsApp's new charge.** Press reports say Meta charges about ₦14 per reply inside the 24-hour window since 1 October 2026. Check Meta's rate card before relying on WhatsApp replies at volume.
4. **Merge pull request #6** so the main branch has everything.
5. **Before April 2027:** move the `Dockerfile` to Node.js 24 (see the maintenance calendar in the owner's guide).

## Earlier sessions

- **12 November 2026:** connected accounts for 10 platforms (several Pages and profiles of each), a unified inbox and publishing to several accounts at once. Before that the same day: the CRM, with contacts, follow-ups, a timeline, CSV import and export, and links to deals and invoices.
- **11 November 2026:** the weekly autopilot, images from visual briefs and learning from Buffer results. Then fixes from the pull request review: AI and images locked to your devices without an access token, part payments, and each invoice keeping its own VAT rate.
- **10 November 2026:** AI rebuilt on Anthropic's official SDK with answers that stream in, the Content Studio, and publishing through Buffer and Make, Zapier or n8n webhooks.
- **7 November 2026:** a full review, with the bugs it found fixed and every tab tested in a browser.
- **6 November 2026:** Soulvee OS created as a standalone app from the Soulveetainment Control Unit artifact: Command, Skills → Revenue, Pipeline, Money, AI Agent, Learn and Setup, with records saved in the browser and backup and restore.
