import { Router } from 'express';
import { smtpDb, campaignDb, emailLogDb, unsubscribeDb } from '../database/db.mjs';
import { authenticate } from '../middleware/auth.mjs';
import { buildBackup, restoreBackup } from '../services/backup.mjs';

import smtpRouter from './smtp.mjs';
import campaignRouter from './campaigns.mjs';
import settingsRouter from './settings.mjs';
import attachmentRouter from './attachments.mjs';
import templateRouter from './templates.mjs';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Mount sub-routers
router.use('/smtp', smtpRouter);
router.use('/campaigns', campaignRouter);
router.use('/settings', settingsRouter);
router.use('/attachments', attachmentRouter);
router.use('/templates', templateRouter);

// ============ Dashboard & Stats Routes ============

/**
 * GET /api/user/dashboard
 * Get dashboard stats
 */
router.get('/dashboard', (req, res) => {
    try {
        const campaignStats = campaignDb.getStats(req.user.id);
        const emailStats = emailLogDb.getStatsByUserId(req.user.id);
        const recentCampaigns = campaignDb.findByUserId(req.user.id, 5, 0);
        const smtpConfigs = smtpDb.findByUserId(req.user.id);

        res.json({
            stats: {
                campaigns: campaignStats
            },
            email_history: emailStats,
            recent_campaigns: recentCampaigns,
            smtp_count: smtpConfigs.length
        });
    } catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).json({ error: 'Failed to get dashboard data' });
    }
});

/**
 * GET /api/user/logs
 * Get email logs
 */
router.get('/logs', (req, res) => {
    try {
        const { limit = 100, offset = 0 } = req.query;
        const logs = emailLogDb.findByUserId(req.user.id, parseInt(limit), parseInt(offset));

        res.json({ logs });
    } catch (error) {
        console.error('Get logs error:', error);
        res.status(500).json({ error: 'Failed to get logs' });
    }
});

// ============ Unsubscribes management ============

/**
 * GET /api/user/unsubscribes
 * List all unsubscribed addresses for this user.
 */
router.get('/unsubscribes', (req, res) => {
    try {
        const list = unsubscribeDb.findByUserId(req.user.id);
        res.json({ unsubscribes: list, count: list.length });
    } catch (error) {
        console.error('Get unsubscribes error:', error);
        res.status(500).json({ error: 'Failed to load unsubscribes' });
    }
});

/**
 * POST /api/user/unsubscribes
 * Manually add an email to the unsubscribe list.
 */
router.post('/unsubscribes', (req, res) => {
    try {
        const { email } = req.body;
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ error: 'Valid email required' });
        }
        unsubscribeDb.add(req.user.id, email, null, 'manual', null);
        res.status(201).json({ message: 'Added to unsubscribe list' });
    } catch (error) {
        console.error('Add unsubscribe error:', error);
        res.status(500).json({ error: 'Failed to add unsubscribe' });
    }
});

/**
 * DELETE /api/user/unsubscribes/:email
 * Remove an email from the unsubscribe list (re-allow sending).
 */
router.delete('/unsubscribes/:email', (req, res) => {
    try {
        const email = decodeURIComponent(req.params.email);
        unsubscribeDb.remove(req.user.id, email);
        res.json({ message: 'Removed from unsubscribe list' });
    } catch (error) {
        console.error('Remove unsubscribe error:', error);
        res.status(500).json({ error: 'Failed to remove unsubscribe' });
    }
});

// ============ Backup / Restore ============

/**
 * GET /api/user/backup/export
 * Returns a JSON envelope of all user-owned data. Sets Content-Disposition
 * so the browser triggers a file download.
 */
router.get('/backup/export', (req, res) => {
    try {
        const envelope = buildBackup(req.user.id);
        const filename = `mailflow-backup-${new Date().toISOString().slice(0, 10)}.json`;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(JSON.stringify(envelope, null, 2));
    } catch (error) {
        console.error('Backup export error:', error);
        res.status(500).json({ error: 'Failed to build backup' });
    }
});

/**
 * POST /api/user/backup/import
 * Body: { envelope: <parsed JSON>, replace_existing?: boolean }
 */
router.post('/backup/import', (req, res) => {
    try {
        const { envelope, replace_existing } = req.body;
        if (!envelope || typeof envelope !== 'object') {
            return res.status(400).json({ error: 'Missing backup envelope' });
        }
        const result = restoreBackup(req.user.id, envelope, { skipExisting: !replace_existing });
        res.json({
            message: 'Backup restored',
            ...result
        });
    } catch (error) {
        console.error('Backup import error:', error);
        res.status(400).json({ error: error.message || 'Failed to restore backup' });
    }
});

export default router;
