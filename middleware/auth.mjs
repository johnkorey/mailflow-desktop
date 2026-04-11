import { userDb } from '../database/db.mjs';

/**
 * Authentication middleware for single-user desktop app.
 * No JWT needed - always injects the local user (id=1).
 */
export function authenticate(req, res, next) {
    const user = userDb.getLocalUser();

    if (!user) {
        return res.status(500).json({ error: 'Local user not found. Database may not be initialized.' });
    }

    req.user = {
        id: user.id,
        email: user.email,
        name: user.name
    };

    next();
}
