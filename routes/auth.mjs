import { Router } from 'express';
import { userDb } from '../database/db.mjs';
import { authenticate } from '../middleware/auth.mjs';

const router = Router();

/**
 * GET /api/auth/me
 * Get current user
 */
router.get('/me', authenticate, (req, res) => {
    res.json({ user: req.user });
});

/**
 * PUT /api/auth/profile
 * Update profile
 */
router.put('/profile', authenticate, (req, res) => {
    try {
        const { name, email } = req.body;

        const updates = {};
        if (name !== undefined) updates.name = name;
        if (email !== undefined) updates.email = email;

        userDb.update(req.user.id, updates);

        res.json({
            message: 'Profile updated successfully',
            user: { ...req.user, ...updates }
        });
    } catch (error) {
        console.error('Profile update error:', error);
        res.status(500).json({ error: 'Profile update failed' });
    }
});

export default router;
