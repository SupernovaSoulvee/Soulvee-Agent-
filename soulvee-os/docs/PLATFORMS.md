# Connecting your accounts

The **Accounts** tab connects your Facebook Pages, Instagram, Threads, X, LinkedIn, Telegram, WhatsApp, Reddit, Gmail and Signal accounts. Connect as many of each as you run, for example three Facebook Pages and three Instagram accounts. Once connected:

- **Content** posts to the accounts you tick, now or at a scheduled time.
- The **Inbox** collects messages from WhatsApp, Messenger, Instagram, Telegram, Gmail, Reddit and Signal, and your replies go out from the account each message came in on.
- **CRM** contacts link to their conversations.

Give each account its **brands** (Accounts → Brands & name). A post for DJ Soulvee then ticks the DJ Page, the DJ Instagram account and the DJ Telegram channel automatically, and leaves the others alone.

Each platform needs its own developer app or token. The sections below cover what each one needs, the steps, and the limits the platform sets.

## Before you start

**Sign-in return address.** Platforms that use a sign-in (Facebook and Instagram, Threads, X, LinkedIn, Gmail) send you back to:

```
<your address>/oauth/callback/<platform>
```

Here `<your address>` is `PUBLIC_URL` if it is set, otherwise `http://localhost:8787`. `<platform>` is `meta`, `threads`, `x`, `linkedin` or `gmail`. Register that exact address in each developer app. The Accounts tab shows it too.

**Public address.** WhatsApp, and instant Messenger and Instagram messages, need Meta to reach your server, so set `PUBLIC_URL` to its public https address. Threads also only accepts an https return address. On your own computer you can use a tunnel such as Cloudflare Tunnel or ngrok. Set `SOULVEE_ACCESS_TOKEN` whenever the server can be reached from the internet.

**Where the keys live.** App IDs and secrets go in `.env`. Restart the server after changing it. Tokens you paste, and those that sign-ins return, are kept on the server in `data/accounts.json`. On Mac and Linux, only the server's user account can read that file; Windows doesn't use those permission settings, so keep the project inside your own user folder there. Tokens are never sent to the browser. Messages are kept in `data/inbox.json`. Treat the `data/` folder like a password file.

## Facebook Pages and Instagram

**What it does**
- Posts, Reels, Stories and carousels to each Page and each Instagram professional account.
- Messenger and Instagram direct messages in the Inbox.

**You need**
- A Meta developer account.
- Your Facebook Pages (you must be an admin).
- Each Instagram account switched to a professional (Business or Creator) account and linked to one of those Pages.

**Steps**
1. Go to [developers.facebook.com](https://developers.facebook.com) → My Apps → Create app. Add the use cases for managing Pages and publishing to Instagram. If you want the Inbox, also add Messenger and Instagram messaging.
2. In the Facebook Login settings, add the redirect address `<your address>/oauth/callback/meta`.
3. Copy the **App ID** and **App secret** (App settings → Basic) into `.env`:
   ```
   META_APP_ID=…
   META_APP_SECRET=…
   ```
   Restart the server.
4. Go to Accounts → Facebook Pages & Instagram → **Sign in with Facebook**. Choose every Page and Instagram account you want to manage. They all appear in Accounts, each with its own access token.

You can also connect without signing in: paste a user or Page token from Meta's Graph API Explorer with **Paste a token**. With the App ID and secret set, Soulvee OS swaps a short-lived user token for a long-lived one.

**Limits**
- Instagram posts need an image or video at a public link. Meta allows up to 100 posts through the API per Instagram account in 24 hours.
- Posting to Pages you manage works while the app is in development mode.
- Answering customers in Messenger and Instagram needs Meta's App Review, with Advanced Access for `pages_messaging` and `instagram_manage_messages`, and usually business verification. Until then the Inbox only shows conversations with people who have a role on your app.
- Without a webhook, Page and Instagram inboxes are checked every 3 minutes. For instant delivery, add a webhook in the Meta app for the Page and Instagram messaging events, using the same address and verify token as WhatsApp (below).

If your app's permissions differ, set `META_SCOPES` to the comma-separated list to ask for.

## WhatsApp Business

**What it does:** customer chats in the Inbox, with replies sent from your business number. Several numbers can be connected.

**You need**
- The WhatsApp Business Platform (Cloud API) set up in your Meta app.
- A business phone number on it.
- A public https address (`PUBLIC_URL`).

**Steps**
1. In the Meta app, add WhatsApp, and register or add your business number.
2. Create a permanent token: Business settings → System users → add a system user, give it your WhatsApp account, and generate a token with `whatsapp_business_messaging` and `whatsapp_business_management`.
3. Go to Accounts → WhatsApp Business → **Connect** and enter:
   - the token;
   - the **phone number ID**: the long number shown under your number in the WhatsApp section, not the phone number itself;
   - the **app secret**.
4. In the Meta app, open WhatsApp → Configuration → Webhook:
   - **Callback URL:** `<PUBLIC_URL>/webhooks/meta`.
   - **Verify token:** the one shown in Accounts.
   - Subscribe to **messages**.

Soulvee OS checks Meta's signature on every webhook call and refuses unsigned or wrongly signed ones.

**Limits**
- Replies are free-form within 24 hours of the customer's last message. After that WhatsApp only allows an approved template, and the Inbox asks for its name.
- Meta charges per template message: about ₦83 for a marketing template to a Nigerian number. Press reports say that since 1 October 2026 Meta also charges for replies inside the 24-hour window, at about ₦14 each in Nigeria; these were free before. Check Meta's rate card before relying on these (naira at ₦1,345 to the dollar).
- Soulvee OS sends one-to-one replies, not bulk messages.

## Threads

**What it does:** text, image, video and carousel posts. Each Threads profile signs in separately.

**Steps**
1. In your Meta app, add the Threads use case.
2. In its settings, find the **Threads app ID** and **Threads app secret**, which are different from the Meta app's. Add the redirect address `<your address>/oauth/callback/threads`. It must be https.
3. Add to `.env` and restart:
   ```
   THREADS_APP_ID=…
   THREADS_APP_SECRET=…
   ```
4. Go to Accounts → Threads → **Sign in with Threads**.

**Limits:** 500 characters per post. Sign-ins last 60 days, and Soulvee OS refreshes them in their last week.

## X

**What it does:** posts with up to four images. Each X account signs in separately.

**Steps**
1. At [developer.x.com](https://developer.x.com), create a project and app. Turn on **OAuth 2.0** with the app type "Web App, Automated App or Bot".
2. Set the callback address to `<your address>/oauth/callback/x`, and fill in a website address.
3. Add the OAuth 2.0 **Client ID** and **Client secret** to `.env` and restart:
   ```
   X_CLIENT_ID=…
   X_CLIENT_SECRET=…
   ```
4. Go to Accounts → X → **Sign in with X**.

**Limits**
- X charges for API use: about ₦20 a post, and about ₦270 for a post with a link, from third-party reports. Check that your developer account's plan or credits include creating posts.
- Posts are limited to 280 characters.
- Videos on X go through Buffer.

## LinkedIn

**What it does:** posts with images, as yourself, and as the company pages you administer once LinkedIn approves it.

**Steps**
1. At [linkedin.com/developers](https://www.linkedin.com/developers/apps), create an app linked to your LinkedIn Page.
2. Add the products **Share on LinkedIn** and **Sign In with LinkedIn using OpenID Connect**.
3. In Auth, add the redirect address `<your address>/oauth/callback/linkedin`.
4. Add to `.env` and restart:
   ```
   LINKEDIN_CLIENT_ID=…
   LINKEDIN_CLIENT_SECRET=…
   ```
5. Go to Accounts → LinkedIn → **Sign in with LinkedIn**.

**Company pages**
1. Request the **Community Management API** product.
2. Once LinkedIn approves it, add:
   ```
   LINKEDIN_SCOPES=openid profile w_member_social w_organization_social r_organization_social rw_organization_admin
   ```
3. Reconnect. Every page you administer appears in Accounts.

**Limits**
- Posts are limited to 3,000 characters.
- Sign-ins last 60 days, and Accounts warns a week before.
- LinkedIn's API version is set with `LINKEDIN_VERSION`, default `202608`. LinkedIn retires each version after about a year, so move it forward if LinkedIn says the version is not active.

## Telegram

**What it does:** posts to your channels and groups, and messages people send your bot appear in the Inbox. Free, with no review.

**Steps**
1. In Telegram, message **@BotFather**, send `/newbot` and follow the prompts. Copy the token.
2. Add the bot to each channel as an **admin** with permission to post messages.
3. Go to Accounts → Telegram → **Connect**. Paste the token and the channels, for example `@soulveemusic, @soulveeplus`.
4. Add more channels later with **+ Channels** on the bot.

**Limits**
- 4,096 characters per message, and 1,024 for a photo caption. Longer text follows the photo as its own message.
- A bot's messages can only be read by one tool. If another tool has set a webhook on the bot, use a separate bot for Soulvee OS.

## Reddit

**What it does:** posts to your profile or a subreddit, with private messages in the Inbox.

**Before you start:** since late 2025 Reddit reviews API access before an app may use it, and it refuses most personal apps. Without an approved app, post to Reddit by hand: **Post by hand → Open Reddit** fills in the title and text.

**Steps, with an approved app**
1. At [reddit.com/prefs/apps](https://www.reddit.com/prefs/apps), create a **script** app. Use any address as the redirect, for example `http://localhost:8787`.
2. Go to Accounts → Reddit → **Connect**. Enter:
   - the app's client ID (shown under its name) and secret;
   - the account's username and password (script apps don't work with two-factor sign-in);
   - optionally, a default subreddit.

**Limits:** each post needs a title, which you can change when publishing. Follow each subreddit's rules about self-promotion.

## Gmail

**What it does:** new emails that match a search appear in the Inbox, and replies go out in the same email thread. Several mailboxes can be connected.

**Steps**
1. In [Google Cloud Console](https://console.cloud.google.com), create a project and enable the **Gmail API**.
2. Set up the **OAuth consent screen** (External) and add yourself as a test user.
3. Under Credentials, create an **OAuth client ID** of type Web application, with the redirect address `<your address>/oauth/callback/gmail`.
4. Add to `.env` and restart:
   ```
   GOOGLE_CLIENT_ID=…
   GOOGLE_CLIENT_SECRET=…
   ```
5. Go to Accounts → Gmail → **Sign in with Google**.

**Limits**
- While the Google app is in "Testing", Google ends the sign-in after 7 days. To keep it connected, publish the app. It can stay unverified for your own use; Google shows a warning screen when you sign in.
- By default the Inbox takes Primary emails from the last 7 days. Change the search in Accounts → Brands & name.

## Signal

**What it does:** one-to-one chats in the Inbox.

**Before you start:** Signal has no official API for businesses. This uses **signal-cli-rest-api**, a community bridge you run yourself. Use a dedicated number, and only for one-to-one conversations.

**Steps**
1. Run the bridge, for example with Docker:
   ```
   docker run -d --name signal-api -p 8080:8080 \
     -v $HOME/.local/share/signal-api:/home/.local/share/signal-cli \
     -e MODE=native bbernhard/signal-cli-rest-api
   ```
2. Register or link your number on it, following the bridge's README.
3. Go to Accounts → Signal → **Connect**. Enter the bridge address, for example `http://localhost:8080`, and the number in international format.

**Limits:** run the bridge in `normal` or `native` mode. In `json-rpc` mode it only hands out messages over a websocket, which Soulvee OS doesn't use.

## TikTok

TikTok's own API only lets audited apps post publicly, so TikTok posts go through **Buffer**. Connect your TikTok accounts in Buffer, add `BUFFER_API_KEY`, and they appear in Accounts and in the publish window. Buffer covers YouTube and Pinterest the same way. See [SOCIAL-AUTOMATION.md](SOCIAL-AUTOMATION.md).

## Advanced settings

| Variable | What it does |
|---|---|
| `META_GRAPH_VERSION` | Meta Graph API version. Default `v26.0`. |
| `META_SCOPES` | Facebook Login permissions to ask for, comma-separated. |
| `META_WEBHOOK_VERIFY_TOKEN` | Your own verify token, instead of the one Soulvee OS generates. |
| `LINKEDIN_VERSION` | LinkedIn API version (YYYYMM). Default `202608`. |
| `LINKEDIN_SCOPES` | LinkedIn permissions, e.g. with the organization scopes for company pages. |
| `SOULVEE_INBOX_MS` | How often accounts are checked for messages, in milliseconds. Default `60000`. |
