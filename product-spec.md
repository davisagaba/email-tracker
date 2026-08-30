# Email Campaign & Contact Tracking System — Product Spec

## 1. Overview

A self-hosted email marketing and tracking tool: import a contact list, send
campaigns, track opens/clicks/bounces/replies per contact, flag contacts
that need personal attention, and surface all of it through a dashboard and
Discord notifications.

Built incrementally, in stages. Each stage is fully usable on its own before
the next is added.

---

## 2. Goals

- Own contact and engagement data instead of depending on a third-party platform
- Track opens, clicks, bounces, and replies per contact
- Surface contacts worth personal follow-up, without manually reading every event
- Get notified in Discord, not just on a dashboard
- Keep monthly cost low ($0–50/month depending on list size)

## 3. Non-goals

- Not a full CRM (no pipeline stages, deal tracking, or manual status fields — beyond what's noted in §7)
- Not a content/sentiment analysis tool — replies are detected and logged, not read/summarized by the system (though the in-app inbox, §6 Stage 5, does let you read and reply to the raw message manually)
- Not a drag-and-drop visual email builder
- Not multi-user / team permissions in v1 — single operator

---

## 4. Architecture

```
Marketing CSV (Discord) ─┐
                          ├─▶ Contact Import ─▶ SQLite DB ─▶ Send Engine ─▶ SMTP ─▶ Recipients
Manual CSV upload ────────┘                         │                          │
                                                      │                          ▼
                                              Dashboard (web UI)      Tracking pixel + click
                                                      ▲                  redirect + IMAP reply
                                                      │                  watcher
                                              Discord Webhooks ◀── Event log (opens/clicks/
                                                                    bounces/replies/flags)
```

**Components:**
- Node.js + Express server
- SQLite database (contacts, campaigns, sends, events)
- Nodemailer for outbound SMTP sending
- IMAP client for inbound reply detection (Stage 5+)
- Discord webhooks for outbound notifications
- Optional Discord bot for inbound CSV pulling (Stage 7)
- Static HTML/JS dashboard served by the same Express app

---

## 5. Data model

| Table | Purpose | Key fields |
|---|---|---|
| `dedup_contacts` | The sendable list — one row per person eligible to receive campaigns. This is the table all sending, tracking, flagging, and reply logic operates on. | email, name, company, phone, source_row_id, metadata (JSON), subscribed, created_at, source_import_id |
| `supplier_contacts` | The full reference list — every contact from the overall supplier sheet, kept fully separate from `dedup_contacts`. View-only: never used for sending, never joined into campaign/tracking logic. | email, name, company, phone, source_row_id, metadata (JSON), created_at, source_import_id |
| `campaigns` | One row per send | name, subject, template_file, sent_at |
| `sends` | Join: which **dedup** contact got which campaign | tracking_id (unique per contact+campaign), campaign_id, contact_id (references `dedup_contacts`), sent_at |
| `events` | Every tracked action | tracking_id, type (open/click/bounce/reply), url, ip, user_agent, device, created_at |
| `flags` | Contacts needing attention (dedup list only) | contact_id (references `dedup_contacts`), reason, created_at, resolved (bool) |
| `imports` | Log of every import, tagged by which list they targeted | source (manual/extension/discord), target_list (dedup/supplier), row_count, added_count, skipped_count, created_at |
| `sync_tokens` | Per-client secret used by the browser extension to authenticate pushes | token (unique), label, created_at, last_used_at |
| `messages` | Full email thread per contact (in-app inbox, Stage 5) | contact_id (references `dedup_contacts`), direction (inbound/outbound), subject, body, message_id, in_reply_to, created_at |
| `seed_results` | Per-send inbox/spam placement check (Stage 1) | campaign_id, provider (gmail/outlook/yahoo), placement (inbox/spam/missing), checked_at |

**Why two separate tables, not one table with tags:** keeping
`supplier_contacts` and `dedup_contacts` as distinct tables (rather than
one `contacts` table with a list-membership tag) means there's no risk of
a query mistake accidentally pulling supplier-list contacts into a send —
the sending/tracking pipeline is only ever wired to `dedup_contacts` at the
schema level, not filtered by application logic that could have a bug. A
contact appearing on both sheets simply has a row in each table
independently; there's no shared identity between them at the database
level.

**Field mapping and the flexible `metadata` column:** real-world source
data (e.g. from the browser extension) commonly looks like a business
directory export — columns such as `id`, `businessName`, `contactName`,
`email`, `phone`, `commodity`, `location`, `province`, `district`,
`taxStatus`, `hasLocalAddress`. Rather than hard-coding every possible
column (which would break the moment a client's spreadsheet has a
different shape), the schema maps the common, broadly-useful fields
explicitly and stores everything else as-is:

| Source column | Maps to |
|---|---|
| `email` | `email` (required) |
| `contactName` | `name` |
| `businessName` | `company` |
| `phone` | `phone` |
| `id` (the source spreadsheet's own row ID) | `source_row_id` — kept for traceability back to the original sheet, not used as this table's primary key |
| Everything else (`commodity`, `location`, `province`, `district`, `taxStatus`, `hasLocalAddress`, and any future columns) | stored as a single `metadata` JSON blob, key-value, unmodified |

This keeps the import robust against schema variation across different
clients' spreadsheets — no column is silently dropped, and no migration is
needed when a new client's sheet has slightly different extra fields. The
dashboard's contact detail view renders `metadata` as a simple key/value
list underneath the core fields, so nothing collected is ever hidden, just
not specially modeled in code.

---

## 6. Feature breakdown by stage

### Stage 0 — Deployment
No new features — makes the base system (contacts, campaigns, open/click
tracking, dashboard) live and reachable. Steps, in order:

1. **Buy a domain** — any registrar (Namecheap, Cloudflare, Google
   Domains/Squarespace), ~$10–15/year.
2. **Set up a real inbox on that domain** — the registrar alone doesn't
   provide an inbox. Options:
   - **Google Workspace** (~$6/user/month) — recommended, since Stage 5
     (reply detection) needs reliable IMAP/App Password access later
   - **Zoho Mail** — free tier available for a single custom-domain inbox,
     lighter-weight alternative
   - Some registrars bundle basic email hosting directly
   This inbox is where campaign replies actually land (chosen over
   forwarding to an existing inbox — see decision log below).
3. **GitHub account** — holds the code
4. **Railway account** — runs the server 24/7
5. **SendGrid account** — sends the campaign emails
6. **DNS records (SPF, DKIM, DMARC)** — configured on the domain, covering
   both the sending address and the new inbox, so campaign mail is trusted
   by Gmail/Outlook and replies route correctly

**Decision log:** replies will land in a **new inbox created on the new
domain**, not forwarded from an existing Gmail/Outlook — decided in favor of
keeping campaign correspondence separate from personal/other business email.

### Stage 1 — CSV import + delivery visibility + in-app campaign builder
- Manual CSV upload via dashboard (marketing's export, pasted in directly)
- Merge logic: new emails added, existing updated, unsubscribed contacts stay unsubscribed regardless of re-import
- Import log (`imports` table) — who/when/how many added vs. skipped
- Device breakdown on opens (desktop/tablet/mobile, parsed from user-agent)
- Bounce tracking via SMTP provider webhook
- Dashboard: delivery/bounce panel, device breakdown chart, bounce-rate/complaint-rate warning threshold (see §14 — Deliverability)
- Domain health checklist item (SPF/DKIM/DMARC verified) surfaced in dashboard setup screen
- **Browser extension import — the sole spreadsheet ingestion method** (no
  Google Sheets API integration; superseded by this): the client uses an
  existing, separately-built browser extension that already holds/collects
  their spreadsheet data. That extension pushes data **to** this tool — the
  tool never pulls from Sheets directly, and no Google Cloud
  credentials/OAuth are needed on this side at all.
  - **Mechanism**: the dashboard generates a unique per-client sync token
    (same pattern as other per-client credentials). The client pastes the
    token, plus **two separate URLs**, into the extension once:
    - `POST /extension-sync/dedup` — pushes into the sendable list
    - `POST /extension-sync/supplier` — pushes into the view-only reference list
    Two fixed URLs rather than one URL with a hidden `target` field in the
    body — simpler to configure on the extension side, and it's immediately
    obvious from the URL alone which list a given push is going to.
  - **Receiving endpoints**: each accepts a batch of rows and runs them
    through the exact same import logic already built for manual CSV paste
    — same merge rules, same "unsubscribed stays unsubscribed" protection,
    routed into the correct one of the two fully separate tables
    (`dedup_contacts` / `supplier_contacts`; see §5). Both endpoints share
    the same underlying import function — only the target table differs.
  - **Real payload shape**: rows arrive as whatever columns the source
    spreadsheet has — observed example: `id`, `businessName`,
    `contactName`, `email`, `phone`, `commodity`, `location`, `province`,
    `district`, `taxStatus`, `hasLocalAddress`. The import function maps
    known fields (`email`, `contactName`→name, `businessName`→company,
    `phone`, `id`→source_row_id) and stores the rest in `metadata` — see
    §5 for the full mapping table. `email` is the only required field per
    row; a row missing it is skipped, not rejected wholesale (the rest of
    the batch still imports).
  - **No date-based sorting or filtering needed**: the extension pushes
    everything it currently holds — old and newly-collected rows mixed
    together — in one batch, every sync. The tracker doesn't need to know
    *when* a row was originally collected; it only checks whether the email
    already exists (`INSERT OR IGNORE`). A duplicate from an old sync is
    silently skipped regardless of collection date, so repeated full syncs
    are always safe to send as-is, with no chronological logic required on
    either side.
  - **Per-client protocol, not a shared connection**: consistent with the
    rest of the per-client deployment model — each client's instance has
    its own sync token, and data pushed by one client's extension can never
    reach another client's database, since each deployment is fully
    separate infrastructure.
  - **Security note**: the sync token should be treated as a secret (like
    an API key) — anyone with it could push arbitrary contact rows into
    that client's instance via either URL. Token should be long/random and
    regeneratable from the dashboard if it's ever exposed.
- **In-app campaign builder**: a "New Campaign" dashboard page — subject
  line, recipient selection, and a body editor (plain text area to start;
  basic rich-text formatting can follow) — with a "Send" button that
  triggers the same personalization/tracking pipeline currently run via
  `node send.js` from the terminal. No new backend logic required; this is
  a UI layer in front of what's already built. Optional refinements: save
  as draft before sending, preview the rendered email (with sample
  personalization filled in) before it goes out.
- **Dual-track sending**: two separate sending identities, routed by
  campaign type/priority:
  - **Track A — established mailbox** (Gmail/Outlook via app password): no
    warm-up needed, usable immediately, but capped low (~dozens/day, well
    under provider limits of ~500–2,000/day) — used for low-volume,
    high-priority sends (e.g. replying to a flagged high-intent contact),
    not bulk campaigns, to avoid provider ToS risk.
  - **Track B — custom domain**: the primary bulk-sending channel, subject
    to the warm-up curve below. No provider-imposed cap once warmed;
    scales with reputation.
  - Both tracks reuse the same send/tracking pipeline — only the SMTP
    account differs. Reply detection (Stage 5) watches both inboxes.
  - Track A is available from day one; Track B ramps up in parallel over
    the warm-up period — the client isn't blocked on sending anything
    while the domain warms.
- **Warm-up is conditional, decided at onboarding — not a blind toggle.**
  When a client's instance is first set up (during deployment/SETUP.md
  onboarding), they're asked one question: *"Has this domain sent bulk
  email before?"*
  - **No** (new/unused domain) → warm-up runs automatically as described
    below; this is the default and the safe path.
  - **Yes** (established domain, e.g. an existing business switching
    tools) → warm-up is skipped, full volume allowed from day one, since
    the domain already carries reputation and artificial pacing would
    serve no purpose.
  - This is a one-time setup answer per client instance, not a setting
    revisited later — each client's deployment is independent (§ per-client
    deployment model), so this only needs deciding once, at onboarding.
  - **Automatic throttling (bounce/complaint monitoring) stays active
    either way** — that protection is never optional, regardless of
    whether warm-up itself runs.
- **Automated reputation warm-up (Track B)**: when warm-up is active (see
  above), the system tracks how long the sending domain has been active
  and automatically caps daily send volume against a built-in ramp-up curve
  (e.g. day 1–3: ~50/day, day 4–7: ~150/day, scaling up from there — see
  §14 for the underlying framework). **Warm-up volume is sent to a segment
  of real, engaged contacts pulled from the contact book** — not seed
  accounts (see below) — because real opens/clicks/replies are the actual
  trust signal providers weight; an unopened seed inbox builds no
  reputation at all. The segment should be the most-engaged subset
  available (existing customers, recent opt-ins), still capped to the same
  daily volume curve, and monitored closely for bounce/complaint on this
  specific segment since it's the foundation the rest of the domain's
  reputation is built on.
- **Live reputation status**: a dashboard indicator showing current bounce
  rate, complaint rate, and days since warm-up started, so reputation
  health is visible at a glance.
- **Automatic throttling**: if bounce or complaint rate crosses the
  unhealthy thresholds already defined in §14 (~5% bounce, ~0.1% complaint),
  the system automatically pauses or slows sending rather than waiting for
  the operator to notice and intervene manually.
- **Seed testing (diagnostic, separate from warm-up)**: every campaign send
  automatically includes a small, fixed set of "seed" test addresses —
  mailboxes the operator maintains across major providers (Gmail, Outlook,
  Yahoo, etc.) — alongside the real recipient list. Seed accounts do **not**
  build reputation; their only purpose is to check, after each send,
  whether that specific campaign landed in inbox or spam, surfaced on the
  campaign's stats page. This is a per-send, per-provider deliverability
  diagnostic, independent of the warm-up mechanism above — it catches a
  placement problem on the send that caused it, rather than after it's
  already affected real contacts.
  - Requires: a small set of maintained test mailboxes (one per major
    provider) — either self-created free accounts or a seed-list service.
  - Inbox-vs-spam detection is done via a check that reads the seed
    mailboxes (IMAP, similar mechanism to the reply-detection watcher in
    Stage 5) shortly after each send and looks for the campaign in the
    inbox vs. spam folder.

### Stage 3 — Flagging
*(Stage 2, welcome emails, was removed from scope — see §12.)*
- Rule-based flags: reply (once Stage 5 exists), 5+ opens with no click, bounce, unsubscribe within 24h of a send
- Each flag stores a reason
- Dashboard: "Needs Attention" panel, filtered list with reason + contact + last event
- Flags do not auto-pause other automation in v1 (open question, see §9)

### Stage 4 — Discord notifications
Four webhook channels, no bot required. **Client-provided, per-instance —
not a shared set**: consistent with the per-client deployment model
already used for domain/SendGrid/extension-sync credentials, each client
generates their own four webhook URLs (Discord Server Settings →
Integrations → Webhooks) and supplies them as env vars during their own
setup — documented in `SETUP.md` the same way `SMTP_*` is. Each channel
is optional independently; a channel left unconfigured simply doesn't
fire, rather than erroring.
- `#new-contacts` — import completions, individual adds
- `#replies` — fires once Stage 5 is live
- `#flagged` — fires on any new flag from Stage 3
- `#campaign-sends` — fires when a campaign finishes, with running stats

### Stage 5 — Reply detection + in-app inbox
- IMAP watcher polls inbox, matches incoming mail to a contact by sender address and/or `In-Reply-To`/`Message-ID` threading
- Logs a `reply` event, creates a flag, posts to `#replies`
- Dashboard: reply feed (recent replies across all contacts)
- **In-app inbox**: read the full incoming message and send a reply directly
  from the dashboard — no switching to Gmail/Outlook. The reply is sent
  through the same SMTP connection used for campaigns, threaded correctly
  (`In-Reply-To`/`References` headers) so it lands in the same conversation
  in the recipient's inbox. Reuses the IMAP connection already required for
  reply detection — this is a send action layered on existing
  infrastructure, not a new integration.
- Contact detail view (dashboard) shows the full email thread per contact,
  not just an event log — read history and reply in one place

### Stage 6 — Auto-reply (optional)
- Triggered by first reply in a thread only (not every back-and-forth)
- Keyword guardrails (e.g. skip auto-reply if message contains "unsubscribe," "stop")
- **Recommended mode: draft + queue for approval**, not instant auto-send, until reply volume/content is well understood
- Full auto-send is possible but carries reputational risk (wrong or oddly-timed replies are visible to real people, possible reply-loops with other auto-responders)

### Stage 7 — Discord bot for inbound CSV (optional)
- Bot watches a channel for file attachments, downloads CSV, calls the same import endpoint as Stage 1's manual upload
- Optional `/addcontact email name` slash command for one-offs
- Highest setup cost of any stage (Discord developer portal, bot permissions, persistent bot process) — only worth it if manual import becomes frequent/annoying

---

## 7. What the system tracks (full picture once built)

**Per contact:** added date, import source, subscribed status, full event history across all campaigns.

**Per campaign/send:** sent status, opens (count + timestamps + device), clicks (which links, count, timestamps), bounces, replies.

**Derived:** engagement funnel per contact (sent → opened → clicked → replied), flags with reasons.

**Explicitly not tracked:** why someone engaged or didn't (no sentiment/intent inference), any activity outside emails you sent them, reply *content* interpretation (replies are detected and logged, not summarized — reading them is on you unless a future stage adds that).

---

## 8. Automation level by stage

| Stage | Runs fully hands-off? |
|---|---|
| 1–5 | Yes — no human action needed once deployed |
| 6 (auto-reply) | Can be automatic, but "draft + approve" is the recommended default |
| 7 (Discord bot) | Yes, once configured |

---

## 9. Open decisions (to revisit before/during build)

- Should a flag pause other automation for that contact (e.g. stop auto-reply while you're personally handling them)? — leaning toward yes, not yet built
- Priority tiers on flags, or one flat list? — not yet decided
- Stage 6: full auto-send vs. draft-and-approve — recommend deciding after seeing real Stage 5 reply volume

---

## 9a. Comparison to established tools

Benchmarked against Mailchimp, ActiveCampaign, Brevo, and cold-outreach tools
(Smartlead, Instantly) to identify real gaps versus the market.

**Where this build already holds up well:**
- Reply detection (Stage 5) is rarer than expected — most mainstream platforms
  (Mailchimp, ActiveCampaign, HubSpot, Klaviyo, Salesloft, Outreach) are
  one-way senders that don't pull replies back automatically; a rep either
  misses the reply or logs it manually. Two-way inbox sync is treated as an
  advanced/premium feature even among established players.
- Self-hosted data ownership — none of the competitors offer this; all are
  SaaS platforms where contact data lives on their infrastructure.
- Discord-native notifications — not offered by any competitor surveyed.

**Genuine gaps versus established tools:**

| Feature | Established tools | This build |
|---|---|---|
| Visual drag-and-drop email builder | Standard (Mailchimp, ActiveCampaign) | Raw HTML templates, hand-edited |
| AI-generated subject lines/copy | Standard on most platforms | None |
| Point-based lead scoring | ActiveCampaign scores contacts by weighted actions (clicks, location, page visits), targets by threshold | Binary flags only (flagged / not flagged) |
| AI reply categorization | Smartlead/Instantly auto-sort replies into Interested / Neutral / Not Interested / Out of Office / Unsubscribe | Detects *that* someone replied, not *what kind* |
| Dynamic segmentation / tags | Group contacts by behavior, purchase history, engagement | Subscribed / unsubscribed only |
| A/B / split testing | Standard on ActiveCampaign, Mailchimp | None |
| Deliverability infrastructure | Dedicated IP management, automated warmup, reputation protection built into the platform | Relies entirely on the chosen SMTP provider's own reputation |
| Multi-channel (SMS/WhatsApp) | Standard on ActiveCampaign, others | Email only |
| Landing pages / signup forms | Standard | None |
| Receive + reply to email in one tool | Brevo Inbox and Mailchimp Inbox both offer this; Mailchimp gates messaging new contacts behind a paid plan | **Now in scope** — added to Stage 5 as an in-app inbox (§6) |

**Brevo specifically:** worth noting Brevo users have hit the same limitation
we flagged for Stage 6 — a Brevo community thread shows a user wanting an
automation trigger for "recipient replied" (to stop further sequence emails)
and not finding one in Brevo's builder. Reply *detection feeding automation*
is a gap even in tools that already have a reply *inbox* — the two aren't
the same feature, and it's worth keeping that distinction sharp in our own
build: Stage 5 gives both (detection that can trigger flags/automation, and
now a place to read/respond), which is actually ahead of Brevo on this
specific point despite Brevo's inbox existing longer.

**Recommendation:** most of the above (visual builder, A/B testing,
multi-channel, landing pages) are large builds that would turn this from a
lean tool into a full Mailchimp-class platform — not worth the scope
increase for this project's goals (§2–3). Two items are cheap, high-value
additions worth adding to the roadmap since they reuse data already being
collected:

- **AI reply categorization** — one LLM call per incoming reply, classifying
  it as interested / not interested / question / unsubscribe-intent, layered
  on top of the existing reply-detection flag (Stage 5). No new
  infrastructure required.
- **Simple point-based engagement score** — replace or supplement the binary
  "flagged / not flagged" state with a running score per contact (e.g. open
  = +1, click = +3, reply = +10), so the Needs Attention list can be sorted
  by actual engagement strength rather than just recency.

Both are proposed as an extension of Stage 3 (flagging) and Stage 5 (reply
detection) — not a new stage — since they enhance existing data rather than
requiring new integrations.

---

## 10. Tooling & accounts required

**Local machine:** Node.js, a code editor (VS Code), Git, terminal.
**Accounts:** Domain registrar (Namecheap/Cloudflare/etc.), email hosting for the domain (Google Workspace or Zoho Mail), GitHub (code), Railway (hosting), SendGrid (sending), Discord (already have, for webhooks/bot).
**Optional later:** Discord Developer Portal app for the bot (Stage 7). Note: IMAP credentials for the new domain inbox are needed starting Stage 0 (once the inbox exists) and used again in Stage 5 for reply detection — same inbox, not a separate setup.

Claude Pro ($20/mo) covers the coding work itself via Claude Code, scoped one stage/task per session.

---

## 11. Cost estimate

| Scale | Monthly cost |
|---|---|
| Small (few hundred contacts, occasional sends) | $0–15 (mostly free tiers) |
| Moderate (1,000+ contacts, regular sends) | $25–50 (hosting + email volume) |

Cost scales with **contact list size and send frequency**, not with which stages are built — building all 7 stages costs the same as building 2, aside from the email volume you actually send.

---

## 12. Build order summary

| Stage | Adds |
|---|---|
| 0 | Deploy base system — domain purchase, new inbox on domain, hosting, SMTP, DNS |
| 1 | CSV import + browser extension push import (two-list) + device/bounce tracking + dashboard delivery panel + in-app campaign builder + dual-track sending (established mailbox + custom domain) + automated reputation warm-up via real engaged contacts + throttling + seed testing (diagnostic) |
| 3 | Flagging + "needs attention" dashboard panel |
| 4 | Discord notifications (4 channels) |
| 5 | Reply detection (IMAP) + reply feed |
| 6 | Auto-reply (optional, draft-and-approve recommended) |
| 7 | Discord bot for inbound CSV (optional) |

*Stage 2 (welcome emails) has been removed from scope. Numbering is kept
as-is rather than renumbered, since Stage 3 onward is already referenced
by number throughout this document and in the built codebase (e.g.
dashboard placeholder tags, code comments referencing "Stage 5" for reply
detection).*

---

## 14. Deliverability (avoiding spam folders)

Deliverability is mostly a handful of technical and behavioral signals spam
filters check. These apply from Stage 0 onward, not as a separate stage.

**Technical setup (required before sending anything at volume)**
- SPF, DKIM, DMARC DNS records on the sending domain — without these, Gmail/Outlook
  flag or bin mail almost automatically. Configured via the SMTP provider's
  domain verification flow (Stage 0 setup step).
- Send from a dedicated subdomain (e.g. `mail.yourdomain.com`), not the root
  domain, so a reputation hit doesn't affect primary email.
- Keep the From address consistent — reputation builds per address/domain over time.

**Sending behavior**
- Warm up gradually on a new domain: small volumes first (dozens, not hundreds),
  ramping up over 1–2 weeks rather than a large first blast.
- Rate limiting between sends — already implemented in `send.js`; don't remove.
- Clean the list: remove bounced addresses promptly (Stage 1 bounce tracking
  feeds this) and never send to purchased/scraped lists — high bounce rate is
  one of the strongest spam signals.
- Honor unsubscribes immediately (already built in) — a spam complaint hurts
  reputation far more than a clean unsubscribe.

**Content**
- Avoid spam-trigger patterns: all-caps subjects, excessive exclamation points,
  "FREE"/"ACT NOW"-style language, too many links.
- Include a plain-text alternative alongside HTML — HTML-only emails are
  penalized by some filters.
- Keep a healthy text-to-image ratio; image-only emails get flagged more often.

**Ongoing monitoring**
- Track bounce rate and spam-complaint rate per campaign (dashboard, Stage 1).
  A spike after a specific send usually points to a list-quality or content
  issue worth investigating before the next send.
- Recommended dashboard warning threshold: flag a campaign if bounce rate
  exceeds ~5% or complaint rate exceeds ~0.1%, both standard industry
  thresholds providers use to throttle or block a sender.
- **Seed testing** (Stage 1): every send includes a fixed set of test
  addresses across major providers, checked automatically after send for
  inbox-vs-spam placement — a per-send, per-provider signal independent of
  real recipient engagement (see Stage 1 for implementation detail).

**The reputation framework — how sender trust scales**

Sender reputation is a trust score mailbox providers (Gmail, Outlook, Yahoo)
build about a sending domain over time. It's not one number, but several
signals combined:

| Signal | What it measures |
|---|---|
| Volume consistency | Sudden spikes look like spam even from a good sender |
| Engagement rate | Opens/clicks relative to sends — low engagement drags reputation down |
| Complaint rate | Recipients marking mail as spam instead of unsubscribing |
| Bounce rate | Sending to dead/invalid addresses |
| Authentication | SPF/DKIM/DMARC passing consistently |
| List age/quality | New, unverified lists are inherently riskier than an established one |

**How it scales up — the warm-up curve.** Reputation is earned in stages,
not all at once:

```
Week 1:   ~20–50 emails/day   → providers watch closely, no history yet
Week 2:   ~100–200 emails/day → engagement data starts building trust
Week 3-4: ~500+ emails/day    → provider now has a consistent pattern to trust
Ongoing:  scale further as long as engagement/complaint/bounce stay healthy
```

Each step up in volume is only safe once the previous step has shown good
engagement for several days. Jumping straight to high volume on a new
domain is the single most common cause of landing in spam — providers have
no history to trust yet, so a sudden burst reads as suspicious by default.
This curve is what Stage 1's automated warm-up (see §6) paces sends against.

**How it scales down — just as fast.** Reputation is not permanent. It
degrades quickly if complaint rate exceeds ~0.1%, bounce rate exceeds ~5%,
or sending suddenly stops and spikes again (an inconsistent pattern reads as
a compromised account). A domain with months of good reputation can lose
significant trust within days of one bad campaign — which is why bounce and
complaint rate are tracked *per campaign*, not just in aggregate, so a
problem is caught on the send that caused it rather than buried in an
average later. Note that even an established, well-warmed domain should
re-apply a lighter version of the same ramp-up logic when adding a large new
batch of contacts at once, rather than emailing the whole new batch on day one.

---

## 15. Existing codebase (Stage 0 baseline)

Already built and tested end-to-end (contacts API, tracking pixel, click
redirect, stats aggregation all verified working). Note: campaigns are
currently created and sent via a terminal command (`node send.js`), not the
dashboard — the in-app campaign builder (§6, Stage 1) replaces this with a
dashboard "New Campaign" page.

```
email-tracker/
├── server.js           # Express server (dashboard + API + tracking endpoints)
├── send.js             # CLI script that sends a campaign
├── db.js                # SQLite schema
├── routes/
│   ├── track.js         # /track/open/:tid.gif, /track/click/:tid
│   ├── api.js            # /api/contacts, /api/campaigns, /api/campaigns/:id/stats
│   └── unsubscribe.js
├── public/index.html    # Dashboard
├── templates/welcome.html
└── .env.example
```
