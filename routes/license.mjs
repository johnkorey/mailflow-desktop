import { Router } from 'express';
import { checkLicense, activateLicense, deactivateLicense } from '../services/license.mjs';

const router = Router();

/**
 * GET /api/license/status
 * Check current license status (no auth required)
 */
router.get('/status', (req, res) => {
    try {
        const status = checkLicense();
        res.json(status);
    } catch (error) {
        console.error('License check error:', error);
        res.status(500).json({ error: 'Failed to check license status' });
    }
});

/**
 * POST /api/license/activate
 * Activate a license key
 */
router.post('/activate', async (req, res) => {
    try {
        const { key } = req.body;

        if (!key) {
            return res.status(400).json({ error: 'License key is required' });
        }

        const result = await activateLicense(key);

        if (!result.success) {
            return res.status(400).json({ error: result.error });
        }

        res.json({
            success: true,
            message: 'License activated successfully',
            expiresAt: result.expiresAt,
            tier: result.tier
        });
    } catch (error) {
        console.error('License activation error:', error);
        res.status(500).json({ error: 'Failed to activate license' });
    }
});

/**
 * POST /api/license/deactivate
 * Deactivate the current license
 */
router.post('/deactivate', (req, res) => {
    try {
        deactivateLicense();
        res.json({ success: true, message: 'License deactivated' });
    } catch (error) {
        console.error('License deactivation error:', error);
        res.status(500).json({ error: 'Failed to deactivate license' });
    }
});

export default router;
