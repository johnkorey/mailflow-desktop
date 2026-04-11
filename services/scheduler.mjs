/**
 * Campaign scheduler — runs a single setInterval that checks the campaigns
 * table every 30 seconds for anything with scheduled_at ≤ now and status = draft,
 * and kicks off those campaigns automatically.
 *
 * Call startScheduler() once from server.mjs on app boot.
 */

import { campaignDb } from '../database/db.mjs';
import { EmailSender } from './email-sender.mjs';

const CHECK_INTERVAL_MS = 30_000;
let intervalHandle = null;
// Track which campaign IDs we've already fired off in this session so we
// don't double-start if the scheduler tick overlaps with a long-running start()
const firingCampaigns = new Set();

async function checkScheduledCampaigns() {
    try {
        const due = campaignDb.findScheduledDue();
        if (due.length === 0) return;

        for (const campaign of due) {
            if (firingCampaigns.has(campaign.id)) continue;
            firingCampaigns.add(campaign.id);

            console.log(`[Scheduler] Firing scheduled campaign #${campaign.id} "${campaign.name}" (was due at ${campaign.scheduled_at})`);

            // Clear scheduled_at so it doesn't re-fire next tick
            campaignDb.update(campaign.id, { scheduled_at: null });

            // Kick off the send — fire and forget; EmailSender handles all state
            const sender = new EmailSender(campaign.user_id, campaign.id);
            sender.start()
                .catch(err => {
                    console.error(`[Scheduler] Campaign #${campaign.id} failed:`, err.message);
                })
                .finally(() => {
                    firingCampaigns.delete(campaign.id);
                });
        }
    } catch (e) {
        console.error('[Scheduler] Tick failed:', e.message);
    }
}

export function startScheduler() {
    if (intervalHandle) return; // already running
    console.log(`[Scheduler] Starting campaign scheduler (checking every ${CHECK_INTERVAL_MS / 1000}s)`);
    // Run immediately on boot so any overdue campaigns fire right away
    checkScheduledCampaigns();
    intervalHandle = setInterval(checkScheduledCampaigns, CHECK_INTERVAL_MS);
}

export function stopScheduler() {
    if (intervalHandle) {
        clearInterval(intervalHandle);
        intervalHandle = null;
    }
}
