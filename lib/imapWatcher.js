// IMAP polling watcher — connects to the same inbox campaigns send from
// (per product-spec.md: "IMAP credentials for the new domain inbox are
// needed starting Stage 0 ... used again in Stage 5 ... same inbox, not a
// separate setup"), pulls unseen messages, and hands each one to
// replyProcessor for matching/logging.
//
// NOTE: the actual network connection to a real IMAP server has not been
// tested in this build environment (no real mailbox credentials available
// here) — only the matching/logging logic in replyProcessor.js has been
// verified directly. Confirm this against your real inbox once deployed.
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const { processIncomingMessage } = require('./replyProcessor');

function isConfigured() {
  return !!(process.env.IMAP_HOST && process.env.IMAP_USER && process.env.IMAP_PASS);
}

async function checkForReplies() {
  if (!isConfigured()) {
    return { checked: false, reason: 'not_configured' };
  }

  const client = new ImapFlow({
    host: process.env.IMAP_HOST,
    port: Number(process.env.IMAP_PORT || 993),
    secure: true,
    auth: { user: process.env.IMAP_USER, pass: process.env.IMAP_PASS },
    logger: false,
  });

  let matchedCount = 0;
  let unmatchedCount = 0;

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    let uids = [];
    try {
      uids = await client.search({ seen: false });
      for (const uid of uids) {
        const msg = await client.fetchOne(uid, { source: true });
        const parsed = await simpleParser(msg.source);

        const result = processIncomingMessage({
          from: parsed.from && parsed.from.value && parsed.from.value[0] && parsed.from.value[0].address,
          subject: parsed.subject,
          text: parsed.text,
          html: parsed.html,
          messageId: parsed.messageId,
          inReplyTo: parsed.inReplyTo,
          references: parsed.references,
        });

        if (result.matched) matchedCount++;
        else unmatchedCount++;

        await client.messageFlagsAdd(uid, ['\\Seen']);
      }
    } finally {
      lock.release();
    }
    await client.logout();
    return { checked: true, totalUnseen: uids.length, matchedCount, unmatchedCount };
  } catch (err) {
    console.warn(`[imap] check failed: ${err.message}`);
    try {
      await client.logout();
    } catch {
      /* already disconnected */
    }
    return { checked: false, reason: 'error', error: err.message };
  }
}

function startPolling() {
  if (!isConfigured()) return null;
  const intervalMs = Number(process.env.IMAP_POLL_INTERVAL_MS || 60000);
  return setInterval(() => {
    checkForReplies().catch((err) => console.warn(`[imap] poll error: ${err.message}`));
  }, intervalMs);
}

module.exports = { checkForReplies, isConfigured, startPolling };
