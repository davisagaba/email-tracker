# Build Roadmap — Claude Code Execution Plan

This is the playbook for handing this project to Claude Code, running
locally in VS Code, to build from zero to a fully working, deployed system.

**Use alongside `product-spec.md`** — that file is the full technical
spec (data model, feature detail, deliverability framework). This
document is the *execution order* and the *exact prompts* to use at each
step. Give Claude Code both files.

---

## 0. Before you start

**Have ready:**
- VS Code installed, Claude Code extension installed, signed in with your
  Claude Pro account (not an API key — that bills separately)
- Node.js 18+, Git installed
- A GitHub account
- A Railway account
- `product-spec.md` and this file, both saved into a fresh empty project
  folder (don't reuse any previous broken build)

**Not needed yet** (these come later, per-client, not for you to set up
now): a real domain, SendGrid account, IMAP credentials. The initial
build and first test deploy use placeholder values.

---

## 1. Kickoff prompt — read the spec, don't start coding yet

Paste this first, as its own message:

> I'm attached two files: product-spec.md (full technical spec) and
> BUILD-ROADMAP.md (execution plan). Read both fully before writing any
> code. Once you've read them, summarize back to me in a few sentences
> what you understand the system to be, and confirm you're ready to start
> with Phase 1 below. Don't start building yet.

This forces a comprehension check before any code gets written — cheap
insurance against it building the wrong thing from a partial read.

---

## Phase 1 — Core build (spec §6, Stage 0 + Stage 1)

**Prompt:**

> Build Phase 1 now: a Node.js + Express + SQLite app implementing
> everything in product-spec.md's Stage 0 baseline and Stage 1. Specifically:
> - Two fully separate contact tables (dedup_contacts, supplier_contacts)
>   per the data model in §5, including the phone/source_row_id/metadata
>   fields and field-mapping rules described there
> - CSV import (manual paste) for both lists
> - Two extension-sync endpoints (POST /extension-sync/dedup and
>   /extension-sync/supplier), token-authenticated, per §6
> - In-app campaign builder (dashboard page to write + send a campaign,
>   no terminal command needed)
> - Dual-track sending (domain track + mailbox track), per §6
> - Automated reputation warm-up curve, throttling, and the one-time
>   onboarding question ("has this domain sent before?"), per §6 and §14
> - Seed testing scaffolding (seed addresses get sent to, placement logged
>   as unknown pending Stage 5's IMAP mechanism)
> - Device breakdown parsing on opens
> - Bounce + complaint webhook endpoint for SendGrid
> - The dashboard (public/index.html): Dashboard, Contacts, Supplier List,
>   New Campaign, Campaigns, Needs Attention, Extension Sync, Reputation
>   pages — all wired to real data, no fake/sample data anywhere
>
> After building, run it locally end to end: install deps, start the
> server, and actually test every API endpoint with curl or similar
> (add a contact, import CSV to both lists, generate a sync token, push
> data through both extension-sync URLs, create+view a campaign draft,
> hit the tracking pixel, check reputation status, trigger throttling
> with synthetic bad data). Show me the results. Don't tell me it works
> without having actually run it.

**After it finishes:** open the dashboard yourself locally
(`localhost:3000/index.html`), click through every page, and confirm
it matches what's described before moving on. Don't skip this — reading
"it works" and seeing it work are different things.

---

## Phase 2 — Deployment (Stage 0, going live)

**Prompt:**

> Now let's deploy this to Railway. Use the Railway CLI:
> 1. Check railway.json is correct for this project
> 2. Run `railway login` — I'll complete the browser authorization when
>    prompted
> 3. Create and link a new Railway project, deploy with placeholder env
>    vars (PUBLIC_URL=https://placeholder.example.com, SMTP_HOST=smtp.sendgrid.net,
>    SMTP_USER=apikey, SMTP_PASS=placeholder, FROM_ADDRESS=test@example.com)
> 4. Once deployed, get the real Railway URL, update PUBLIC_URL to match
>    it, redeploy
> 5. Read the deploy logs. If it crashes, diagnose the actual error
>    (check for MODULE_NOT_FOUND specifically — confirm package.json
>    matches every require() in the codebase) and fix it, then redeploy.
>    Repeat until the dashboard loads successfully at the real URL.
> 6. Confirm by fetching the dashboard URL and showing me it returns 200.

This is the step that needs you once, for the `railway login` browser
click — everything else should run without interruption.

---

## Phase 3 — Railway Template (so clients can self-deploy)

**Prompt:**

> Now set this up as a reusable Railway Template so future clients can
> deploy their own instance with one click, filling in their own
> credentials. Reference product-spec.md's "per-client deployment model"
> section. Define the template's required variables to match
> .env.example exactly, with clear descriptions for each (these are
> shown to a non-technical person filling in a form, so write them
> plainly). Generate the template link and update the Deploy button in
> README.md.

---

## Phase 4 — Extension sync integration test

Once you've separately updated the browser extension (using the prompts
from earlier in this conversation) to push to the two sync URLs:

**Prompt:**

> I've updated the browser extension to sync to /extension-sync/dedup
> and /extension-sync/supplier. Help me test this end to end: generate a
> real sync token from the dashboard, walk me through configuring the
> extension with the deployed URL + token, then confirm contacts pushed
> from the extension actually appear correctly in the right
> dashboard list.

---

## Phase 5 — Stage 3 (Flagging rules)

**Prompt:**

> Build Stage 3 from product-spec.md: automatic flagging rules. The
> flags system (create/list/resolve) already exists — add the actual
> triggers: a bounce automatically creates a flag, 5+ opens with no
> click automatically creates a flag, an unsubscribe within 24h of a
> send automatically creates a flag. Test each trigger with synthetic
> data to confirm flags actually get created, not just that the code
> compiles.

---

## Phase 6 — Stage 4 (Discord alerts)

**Not something you configure yourself** — same pattern as domain/SendGrid:
each client provides their own four Discord webhook URLs during their own
onboarding, not you providing one shared set. Your job in this phase is
building the *capability*, not filling in real webhook URLs.

**Prompt:**

> Build Stage 4 from product-spec.md: Discord notifications across the
> four channels (#new-contacts, #replies, #flagged, #campaign-sends).
> Per the per-client deployment model already established for
> domain/SendGrid/Sheets credentials, these four webhook URLs must be
> client-provided env vars (e.g. DISCORD_WEBHOOK_NEW_CONTACTS,
> DISCORD_WEBHOOK_REPLIES, DISCORD_WEBHOOK_FLAGGED,
> DISCORD_WEBHOOK_CAMPAIGN_SENDS), documented in .env.example and
> SETUP.md the same way SMTP_* is — with plain-language instructions for
> a non-technical client on how to generate their own webhook URLs
> (Discord Server Settings → Integrations → Webhooks, one per channel).
> Wire up each trigger event to post to the right channel when configured,
> and make each channel gracefully do nothing (not crash) if its webhook
> var is left blank — a client might only want some of the four.
> Test with placeholder webhook URLs to confirm the trigger logic fires
> correctly, without needing a real Discord server for this test.

For your **own** testing during this phase, you can create a throwaway
Discord server and generate real webhooks just to verify it works — but
that's for verification only, not the webhook set clients will use.

---

## Phase 7 — Stage 5 (Reply detection + in-app inbox)

**Needs from you first:** IMAP credentials for the inbox campaigns send
from (an app password, not your normal login — see product-spec.md
Stage 0 for how this inbox was set up).

**Prompt:**

> Build Stage 5 from product-spec.md: IMAP-based reply detection and the
> in-app inbox. This is the most failure-prone stage per the spec's own
> notes — go slowly, test the IMAP connection in isolation first before
> building the full thread-matching and reply-sending logic on top of it.

---

## Phase 8 — Stages 6/7 (optional)

Only pursue after seeing real reply volume from Stage 5, per the spec's
own recommendation. Auto-reply (Stage 6) and the Discord CSV bot
(Stage 7) prompts can be written the same way as above once you decide
these are worth building.

---

## General rules to give Claude Code up front

Include this in your very first message, or as a standing instruction:

> Throughout this whole project: build one phase at a time, actually run
> and test each phase before moving to the next, and tell me clearly if
> something can't be verified in this environment (e.g. no real SMTP
> network access) rather than claiming it works when it wasn't actually
> tested. If you hit a genuine ambiguity in the spec, ask me rather than
> guessing.

---

## Reference: files to have in the project folder

```
product-spec.md       # the full technical spec
BUILD-ROADMAP.md       # this file
```

Everything else (server.js, db.js, routes/, public/, lib/, etc.) gets
created by Claude Code during Phase 1.
