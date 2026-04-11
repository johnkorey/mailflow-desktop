/**
 * Public unsubscribe routes — /u/:token
 *
 * No authentication: this is what a recipient hits from their inbox after
 * clicking the unsubscribe link. The token is a stateless HMAC-signed
 * payload that encodes (userId, campaignId, email).
 *
 * GET  /u/:token  → human-readable confirmation page
 * POST /u/:token  → RFC 8058 one-click endpoint (Gmail/Outlook native button)
 */

import { Router } from 'express';
import crypto from 'crypto';
import { unsubscribeDb } from '../database/db.mjs';

const router = Router();

/**
 * Decode and verify a token. Returns { userId, campaignId, email } or null.
 */
function verifyToken(token) {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [encoded, sig] = parts;

    const secret = process.env.ENCRYPTION_KEY || 'unsubscribe-fallback-key';
    const expectedSig = crypto.createHmac('sha256', secret).update(encoded).digest('base64url').substring(0, 16);
    if (sig !== expectedSig) return null;

    let payload;
    try {
        payload = Buffer.from(encoded, 'base64url').toString('utf8');
    } catch {
        return null;
    }
    const [userIdStr, campaignIdStr, email] = payload.split(':');
    const userId = parseInt(userIdStr, 10);
    const campaignId = parseInt(campaignIdStr, 10);
    if (!userId || !email) return null;
    return { userId, campaignId: campaignId || null, email };
}

/**
 * Render a styled HTML confirmation page.
 */
function renderConfirmationPage(email, status) {
    const isSuccess = status === 'success';
    const title = isSuccess ? 'You have been unsubscribed' : 'Unsubscribe failed';
    const message = isSuccess
        ? `<strong>${email}</strong> will no longer receive emails from this sender.`
        : 'The unsubscribe link is invalid or has expired. Please contact the sender directly.';
    const accent = isSuccess ? '#10b981' : '#ef4444';

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
    body { margin:0; font-family:-apple-system,'Segoe UI',Roboto,sans-serif; background:#f7f7f9; color:#1f2937; min-height:100vh; display:flex; align-items:center; justify-content:center; padding:20px; }
    .card { background:#fff; max-width:480px; width:100%; padding:40px 36px; border-radius:12px; box-shadow:0 10px 40px rgba(0,0,0,.08); text-align:center; }
    .icon { width:64px; height:64px; border-radius:50%; background:${accent}1a; display:flex; align-items:center; justify-content:center; margin:0 auto 20px; }
    .icon svg { width:32px; height:32px; stroke:${accent}; fill:none; stroke-width:2.5; stroke-linecap:round; stroke-linejoin:round; }
    h1 { font-size:22px; font-weight:700; margin:0 0 12px; color:#0f172a; }
    p { font-size:15px; line-height:1.6; color:#475569; margin:0 0 8px; }
    .footer { margin-top:24px; font-size:12px; color:#94a3b8; }
</style>
</head>
<body>
<div class="card">
    <div class="icon">
        ${isSuccess
            ? '<svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>'
            : '<svg viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12"/></svg>'
        }
    </div>
    <h1>${title}</h1>
    <p>${message}</p>
    <div class="footer">You can safely close this window.</div>
</div>
</body>
</html>`;
}

/**
 * GET /u/:token — clicked from email body. Records the unsubscribe and shows
 * a confirmation page.
 */
router.get('/u/:token', (req, res) => {
    const decoded = verifyToken(req.params.token);
    if (!decoded) {
        res.status(400).send(renderConfirmationPage('', 'error'));
        return;
    }
    try {
        unsubscribeDb.add(decoded.userId, decoded.email, decoded.campaignId, 'link', req.ip);
        res.send(renderConfirmationPage(decoded.email, 'success'));
    } catch (err) {
        console.error('[Unsubscribe] failed:', err);
        res.status(500).send(renderConfirmationPage(decoded.email, 'error'));
    }
});

/**
 * POST /u/:token — RFC 8058 one-click. Mail clients (Gmail/Outlook) hit this
 * directly when the user clicks their native "Unsubscribe" button.
 */
router.post('/u/:token', (req, res) => {
    const decoded = verifyToken(req.params.token);
    if (!decoded) {
        return res.status(400).json({ error: 'Invalid token' });
    }
    try {
        unsubscribeDb.add(decoded.userId, decoded.email, decoded.campaignId, 'one-click', req.ip);
        res.json({ success: true });
    } catch (err) {
        console.error('[Unsubscribe one-click] failed:', err);
        res.status(500).json({ error: 'Failed to unsubscribe' });
    }
});

export default router;
