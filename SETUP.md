# Setup Guide

This walks through every value you'll be asked for when deploying your
own instance, in plain language. Each deployment is fully independent —
your own database, your own credentials, nobody else can see your data.

## Email sending (required)

You need an account with an email-sending provider (SendGrid, Mailgun,
Amazon SES, or a Gmail/Outlook "app password" for low volume). This
gives you: `SMTP_B_HOST`, `SMTP_B_PORT`, `SMTP_B_USER`, `SMTP_B_PASS`,
`SMTP_B_FROM` — see the table in `README.md` for exactly what each one
means.

`SMTP_A_*` is optional — only fill these in if you also want a second,
low-volume sending account (e.g. your everyday inbox) for occasional
one-off replies, separate from bulk campaigns.

## Discord notifications (optional)

You can get notified in Discord instead of only checking the dashboard.
There are **four separate channels**, and each is entirely optional —
set up only the ones you want. Leaving any of them blank simply means
that channel won't fire; nothing breaks.

| Env var | Fires when |
|---|---|
| `DISCORD_WEBHOOK_NEW_CONTACTS` | A CSV import or extension sync adds new contacts |
| `DISCORD_WEBHOOK_REPLIES` | A contact replies to a campaign *(coming in a later update — safe to set up now)* |
| `DISCORD_WEBHOOK_FLAGGED` | A contact gets automatically flagged for attention (bounced, 5+ opens with no click, or unsubscribed right after a send) |
| `DISCORD_WEBHOOK_CAMPAIGN_SENDS` | A campaign finishes sending, with a summary of how many went out |

### How to get a webhook URL for one channel

You'll repeat these steps once per channel you want (up to four times —
once per row in the table above):

1. Open your Discord server (or create one just for this, if you don't
   want to mix it with an existing server).
2. Create a text channel for this notification type — e.g. `#new-contacts`,
   `#flagged`, `#campaign-sends`, `#replies` — or reuse an existing channel.
3. Click the gear/settings icon next to that channel name → **Integrations**
   → **Webhooks** → **New Webhook**.
4. Give it a name (anything you like, e.g. "Email Tracker Bot") and click
   **Copy Webhook URL**.
5. Paste that URL into the matching environment variable above (e.g. the
   webhook for your `#flagged` channel goes into `DISCORD_WEBHOOK_FLAGGED`).

No Discord bot, no developer account, no code — just a URL you paste in.
Keep each URL private; anyone who has it can post messages into that
channel.

## SendGrid bounce/complaint webhook (optional)

If you want bounce/spam-complaint events reported back automatically
(feeds the Reputation page and the auto-flagging), point your SendGrid
account's Event Webhook at:

```
https://<your-deployed-url>/webhooks/sendgrid
```

`SENDGRID_WEBHOOK_VERIFICATION_KEY` is optional — only needed if you want
to cryptographically verify the events really came from SendGrid.

## Everything else

See the variable table in `README.md` for `PUBLIC_URL`,
`DOMAIN_SENT_BEFORE`, `SEND_DELAY_MS`, and `SEED_ADDRESSES`.
