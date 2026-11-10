# Automating social posting and content creation

How Soulvee OS creates and publishes posts for DJ Soulvee, Soulveetainment Media Consults, Soulvee's Emporium, EFR and Digital Products, and how to switch the automation on.

## The short answer

- **Content creation already runs inside the app.** In **Content**, the AI writes posts in each brand's voice. Each post gets a caption with a hook and a call to action, hashtags, a visual brief, a video script for reels and shorts, and a suggested posting time over the next two weeks. The AI agent can do the same from chat ("draft three posts about Friday's gig"), and **Promote** on any offer turns it into posts.
- **For posting, connect Buffer.** One Buffer API key lets Soulvee OS schedule to Instagram, TikTok, Facebook, LinkedIn, X, Threads, YouTube and Pinterest. Buffer does the scheduling, so your computer doesn't have to stay on. You also skip the hard parts of going direct to each platform: TikTok's audit, Meta's app review and X's per-post fees.
- **Make, Zapier or n8n is the alternative** if you'd rather build your own flows. Soulvee OS calls your webhook at the scheduled time with the post, signed so you can trust it.
- **You stay in control.** Nothing publishes until you approve it and press Publish. The AI can only create drafts.

## How it works in the app

1. **Generate**: pick a brand, a goal, an optional offer to promote, the platforms and how many posts. The posts arrive as drafts on the content plan, grouped by day.
2. **Review**: open a post to edit the caption (with character counters per platform), add media links, set the date and time, choose the Instagram format (post, reel or story) and add a first comment. **Polish with AI** rewrites the caption to your instruction ("shorter", "more hype", "add Pidgin").
3. **Approve**, then **Publish…**:
   - **Buffer**: choose the channels (only those matching the post's platforms are shown), then schedule for the post's time or post now. Results come back per channel, and the channels you pick become that brand's default.
   - **Webhook**: queued on the server and sent at the scheduled time; the post turns "posted" once your scenario accepts it. Failed calls are retried 3 more times (after 1, 5 and 15 minutes). A scheduled post can be cancelled.
   - **Post by hand**: copy the caption and open each platform. X, Threads and LinkedIn open with the caption filled in. Then press **I've posted it**.
4. **Track**: each post shows idea, draft, approved, scheduled, posted or failed, with the reason for any failure. **Reuse** turns an old post into a new draft.

## Option A: Buffer (recommended)

1. Create a [Buffer](https://buffer.com) account and connect your channels. Instagram must be a Business or Creator account. Check [Buffer's pricing](https://buffer.com/pricing) for how many channels your plan allows.
2. In Buffer, go to **Settings → API** and create an API key.
3. Add it to the server's `.env`, then restart Soulvee OS:
   ```
   BUFFER_API_KEY=your-key
   ```
4. Open **Setup → Social publishing**. It should say Buffer is connected and list your channels. Tick each brand's default channels.
5. If the app is hosted, also set `SOULVEE_ACCESS_TOKEN`; publishing is locked to the computer running Soulvee OS until you do.

Good to know:

- Buffer's API limits depend on your Buffer plan. Its docs give the Free plan 150 requests per 15 minutes, 600 a day and 1,000 per channel every 30 days, which is far more than a posting schedule needs.
- Buffer fetches media when the post goes out, so links must stay public and permanent. Signed or expiring links (S3 pre-signed, Cloudinary signed delivery) can fail silently.
- Soulvee OS checks the common problems before calling Buffer: Instagram, TikTok and Pinterest need media, YouTube needs a video, and X allows 280 characters. Disconnected or locked channels are skipped with a reason.
- Posts written with AI are flagged to Buffer as AI-assisted.

## Option B: Make, Zapier or n8n webhook

1. Create a scenario that starts with a webhook. In Make that's a Custom webhook; in Zapier, Webhooks by Zapier → Catch Hook; in n8n, a Webhook node.
2. Put its URL in `.env`, and optionally a secret, then restart:
   ```
   SOCIAL_WEBHOOK_URL=https://hook.eu2.make.com/…
   SOCIAL_WEBHOOK_SECRET=some-long-random-text
   ```
3. In **Setup → Social publishing**, press **Send a test post to the webhook**, so the scenario learns the data structure.
4. Route on `post.platforms` to the posting modules (Instagram for Business, Facebook Pages, LinkedIn and so on). Use `post.text` as the caption and `post.media[].url` for images and videos.
5. Keep Soulvee OS running at posting times, since it sends each post when it is due. If it was off, it sends anything missed when it starts again, marked `"late": true`.

What Soulvee OS sends (`POST`, JSON):

```json
{
  "event": "post.publish",
  "id": "job_6f1c…",
  "sentAt": "2026-11-12T18:30:01.000Z",
  "late": false,
  "post": {
    "id": "k3x9…",
    "brand": "dj",
    "title": "Wedding teaser",
    "text": "Your wedding. Your song. A dance floor that never empties. Book now.\n\n#lagosweddings #afrobeats",
    "media": [{ "type": "image", "url": "https://res.cloudinary.com/…/flyer.jpg" }],
    "platforms": ["instagram", "tiktok"],
    "scheduledAt": "2026-11-12T18:30:00.000Z",
    "igType": "",
    "firstComment": "",
    "ytCategory": "10",
    "aiAssisted": true
  }
}
```

The headers are `x-soulvee-event`, `x-soulvee-delivery` (the job id), `x-soulvee-timestamp` and, with a secret, `x-soulvee-signature`. The signature is `sha256=` followed by the HMAC-SHA256 of `timestamp + "." + body`. A test post has `"event": "test"` and `"test": true`. To check the signature, for example in n8n or your own code:

```js
const crypto = require('crypto');
const expected = 'sha256=' + crypto.createHmac('sha256', process.env.SOCIAL_WEBHOOK_SECRET)
  .update(req.headers['x-soulvee-timestamp'] + '.' + rawBody).digest('hex');
const given = String(req.headers['x-soulvee-signature'] || '');
const valid = given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
```

Notes from current reports, worth checking against each tool's docs before you build:

- Make's Instagram for Business app has photo and reel actions. One community thread reported its reel module needing an image URL too.
- Make had no native TikTok upload module in the community reports I found. Use Buffer for TikTok.
- X now charges per post through its own API (see below), so posting to X through Make or Zapier may need your own paid X developer access. Buffer avoids that.

## Why not post directly to each platform's API?

It's possible, but each platform adds work or cost, and Buffer has already done it:

| Platform | Going direct | Through Buffer |
|---|---|---|
| Instagram | Graph API needs a Business or Creator account and a Meta developer app (app review to publish for others), plus a limit of 100 posts a day | Connect the account in Buffer |
| TikTok | Content Posting API: unaudited apps can only post privately, for up to 5 users a day, until TikTok audits them | Connect the account in Buffer |
| X | Pay-per-use API since 2026: about $0.015 a post and about $0.20 for a post with a link (third-party reports) | No per-post fee from Soulvee OS |
| Facebook, LinkedIn, YouTube, Threads, Pinterest | A separate developer app and approval for each | One key covers them |

Other all-in-one posting APIs exist. [Ayrshare](https://www.ayrshare.com/pricing) is one, but third-party price checks put it at about $149 a month and up, far more than Buffer for one creator's channels.

## Making the images and videos

The AI writes a **visual brief** for every post, plus a **video script** for reels and shorts. To turn them into media:

1. Paste the brief into Canva, Higgsfield or CapCut. Canva and Higgsfield are both connected to your Claude account, so you can also ask Claude to make the image from the brief.
2. Export it and upload it somewhere public and permanent. Cloudinary's free tier works well.
3. Paste the link into the post under **Media**.

## Going further: closer to hands-off

These are possible next steps, each a clear piece of work:

- **Weekly autopilot**: a scheduled server job drafts next week's posts every Monday and notifies you to approve them. This needs the content plan stored on the server instead of only in the browser.
- **Automatic images**: generate an image from each visual brief with an image-generation API, host it, and attach it to the draft.
- **Learn from results**: read post metrics from Buffer's API, and have the generator do more of what performs.

I'd keep the approval step even with autopilot. One wrong price, date or claim on a public account costs more than the minute it takes to approve.

## Sources

- Buffer API: [Posts & Scheduling](https://developers.buffer.com/guides/posts-and-scheduling.md), [Authentication](https://developers.buffer.com/guides/authentication.md), [API limits](https://developers.buffer.com/guides/api-limits.md), [Hosting media](https://developers.buffer.com/guides/hosting-media.md), [launch post](https://buffer.com/resources/buffer-api-is-here/)
- TikTok: [Content Posting API, Direct Post](https://developers.tiktok.com/docs/en/content-posting-api-reference-direct-post)
- Instagram: [Content Publishing](https://developers.facebook.com/docs/instagram-platform/content-publishing)
- X API pricing (third-party summaries): [Upload-Post](https://www.upload-post.com/x-api-pricing/), [Postproxy](https://postproxy.dev/blog/x-api-pricing-2026)
- Make: [Instagram for Business app](https://www.make.com/en/help/app/instagram-business), [community thread on reels and TikTok](https://community.make.com/t/instagram-create-a-reel-for-creator-accounts/87862)
- Ayrshare pricing (third-party check): [Upload-Post](https://www.upload-post.com/ayrshare-pricing/)

Prices and platform rules change often; check them before you rely on them.
