# Email Tracker

A self-hosted email campaign & contact tracking system: import a contact
list, send campaigns, and track opens/clicks/bounces per contact through a
dashboard — no third-party marketing platform, no shared database with
anyone else's data.

See `product-spec.md` for the full technical spec and `BUILD-ROADMAP.md`
for how this was built.

## Build status

**Stage 0 baseline + Stage 1 — complete and tested against a
real running server:** two separate contact lists (sendable + view-only
supplier reference), manual CSV import, browser-extension push import,
in-app campaign builder, dual-track sending (established mailbox +
custom domain), automated reputation warm-up curve with automatic
bounce/complaint throttling, seed-testing scaffolding, device breakdown,
SendGrid bounce/complaint webhook.

**Stage 3 (flagging) — complete:** automatic flags on bounce, 5+ opens
with no click, and unsubscribe within 24h of a send, each deduplicated
so repeated events don't spam the Needs Attention panel; flags can be
resolved from the dashboard.

**Stage 4 (Discord notifications) — complete:** four independent,
client-configured webhook channels — new contacts, flagged contacts,
campaign sends, and replies (the last fires once Stage 5 exists; the
channel itself is ready now). See `SETUP.md`.

**Known limitation:** actual email *delivery* through real SMTP hasn't
been tested (no outbound SMTP access in the build environment) — confirm
this on your own deployment. Seed testing logs placement as "unknown"
until Stage 5's IMAP watcher is built.

**Not yet built:** reply detection + inbox (Stage 5), auto-reply
(Stage 6, optional), Discord bot (Stage 7, optional).

## Deploy your own instance

Each deployment is fully independent — your own Railway project, your
own database, your own credentials. Nobody else can see your data.

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.com/template/3t81gD)

Clicking this asks you to fill in the values below, then builds and
starts your own copy. Takes about 10–15 minutes if you already have your
sending domain and SMTP credentials ready.

### What each variable means

| Variable | Required? | What it is |
|---|---|---|
| `PUBLIC_URL` | Required | The web address people will use to reach your dashboard. Railway fills this in automatically to match the URL it gives your deployment — you don't need to change it before deploying. |
| `SMTP_B_HOST` | Required | The outgoing mail server address for your **main bulk-sending account** (e.g. `smtp.sendgrid.net` if you use SendGrid). This is your primary sending channel — "Track B" in the dashboard. |
| `SMTP_B_PORT` | Required | The port number for that mail server. `587` is the standard choice for almost every provider. |
| `SMTP_B_USER` | Required | The username for that mail server login. For SendGrid this is literally the word `apikey`. |
| `SMTP_B_PASS` | Required | The password or API key for that mail server login. Keep this secret — treat it like a password. |
| `SMTP_B_FROM` | Required | The email address your campaigns will appear to be sent from (e.g. `hello@yourcompany.com`). |
| `DOMAIN_SENT_BEFORE` | Required | Type `true` if your sending domain has already sent bulk email before (an existing business email address). Type `false` if this is a brand-new domain — the system will then automatically ramp up sending volume gradually over a few weeks to protect your deliverability, instead of sending everything at once. |
| `SEND_DELAY_MS` | Required | How many milliseconds to wait between each individual email in a campaign. `200` is a safe default — don't set this to `0`, it helps avoid your emails being flagged as spam. |
| `SMTP_A_HOST` | Optional | The mail server for a **second, low-volume sending account** (e.g. your everyday Gmail/Outlook inbox with an "app password") — used only for occasional one-off replies to a specific contact, not bulk campaigns. Leave blank if you don't need this. |
| `SMTP_A_PORT` | Optional | The port for that second account. `587` for most providers. |
| `SMTP_A_USER` | Optional | The username/login for that second account. |
| `SMTP_A_PASS` | Optional | The password or app password for that second account. Keep this secret. |
| `SMTP_A_FROM` | Optional | The email address that second account sends from. |
| `SEED_ADDRESSES` | Optional | A comma-separated list of your own test email addresses across Gmail, Outlook, and Yahoo (e.g. `me@gmail.com,me@outlook.com`). Every campaign also sends to these so you can manually check whether it landed in your inbox or spam folder. Leave blank to skip this check. |
| `SENDGRID_WEBHOOK_VERIFICATION_KEY` | Optional | Only needed if you want to cryptographically verify that bounce/complaint notifications really came from SendGrid. Safe to leave blank — notifications still work, just without that extra verification step. |
| `DISCORD_WEBHOOK_NEW_CONTACTS` | Optional | Posts to a Discord channel of your choice whenever new contacts are added (CSV import or extension sync). See `SETUP.md` for how to get this URL from your own Discord server — takes about a minute. Leave blank to skip. |
| `DISCORD_WEBHOOK_REPLIES` | Optional | Posts to Discord when a contact replies to a campaign. (This channel is ready now — the reply-detection feature that triggers it is coming in a later update.) |
| `DISCORD_WEBHOOK_FLAGGED` | Optional | Posts to Discord whenever a contact is automatically flagged for attention (bounced, opened 5+ times with no click, or unsubscribed right after a send). |
| `DISCORD_WEBHOOK_CAMPAIGN_SENDS` | Optional | Posts to Discord with a summary every time a campaign finishes sending. |

You do **not** need to set `PORT` — Railway assigns this automatically.

Setting up Discord notifications takes about a minute per channel and
needs no bot or developer account — see `SETUP.md` for the exact steps.

## Local setup (for development, not required for the one-click deploy)

```bash
npm install
cp .env.example .env
# edit .env with your own values
npm start
```

Visit `http://localhost:3000/index.html` for the dashboard.

## What's included

```
email-tracker/
├── server.js          # Express server (dashboard + API + tracking endpoints)
├── send.js            # Campaign send pipeline, also used by the in-app campaign builder
├── db.js              # SQLite schema (via Node's built-in node:sqlite — no native build step)
├── lib/                # Shared logic: import merge rules, mailer, tracking, reputation/warm-up, seed testing
├── routes/             # /api/*, /extension-sync/*, /track/*, /unsubscribe/*, /webhooks/sendgrid
├── public/index.html   # Dashboard
└── scripts/smoke-test.sh  # End-to-end API test script
```

**Two contact lists, fully separate:** `dedup_contacts` is the sendable
list — all sending, tracking, and flagging logic operates on this table
only. `supplier_contacts` is a view-only reference list, never used for
sending even if the same email appears in both.

## Important limitations

- If a recipient's email client blocks remote images, opens won't register.
- Apple Mail Privacy Protection can register a false "open" before the
  recipient actually reads the email. Click tracking is unaffected.
- This records aggregate delivery/engagement data only, not message content.

## Legal requirements for bulk/marketing email

Most jurisdictions require a working unsubscribe mechanism (included —
already honored on every send), accurate sender identification, and not
using purchased/scraped lists without consent (CAN-SPAM in the US, CASL
in Canada, GDPR/PECR in the EU/UK). This tool provides the mechanics;
compliance in your jurisdiction is on you.
