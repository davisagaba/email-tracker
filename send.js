require('dotenv').config();
const { getDb } = require('./db');
const { buildTransport, personalize, injectTracking } = require('./lib/mailer');
const { generateTrackingId } = require('./lib/tracking');
const { checkThrottle, incrementDailySendLog, getDailyCap, getTodaySentCount } = require('./lib/reputation');
const { getSeedAddresses, logSeedResults } = require('./lib/seedTest');
const { notifyCampaignSent } = require('./lib/discord');
const { buildMessageId } = require('./lib/messageId');

const SEND_DELAY_MS = Number(process.env.SEND_DELAY_MS || 200);
const PUBLIC_URL = process.env.PUBLIC_URL || 'http://localhost:3000';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sends a campaign to all subscribed dedup_contacts, honoring the
 * bounce/complaint throttle and (for Track B) the warm-up daily cap.
 * If the selected track's SMTP credentials aren't configured, sends run
 * in "simulated" mode — tracking rows are still created, but no real
 * network call is made. This is the only way to test the pipeline in an
 * environment without real SMTP access; the caller is told which mode ran.
 */
async function sendCampaign(campaignId) {
  const db = getDb();
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId);
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

  const throttle = checkThrottle();
  if (throttle.throttled) {
    return { sent: false, throttled: true, reason: throttle.reason };
  }

  const track = campaign.track === 'A' ? 'A' : 'B';
  const { transport, from, configured } = buildTransport(track);

  const recipients = db
    .prepare('SELECT * FROM dedup_contacts WHERE subscribed = 1')
    .all();

  let toSend = recipients;
  let cappedCount = 0;
  if (track === 'B') {
    const cap = getDailyCap('B');
    if (cap !== Infinity) {
      const alreadySent = getTodaySentCount('B');
      const remaining = Math.max(0, cap - alreadySent);
      if (recipients.length > remaining) {
        cappedCount = recipients.length - remaining;
        toSend = recipients.slice(0, remaining);
      }
    }
  }

  const attachments = campaign.attachment_data
    ? [{
        filename: campaign.attachment_filename,
        content: Buffer.from(campaign.attachment_data),
        contentType: campaign.attachment_content_type || undefined,
      }]
    : undefined;

  let sentCount = 0;
  for (const contact of toSend) {
    const trackingId = generateTrackingId();
    db.prepare(
      'INSERT INTO sends (tracking_id, campaign_id, contact_id) VALUES (?, ?, ?)'
    ).run(trackingId, campaign.id, contact.id);

    if (configured) {
      const personalizedBody = personalize(campaign.body || '', contact);
      const trackedBody = injectTracking(personalizedBody, PUBLIC_URL, trackingId);
      await transport.sendMail({
        from,
        to: contact.email,
        subject: personalize(campaign.subject, contact),
        html: trackedBody,
        messageId: buildMessageId(trackingId),
        attachments,
      });
      await sleep(SEND_DELAY_MS);
    }

    incrementDailySendLog(track, 1);
    sentCount++;
  }

  const seedAddresses = logSeedResults(campaign.id);
  if (configured) {
    for (const seedAddress of seedAddresses) {
      await transport.sendMail({
        from,
        to: seedAddress,
        subject: campaign.subject,
        html: injectTracking(campaign.body || '', PUBLIC_URL, generateTrackingId()),
        attachments,
      });
      await sleep(SEND_DELAY_MS);
    }
  }

  db.prepare(
    `UPDATE campaigns SET status = 'sent', sent_at = datetime('now') WHERE id = ?`
  ).run(campaign.id);

  notifyCampaignSent({
    name: campaign.name,
    track,
    recipientCount: recipients.length,
    actuallySentCount: sentCount,
    cappedCount,
    simulated: !configured,
  });

  return {
    sent: true,
    simulated: !configured,
    track,
    recipientCount: recipients.length,
    actuallySentCount: sentCount,
    cappedCount,
    seedAddressCount: seedAddresses.length,
  };
}

if (require.main === module) {
  const idArgIndex = process.argv.indexOf('--campaign');
  const campaignId = idArgIndex !== -1 ? process.argv[idArgIndex + 1] : null;
  if (!campaignId) {
    console.error('Usage: node send.js --campaign <id>');
    process.exit(1);
  }
  sendCampaign(campaignId)
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((err) => {
      console.error('Send failed:', err);
      process.exit(1);
    });
}

module.exports = { sendCampaign };
