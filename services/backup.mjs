/**
 * Backup / Restore service.
 *
 * Export: dumps every per-user table into a single JSON envelope so the user
 * can move installs or recover from data loss.
 *
 * Import: reads the envelope, validates the version, and either skips
 * existing IDs or replaces them based on user preference.
 *
 * SMTP credentials stay encrypted in the export — they only decrypt with
 * the same ENCRYPTION_KEY, so a backup is only restorable to a machine
 * that has the same key. (Use the .env override or copy the auto-generated
 * key file.)
 */

import {
    smtpDb, campaignDb, recipientDb, attachmentDb, emailTemplateDb,
    subjectListDb, senderListDb, linkListDb, recipientListDb, proxyDb,
    sendingSettingsDb, unsubscribeDb
} from '../database/db.mjs';

export const BACKUP_VERSION = 1;

/**
 * Build a complete export of all user-owned data.
 */
export function buildBackup(userId) {
    const campaigns = campaignDb.findByUserId(userId, 100000, 0);
    // Pull recipients per campaign so we can restore them
    const campaignsWithRecipients = campaigns.map(c => ({
        ...c,
        recipients: recipientDb.findByCampaignId(c.id)
    }));

    return {
        version: BACKUP_VERSION,
        exported_at: new Date().toISOString(),
        user_id: userId,
        data: {
            smtp_configs: smtpDb.findByUserId(userId),
            campaigns: campaignsWithRecipients,
            attachments: attachmentDb.findByUserId(userId),
            email_templates: emailTemplateDb.findByUserId(userId),
            subject_lists: subjectListDb.findByUserId(userId),
            sender_lists: senderListDb.findByUserId(userId),
            link_lists: linkListDb.findByUserId(userId),
            recipient_lists: recipientListDb.findByUserId(userId),
            proxy_configs: proxyDb.findByUserId(userId),
            sending_settings: sendingSettingsDb.findByUserId(userId) || null,
            unsubscribes: unsubscribeDb.findByUserId(userId)
        }
    };
}

/**
 * Restore from a backup envelope.
 *
 * @param {number} userId
 * @param {object} envelope - Parsed JSON from buildBackup()
 * @param {object} opts
 *   - skipExisting: when true, skip records whose name already exists (default true)
 * @returns {object} { imported: { table: count }, errors: [] }
 */
export function restoreBackup(userId, envelope, opts = {}) {
    if (!envelope || envelope.version !== BACKUP_VERSION) {
        throw new Error(`Unsupported backup version: ${envelope?.version}`);
    }
    if (!envelope.data) {
        throw new Error('Backup envelope missing data');
    }

    const skipExisting = opts.skipExisting !== false; // default true
    const data = envelope.data;
    const imported = {
        smtp_configs: 0,
        campaigns: 0,
        recipients: 0,
        attachments: 0,
        email_templates: 0,
        subject_lists: 0,
        sender_lists: 0,
        link_lists: 0,
        recipient_lists: 0,
        proxy_configs: 0,
        unsubscribes: 0
    };
    const errors = [];

    // SMTP configs
    if (Array.isArray(data.smtp_configs)) {
        const existing = new Set(smtpDb.findByUserId(userId).map(s => s.name));
        for (const c of data.smtp_configs) {
            if (skipExisting && existing.has(c.name)) continue;
            try {
                smtpDb.create({ ...c, user_id: userId });
                imported.smtp_configs++;
            } catch (e) { errors.push(`smtp ${c.name}: ${e.message}`); }
        }
    }

    // Recipient lists
    if (Array.isArray(data.recipient_lists)) {
        const existing = new Set(recipientListDb.findByUserId(userId).map(l => l.name));
        for (const l of data.recipient_lists) {
            if (skipExisting && existing.has(l.name)) continue;
            try {
                recipientListDb.create({
                    user_id: userId,
                    name: l.name,
                    description: l.description,
                    recipients: typeof l.recipients === 'string' ? l.recipients : JSON.stringify(l.recipients || []),
                    count: l.count || (Array.isArray(l.recipients) ? l.recipients.length : 0)
                });
                imported.recipient_lists++;
            } catch (e) { errors.push(`recipient list ${l.name}: ${e.message}`); }
        }
    }

    // Subject / sender / link lists
    if (Array.isArray(data.subject_lists)) {
        const existing = new Set(subjectListDb.findByUserId(userId).map(l => l.name));
        for (const l of data.subject_lists) {
            if (skipExisting && existing.has(l.name)) continue;
            try {
                subjectListDb.create({
                    user_id: userId,
                    name: l.name,
                    subjects: typeof l.subjects === 'string' ? l.subjects : JSON.stringify(l.subjects || [])
                });
                imported.subject_lists++;
            } catch (e) { errors.push(`subject list ${l.name}: ${e.message}`); }
        }
    }
    if (Array.isArray(data.sender_lists)) {
        const existing = new Set(senderListDb.findByUserId(userId).map(l => l.name));
        for (const l of data.sender_lists) {
            if (skipExisting && existing.has(l.name)) continue;
            try {
                senderListDb.create({
                    user_id: userId,
                    name: l.name,
                    senders: typeof l.senders === 'string' ? l.senders : JSON.stringify(l.senders || [])
                });
                imported.sender_lists++;
            } catch (e) { errors.push(`sender list ${l.name}: ${e.message}`); }
        }
    }
    if (Array.isArray(data.link_lists)) {
        const existing = new Set(linkListDb.findByUserId(userId).map(l => l.name));
        for (const l of data.link_lists) {
            if (skipExisting && existing.has(l.name)) continue;
            try {
                linkListDb.create({
                    user_id: userId,
                    name: l.name,
                    links: typeof l.links === 'string' ? l.links : JSON.stringify(l.links || [])
                });
                imported.link_lists++;
            } catch (e) { errors.push(`link list ${l.name}: ${e.message}`); }
        }
    }

    // Templates
    if (Array.isArray(data.email_templates)) {
        const existing = new Set(emailTemplateDb.findByUserId(userId).map(t => t.name));
        for (const t of data.email_templates) {
            if (skipExisting && existing.has(t.name)) continue;
            try {
                emailTemplateDb.create({
                    user_id: userId,
                    name: t.name,
                    description: t.description,
                    html_content: t.html_content,
                    tags: t.tags
                });
                imported.email_templates++;
            } catch (e) { errors.push(`template ${t.name}: ${e.message}`); }
        }
    }

    // Attachments
    if (Array.isArray(data.attachments)) {
        const existing = new Set(attachmentDb.findByUserId(userId).map(a => a.name));
        for (const a of data.attachments) {
            if (skipExisting && existing.has(a.name)) continue;
            try {
                attachmentDb.create({
                    user_id: userId,
                    name: a.name,
                    description: a.description,
                    html_content: a.html_content,
                    file_name: a.file_name,
                    file_content: a.file_content,
                    file_type: a.file_type,
                    file_size: a.file_size,
                    tags: a.tags
                });
                imported.attachments++;
            } catch (e) { errors.push(`attachment ${a.name}: ${e.message}`); }
        }
    }

    // Proxies
    if (Array.isArray(data.proxy_configs)) {
        const existing = new Set(proxyDb.findByUserId(userId).map(p => p.name));
        for (const p of data.proxy_configs) {
            if (skipExisting && existing.has(p.name)) continue;
            try {
                proxyDb.create({ ...p, user_id: userId });
                imported.proxy_configs++;
            } catch (e) { errors.push(`proxy ${p.name}: ${e.message}`); }
        }
    }

    // Sending settings — single row, just upsert
    if (data.sending_settings) {
        try {
            sendingSettingsDb.upsert(userId, data.sending_settings);
        } catch (e) { errors.push(`sending settings: ${e.message}`); }
    }

    // Unsubscribes
    if (Array.isArray(data.unsubscribes)) {
        for (const u of data.unsubscribes) {
            try {
                if (unsubscribeDb.add(userId, u.email, u.campaign_id, u.source || 'import', u.ip)) {
                    imported.unsubscribes++;
                }
            } catch (e) { errors.push(`unsubscribe ${u.email}: ${e.message}`); }
        }
    }

    // Campaigns + their recipients (do last since they may reference SMTPs/attachments)
    if (Array.isArray(data.campaigns)) {
        const existing = new Set(campaignDb.findByUserId(userId, 100000, 0).map(c => c.name));
        for (const c of data.campaigns) {
            if (skipExisting && existing.has(c.name)) continue;
            try {
                const created = campaignDb.create({
                    ...c,
                    user_id: userId,
                    // Don't carry over reference IDs that may not exist on this machine
                    smtp_config_id: null,
                    attachment_id: null
                });
                imported.campaigns++;

                // Restore recipients for this campaign
                if (Array.isArray(c.recipients) && c.recipients.length > 0) {
                    recipientDb.bulkCreate(created.id, c.recipients.map(r => ({
                        email: r.email,
                        name: r.name
                    })));
                    imported.recipients += c.recipients.length;
                }
            } catch (e) {
                errors.push(`campaign ${c.name}: ${e.message}`);
            }
        }
    }

    return { imported, errors };
}
