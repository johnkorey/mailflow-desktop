import { Router } from 'express';
import { smtpDb, campaignDb, userDb, subjectListDb, senderListDb, linkListDb, recipientListDb, proxyDb, sendingSettingsDb, unsubscribeDb, findRepeatedlyFailedEmails } from '../database/db.mjs';

const router = Router();

// --- Subject Lists ---
router.get('/subjects', (req, res) => {
    try {
        const lists = subjectListDb.findByUserId(req.user.id);
        res.json({ lists: lists.map(l => ({ ...l, subjects: JSON.parse(l.subjects) })) });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get subject lists' });
    }
});

router.post('/subjects', (req, res) => {
    try {
        const { name, subjects } = req.body;
        if (!name || !subjects || !Array.isArray(subjects)) {
            return res.status(400).json({ error: 'Name and subjects array required' });
        }
        const list = subjectListDb.create({ user_id: req.user.id, name, subjects: JSON.stringify(subjects) });
        res.status(201).json({ list: { ...list, subjects } });
    } catch (error) {
        res.status(500).json({ error: 'Failed to create subject list' });
    }
});

router.put('/subjects/:id', (req, res) => {
    try {
        const { id } = req.params;
        const { name, subjects } = req.body;
        const list = subjectListDb.findById(id);
        if (!list || list.user_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
        subjectListDb.update(id, { name, subjects: JSON.stringify(subjects) });
        res.json({ message: 'Updated' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update' });
    }
});

router.delete('/subjects/:id', (req, res) => {
    try {
        const list = subjectListDb.findById(req.params.id);
        if (!list || list.user_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
        subjectListDb.delete(req.params.id);
        res.json({ message: 'Deleted' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete' });
    }
});

// --- Sender Lists ---
router.get('/senders', (req, res) => {
    try {
        const lists = senderListDb.findByUserId(req.user.id);
        res.json({ lists: lists.map(l => ({ ...l, senders: JSON.parse(l.senders) })) });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get sender lists' });
    }
});

router.post('/senders', (req, res) => {
    try {
        const { name, senders } = req.body;
        if (!name || !senders || !Array.isArray(senders)) {
            return res.status(400).json({ error: 'Name and senders array required' });
        }
        const list = senderListDb.create({ user_id: req.user.id, name, senders: JSON.stringify(senders) });
        res.status(201).json({ list: { ...list, senders } });
    } catch (error) {
        res.status(500).json({ error: 'Failed to create sender list' });
    }
});

router.put('/senders/:id', (req, res) => {
    try {
        const { id } = req.params;
        const { name, senders } = req.body;
        const list = senderListDb.findById(id);
        if (!list || list.user_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
        senderListDb.update(id, { name, senders: JSON.stringify(senders) });
        res.json({ message: 'Updated' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update' });
    }
});

router.delete('/senders/:id', (req, res) => {
    try {
        const list = senderListDb.findById(req.params.id);
        if (!list || list.user_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
        senderListDb.delete(req.params.id);
        res.json({ message: 'Deleted' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete' });
    }
});

// --- Link Lists ---
router.get('/links', (req, res) => {
    try {
        const lists = linkListDb.findByUserId(req.user.id);
        res.json({ lists: lists.map(l => ({ ...l, links: JSON.parse(l.links) })) });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get link lists' });
    }
});

router.post('/links', (req, res) => {
    try {
        const { name, links } = req.body;
        if (!name || !links || !Array.isArray(links)) {
            return res.status(400).json({ error: 'Name and links array required' });
        }
        const list = linkListDb.create({ user_id: req.user.id, name, links: JSON.stringify(links) });
        res.status(201).json({ list: { ...list, links } });
    } catch (error) {
        res.status(500).json({ error: 'Failed to create link list' });
    }
});

router.put('/links/:id', (req, res) => {
    try {
        const { id } = req.params;
        const { name, links } = req.body;
        const list = linkListDb.findById(id);
        if (!list || list.user_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
        linkListDb.update(id, { name, links: JSON.stringify(links) });
        res.json({ message: 'Updated' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update' });
    }
});

router.delete('/links/:id', (req, res) => {
    try {
        const list = linkListDb.findById(req.params.id);
        if (!list || list.user_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
        linkListDb.delete(req.params.id);
        res.json({ message: 'Deleted' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete' });
    }
});

// --- Recipient Lists ---
router.get('/recipients', (req, res) => {
    try {
        const lists = recipientListDb.findByUserId(req.user.id);
        res.json({ lists: lists.map(l => ({ ...l, recipients: JSON.parse(l.recipients) })) });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get recipient lists' });
    }
});

router.post('/recipients', (req, res) => {
    try {
        const { name, description, recipients } = req.body;
        if (!name || !recipients || !Array.isArray(recipients)) {
            return res.status(400).json({ error: 'Name and recipients array required' });
        }
        const list = recipientListDb.create({
            user_id: req.user.id,
            name,
            description,
            recipients
        });
        res.status(201).json({ list: { ...list, recipients } });
    } catch (error) {
        console.error('Create recipient list error:', error);
        res.status(500).json({ error: 'Failed to create recipient list' });
    }
});

router.put('/recipients/:id', (req, res) => {
    try {
        const { id } = req.params;
        const { name, description, recipients } = req.body;
        const list = recipientListDb.findById(id);
        if (!list || list.user_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
        recipientListDb.update(id, { name, description, recipients });
        res.json({ message: 'Updated' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update' });
    }
});

router.delete('/recipients/:id', (req, res) => {
    try {
        const list = recipientListDb.findById(req.params.id);
        if (!list || list.user_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
        recipientListDb.delete(req.params.id);
        res.json({ message: 'Deleted' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete' });
    }
});

/**
 * POST /api/user/settings/recipients/:id/clean
 * Body: { remove_unsubscribes, remove_duplicates, remove_invalid, remove_failed }
 *
 * Filters the saved recipient list and saves the cleaned version. Returns
 * a breakdown of what was removed so the UI can display it.
 */
router.post('/recipients/:id/clean', (req, res) => {
    try {
        const { id } = req.params;
        const opts = req.body || {};
        const list = recipientListDb.findById(id);
        if (!list || list.user_id !== req.user.id) return res.status(404).json({ error: 'Not found' });

        // Recipients are stored as a JSON string. Items can be plain strings (just emails)
        // or objects with at least an `email` field plus optional custom fields.
        let recipients;
        try { recipients = JSON.parse(list.recipients) || []; }
        catch { recipients = []; }

        const getEmail = (r) => (typeof r === 'string' ? r : r?.email || '').toLowerCase().trim();
        const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        const removed = { invalid: 0, duplicates: 0, unsubscribed: 0, failed: 0 };
        let cleaned = recipients;

        // 1. Invalid emails
        if (opts.remove_invalid) {
            const before = cleaned.length;
            cleaned = cleaned.filter(r => EMAIL_RX.test(getEmail(r)));
            removed.invalid = before - cleaned.length;
        }

        // 2. Duplicates (case-insensitive, keep first occurrence)
        if (opts.remove_duplicates) {
            const seen = new Set();
            const before = cleaned.length;
            cleaned = cleaned.filter(r => {
                const e = getEmail(r);
                if (seen.has(e)) return false;
                seen.add(e);
                return true;
            });
            removed.duplicates = before - cleaned.length;
        }

        // 3. Unsubscribed addresses
        if (opts.remove_unsubscribes) {
            const allEmails = cleaned.map(getEmail);
            const unsubSet = unsubscribeDb.findUnsubscribedSet(req.user.id, allEmails);
            const before = cleaned.length;
            cleaned = cleaned.filter(r => !unsubSet.has(getEmail(r)));
            removed.unsubscribed = before - cleaned.length;
        }

        // 4. Addresses that have failed N+ times in email_logs
        if (opts.remove_failed) {
            const minFails = parseInt(opts.failed_threshold) || 2;
            const allEmails = cleaned.map(getEmail);
            if (allEmails.length > 0) {
                const failSet = findRepeatedlyFailedEmails(req.user.id, allEmails, minFails);
                const before = cleaned.length;
                cleaned = cleaned.filter(r => !failSet.has(getEmail(r)));
                removed.failed = before - cleaned.length;
            }
        }

        // Persist
        recipientListDb.update(id, {
            name: list.name,
            description: list.description,
            recipients: JSON.stringify(cleaned)
        });

        res.json({
            message: 'List cleaned',
            removed,
            remaining: cleaned.length,
            original: recipients.length
        });
    } catch (error) {
        console.error('Clean recipient list error:', error);
        res.status(500).json({ error: 'Failed to clean list' });
    }
});

// --- Proxy Configs ---
router.get('/proxies', (req, res) => {
    try {
        const proxies = proxyDb.findByUserId(req.user.id);
        // Hide passwords
        res.json({ proxies: proxies.map(p => ({ ...p, password: p.password ? '••••••' : null })) });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get proxies' });
    }
});

router.post('/proxies', (req, res) => {
    try {
        const { name, proxy_type, host, port, username, password } = req.body;
        if (!name || !proxy_type || !host || !port) {
            return res.status(400).json({ error: 'Name, type, host, and port required' });
        }
        if (!['http', 'https', 'socks4', 'socks5'].includes(proxy_type)) {
            return res.status(400).json({ error: 'Invalid proxy type' });
        }
        const proxy = proxyDb.create({ user_id: req.user.id, name, proxy_type, host, port, username, password });
        res.status(201).json({ proxy: { ...proxy, password: password ? '••••••' : null } });
    } catch (error) {
        res.status(500).json({ error: 'Failed to create proxy' });
    }
});

router.put('/proxies/:id', (req, res) => {
    try {
        const { id } = req.params;
        const proxy = proxyDb.findById(id);
        if (!proxy || proxy.user_id !== req.user.id) return res.status(404).json({ error: 'Not found' });

        const { name, proxy_type, host, port, username, password, is_active } = req.body;
        const updateData = {};
        if (name !== undefined) updateData.name = name;
        if (proxy_type !== undefined) updateData.proxy_type = proxy_type;
        if (host !== undefined) updateData.host = host;
        if (port !== undefined) updateData.port = port;
        if (username !== undefined) updateData.username = username;
        if (password !== undefined) updateData.password = password;
        if (is_active !== undefined) updateData.is_active = is_active ? 1 : 0;

        proxyDb.update(id, updateData);
        res.json({ message: 'Updated' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update' });
    }
});

router.delete('/proxies/:id', (req, res) => {
    try {
        const proxy = proxyDb.findById(req.params.id);
        if (!proxy || proxy.user_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
        proxyDb.delete(req.params.id);
        res.json({ message: 'Deleted' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete' });
    }
});

router.post('/proxies/:id/toggle', (req, res) => {
    try {
        const proxy = proxyDb.findById(req.params.id);
        if (!proxy || proxy.user_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
        proxyDb.toggleActive(req.params.id);
        res.json({ message: 'Toggled', is_active: !proxy.is_active });
    } catch (error) {
        res.status(500).json({ error: 'Failed to toggle' });
    }
});

// --- Sending Settings ---
router.get('/sending', (req, res) => {
    try {
        let settings = sendingSettingsDb.findByUserId(req.user.id);
        if (!settings) {
            settings = { threads: 1, delay_min: 1000, delay_max: 3000, retry_failed: 0, use_proxy: 0 };
        }
        res.json({ settings });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get settings' });
    }
});

router.put('/sending', (req, res) => {
    try {
        const { threads, delay_min, delay_max, retry_failed, use_proxy } = req.body;

        // Coerce + clamp. Use Number() and isNaN checks so that 0 is preserved
        // (don't use `|| fallback` which silently replaces 0 with the default).
        const threadsN = Number(threads);
        const delayMinN = Number(delay_min);
        const delayMaxN = Number(delay_max);

        sendingSettingsDb.upsert(req.user.id, {
            threads: Math.min(Math.max(1, isNaN(threadsN) ? 1 : threadsN), 10), // 1–10
            delay_min: Math.max(0, isNaN(delayMinN) ? 1000 : delayMinN),
            delay_max: Math.max(0, isNaN(delayMaxN) ? (isNaN(delayMinN) ? 1000 : delayMinN) : delayMaxN),
            retry_failed: !!retry_failed,
            use_proxy: !!use_proxy
        });
        res.json({ message: 'Settings saved' });
    } catch (error) {
        console.error('Save sending settings error:', error);
        res.status(500).json({ error: 'Failed to save settings' });
    }
});

// --- Get All Settings (for dropdowns) ---
router.get('/all', (req, res) => {
    try {
        const subjectLists = subjectListDb.findByUserId(req.user.id).map(l => ({ ...l, subjects: JSON.parse(l.subjects) }));
        const senderLists = senderListDb.findByUserId(req.user.id).map(l => ({ ...l, senders: JSON.parse(l.senders) }));
        const linkLists = linkListDb.findByUserId(req.user.id).map(l => ({ ...l, links: JSON.parse(l.links) }));
        const recipientLists = recipientListDb.findByUserId(req.user.id).map(l => ({ ...l, recipients: JSON.parse(l.recipients) }));
        const proxies = proxyDb.findByUserId(req.user.id).map(p => ({ ...p, password: p.password ? '••••••' : null }));
        let sendingSettings = sendingSettingsDb.findByUserId(req.user.id);
        if (!sendingSettings) {
            sendingSettings = { threads: 1, delay_min: 1000, delay_max: 3000, retry_failed: 0, use_proxy: 0 };
        }

        res.json({ subjectLists, senderLists, linkLists, recipientLists, proxies, sendingSettings });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get settings' });
    }
});

// --- Deliverability Test Settings ---
router.get('/test', (req, res) => {
    try {
        const settings = userDb.getTestSettings(req.user.id);
        res.json(settings);
    } catch (error) {
        console.error('Get test settings error:', error);
        res.status(500).json({ error: 'Failed to get test settings' });
    }
});

router.put('/test', (req, res) => {
    try {
        const { test_email, test_interval, test_enabled } = req.body;

        // Validate test email if provided
        if (test_email && !test_email.includes('@')) {
            return res.status(400).json({ error: 'Invalid test email address' });
        }

        // Validate interval (minimum 10 emails)
        const interval = parseInt(test_interval) || 50;
        if (interval < 10) {
            return res.status(400).json({ error: 'Test interval must be at least 10 emails' });
        }

        userDb.updateTestSettings(req.user.id, {
            test_email: test_email || null,
            test_interval: interval,
            test_enabled: test_enabled || false
        });

        res.json({ message: 'Test settings saved' });
    } catch (error) {
        console.error('Save test settings error:', error);
        res.status(500).json({ error: 'Failed to save test settings' });
    }
});

// --- Send Manual Test Email ---
router.post('/test/send', async (req, res) => {
    try {
        const { test_email, campaign_id } = req.body;

        if (!test_email || !test_email.includes('@')) {
            return res.status(400).json({ error: 'Valid test email is required' });
        }

        // Get user's active SMTP
        const smtpConfig = smtpDb.findActiveByUserId(req.user.id);
        if (!smtpConfig) {
            return res.status(400).json({ error: 'No active SMTP configuration found' });
        }

        // Get campaign content if specified
        let subject = '🧪 Test Email - Deliverability Check';
        let htmlBody = `
            <div style="font-family: Arial, sans-serif; padding: 20px;">
                <h2>✅ Test Email Delivered Successfully</h2>
                <p>This is a test email to verify deliverability.</p>
                <p><strong>Sent at:</strong> ${new Date().toLocaleString()}</p>
                <p><strong>SMTP:</strong> ${smtpConfig.name} (${smtpConfig.host})</p>
                <hr>
                <p style="color: #666; font-size: 12px;">
                    If you received this in your inbox (not spam), your emails are being delivered correctly!
                </p>
            </div>
        `;

        if (campaign_id) {
            const campaign = campaignDb.findById(campaign_id);
            if (campaign && campaign.user_id === req.user.id) {
                subject = `🧪 TEST: ${campaign.subject}`;
                htmlBody = campaign.body_html || htmlBody;
            }
        }

        // Create transporter
        const { decrypt } = await import('../services/encryption.mjs');
        const nodemailer = await import('nodemailer');

        const transporter = nodemailer.default.createTransport({
            host: smtpConfig.host,
            port: smtpConfig.port,
            secure: smtpConfig.secure === 1,
            auth: {
                user: smtpConfig.username,
                pass: decrypt(smtpConfig.password_encrypted)
            }
        });

        // Send test email
        await transporter.sendMail({
            from: `"${smtpConfig.from_name || 'Test'}" <${smtpConfig.from_email || smtpConfig.username}>`,
            to: test_email,
            subject: subject,
            html: htmlBody
        });

        res.json({ message: `Test email sent to ${test_email}` });
    } catch (error) {
        console.error('Send test email error:', error);
        res.status(500).json({ error: error.message || 'Failed to send test email' });
    }
});

export default router;
