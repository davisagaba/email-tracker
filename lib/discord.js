// Posts a message to a client-configured Discord webhook. Each of the four
// channels (#new-contacts, #replies, #flagged, #campaign-sends) is entirely
// optional and independent — a client may configure none, some, or all of
// them. If the env var for a given channel is blank/unset, this silently
// does nothing (not an error) so a client who only wants one channel isn't
// forced to configure the rest. A failed webhook POST (bad URL, Discord
// down, no network in dev) is logged and swallowed — it must never crash
// the request that triggered it.

const WEBHOOK_ENV_VARS = {
  newContacts: 'DISCORD_WEBHOOK_NEW_CONTACTS',
  replies: 'DISCORD_WEBHOOK_REPLIES',
  flagged: 'DISCORD_WEBHOOK_FLAGGED',
  campaignSends: 'DISCORD_WEBHOOK_CAMPAIGN_SENDS',
};

async function postToChannel(channel, content) {
  const envVar = WEBHOOK_ENV_VARS[channel];
  const url = process.env[envVar];
  if (!url) return { sent: false, reason: 'not_configured' };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    if (!res.ok) {
      console.warn(`[discord] ${channel} webhook returned ${res.status}`);
      return { sent: false, reason: `http_${res.status}` };
    }
    return { sent: true };
  } catch (err) {
    console.warn(`[discord] ${channel} webhook failed: ${err.message}`);
    return { sent: false, reason: 'request_failed' };
  }
}

function notifyNewContacts({ source, targetList, addedCount, updatedCount, skippedCount }) {
  if (addedCount <= 0) return Promise.resolve({ sent: false, reason: 'nothing_added' });
  const listLabel = targetList === 'dedup' ? 'sendable list' : 'supplier list';
  return postToChannel(
    'newContacts',
    `📥 **${addedCount}** new contact(s) added to the ${listLabel} via ${source} import` +
      (updatedCount ? ` (${updatedCount} updated` + (skippedCount ? `, ${skippedCount} skipped)` : ')') : skippedCount ? ` (${skippedCount} skipped)` : '')
  );
}

function notifyFlagged({ email, reason }) {
  return postToChannel('flagged', `🚩 **${email}** flagged: ${reason}`);
}

function notifyCampaignSent({ name, track, recipientCount, actuallySentCount, cappedCount, simulated }) {
  const lines = [
    `📣 Campaign **"${name}"** finished sending (Track ${track})`,
    `Sent: ${actuallySentCount}/${recipientCount}` + (cappedCount ? ` (${cappedCount} deferred by warm-up cap)` : ''),
  ];
  if (simulated) lines.push('_Simulated send — no SMTP credentials configured._');
  return postToChannel('campaignSends', lines.join('\n'));
}

// No caller yet — reply detection is Stage 5, not built. Wired up now so
// Stage 5 only needs to call this, not touch the Discord layer again.
function notifyReply({ email, snippet }) {
  return postToChannel('replies', `💬 Reply from **${email}**` + (snippet ? `: ${snippet}` : ''));
}

module.exports = { notifyNewContacts, notifyFlagged, notifyCampaignSent, notifyReply, postToChannel };
