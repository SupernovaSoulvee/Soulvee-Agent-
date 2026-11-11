# Automating social posting and content creation

How Soulvee OS creates and publishes posts for DJ Soulvee, Soulveetainment Media Consults, Soulvee's Emporium, EFR and Digital Products, and how to switch the automation on.

## The short answer

- **Content creation already runs inside the app.** In **Content**, the AI writes posts in each brand's voice. Each post gets a caption with a hook and a call to action, hashtags, a visual brief, a video script for reels and shorts, and a suggested posting time over the next two weeks. The AI agent can do the same from chat ("draft three posts about Friday's gig"), and **Promote** on any offer turns it into posts.
- **For posting, connect Buffer.** One Buffer API key lets Soulvee OS schedule to Instagram, TikTok, Facebook, LinkedIn, X, Threads, YouTube and Pinterest. Buffer does the scheduling, so your computer doesn't have to stay on. You also skip the hard parts of going direct to each platform: TikTok's audit, Meta's app review and X's per-post fees.
- **Make, Zapier or n8n is the alternative** if you'd rather build your own flows. Soulvee OS calls your webhook at the scheduled time with the post, signed so you can trust it.
- **It runs weekly on its own.** **Autopilot** drafts the coming week's posts for each brand on a schedule you choose, can **make an image** from each post's brief, and learns from your **Buffer results** (what's working) every time it writes.
- **You stay in control.** Nothing publishes until you approve it and press Publish. The AI and the autopilot can only create drafts.

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

The headers are `x-soulvee-event`, `x-soulvee-delivery` (the job id), `x-soulvee-timestamp` and, with a secret, `x-soulvee-signature`. The signature is `sha256=` followed by the HMAC-SHA256 of `timestamp + "." + body`. A test post has `"event": "test"` and `"test": true`. When the autopilot has drafted posts, Soulvee OS sends `"event": "autopilot.ready"` with a summary (`drafts`, `brands`, `titles` and, if `PUBLIC_URL` is set, `appUrl`), so a scenario can text or email you. **Filter your posting route on `event` = `post.publish`**, so these notices are never posted. To check the signature, for example in n8n or your own code:

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

## Images from each brief

Every post the AI writes comes with a **visual brief**, and reels and shorts also get a **video script**. Soulvee OS can turn the brief into an image automatically:

1. Get an OpenAI API key and a free [Cloudinary](https://cloudinary.com) account.
2. Add both to `.env` and restart:
   ```
   OPENAI_API_KEY=your-openai-key
   CLOUDINARY_URL=cloudinary://API_KEY:API_SECRET@CLOUD_NAME
   ```
   `CLOUDINARY_URL` is shown on your Cloudinary dashboard. Without it, set `PUBLIC_URL` to your server's public address and images are served from `PUBLIC_URL/media/…`. With neither, images stay on your server: fine for previews and posting by hand, but Buffer can't fetch them.
3. Use **Make image** on a post card, **✦ Make image from brief** in the editor, or tick **Make an image for each post** in the generator or an autopilot plan.

How the images are made:

- They use the brand's look: violet and magenta nightlife for DJ Soulvee, blue tech for SMC, gold and teal for the Emporium, and so on. Stories, reels, TikTok and Pinterest get tall images; everything else is square. They're saved as JPEG, which Instagram requires.
- Words appear on the image only when the brief asks for them, in quotes, spelled exactly. To avoid fake likenesses, images show scenes, hands, silhouettes or crowds from behind rather than identifiable faces.
- The default model is `gpt-image-2`; change it with `SOULVEE_IMAGE_MODEL` and quality with `SOULVEE_IMAGE_QUALITY`. Each image costs a few cents to a few tens of cents, depending on model and quality; check OpenAI's pricing.
- For video, use the script with CapCut, Higgsfield or your own footage, upload the file somewhere public, and paste the link under **Media**.

## What's working: learning from results

**What's working** in the Content tab reads up to 60 days of results from Buffer, using your personal API key. It works out an engagement rate for each post: Buffer's own figure where the network reports one, otherwise interactions over reach, with comments, shares and saves weighted above reactions. From those it gives:

- average engagement by platform,
- the best posting hour so far, on the autopilot's time zone,
- your top posts, plus your weakest ones once there are enough.

That summary is fed to the generator (**Use what's working**, on by default), to every autopilot run and to the AI agent (`get_social_results`, for questions like "what's working on Instagram?"). Posts published from Soulvee OS through Buffer also get their own numbers on their cards, and turn "posted". Buffer refreshes results about once a day, so new posts take a day to show up.

## Autopilot: a week of drafts, every week

1. In **Content → ⟳ Autopilot**, set the day, time and time zone. The default is Sunday 17:00 Lagos time, so the drafts cover Monday to Sunday.
2. Add a plan for each brand: posts per week, platforms, a goal, an offer to push, and whether to make images.
3. Press **Turn on**. The card shows the next run. **Run now** drafts straight away; if the scheduled run is less than 48 hours off, that run is skipped so you don't get the same week twice.

Each run, the server reads your latest Buffer results, writes each plan's posts and makes the images, then leaves the drafts in an inbox. The app brings them into Content the next time it's open, checking every minute, and shows a badge on the Content tab. If a webhook is set, the scenario gets `autopilot.ready`. You review, approve and publish as usual.

Good to know:

- Autopilot runs on the server, so the server has to be on. A run missed while it was off happens when it starts again. A hosted server needs a persistent disk for `data/`.
- The app sends the autopilot your current offers and recent post titles, so plans can push real prices and avoid repeating themselves. Nothing else leaves the device.
- Each run costs AI tokens for every post plus one image per post where images are on. A few brands at five posts a week is a small weekly cost; check Anthropic's and OpenAI's pricing.
- With `SOULVEE_ACCESS_TOKEN` set (needed when hosted), only devices that opened the app with the token can change or run the autopilot.

## Going further

- **Video**: turn each script into a short video automatically with a video-generation API. Possible, but it costs much more per post and is slower.
- **Publishing on autopilot**: technically easy, but I'd keep the approval step. One wrong price, date or claim on a public account costs more than the minute it takes to approve.

## Sources

- Buffer API: [Post Metrics](https://developers.buffer.com/guides/post-metrics.md), [Posts & Scheduling](https://developers.buffer.com/guides/posts-and-scheduling.md), [Authentication](https://developers.buffer.com/guides/authentication.md), [API limits](https://developers.buffer.com/guides/api-limits.md), [Hosting media](https://developers.buffer.com/guides/hosting-media.md), [launch post](https://buffer.com/resources/buffer-api-is-here/)
- OpenAI: [Image generation guide](https://developers.openai.com/api/docs/guides/tools-image-generation), [Create image reference](https://developers.openai.com/api/reference/resources/images/methods/generate)
- Cloudinary: [Generating authentication signatures](https://cloudinary.com/documentation/authentication_signatures), [Upload API reference](https://cloudinary.com/documentation/image_upload_api_reference)
- TikTok: [Content Posting API, Direct Post](https://developers.tiktok.com/docs/en/content-posting-api-reference-direct-post)
- Instagram: [Content Publishing](https://developers.facebook.com/docs/instagram-platform/content-publishing)
- X API pricing (third-party summaries): [Upload-Post](https://www.upload-post.com/x-api-pricing/), [Postproxy](https://postproxy.dev/blog/x-api-pricing-2026)
- Make: [Instagram for Business app](https://www.make.com/en/help/app/instagram-business), [community thread on reels and TikTok](https://community.make.com/t/instagram-create-a-reel-for-creator-accounts/87862)
- Ayrshare pricing (third-party check): [Upload-Post](https://www.upload-post.com/ayrshare-pricing/)

Prices and platform rules change often; check them before you rely on them.
