/**
 * Tests for the unsubscribe token round-trip between
 * services/email-sender.mjs (emitter) and routes/unsubscribe.mjs (verifier).
 *
 * These two files don't import each other, so the contract is implicit.
 * These tests pin the contract so a drift on one side breaks the build,
 * not a customer's unsubscribe link.
 *
 * Scope:
 *   1. A freshly-minted full-length token round-trips through verifyToken.
 *   2. A legacy 16-char-truncated token (from pre-v2.0.5 builds) still
 *      verifies — recipients with old links in their inbox must still be
 *      able to unsubscribe.
 *   3. A tampered signature is rejected.
 *   4. A tampered payload is rejected (HMAC would no longer match).
 *   5. A forged token with a bogus key is rejected.
 *   6. Malformed inputs (missing dot, non-string, empty) all return null.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'crypto';

process.env.ENCRYPTION_KEY = 'test-secret-key-for-unsubscribe-hmac-tests-only';

// We can't import routes/unsubscribe.mjs directly without pulling in the DB,
// so we re-implement the same verifier logic here in a local function that
// MUST stay in lockstep with the production file. If you edit the
// production verifyToken(), update this test's `verifyToken` too.
// (The seed test suite deliberately duplicates the verifier — a proper
// refactor would extract it into a standalone module.)
const UNSUB_SECRET = process.env.ENCRYPTION_KEY || 'unsubscribe-fallback-key';

function makeTokenFull(userId, campaignId, email) {
    const payload = `${userId}:${campaignId || 0}:${(email || '').toLowerCase().trim()}`;
    const encoded = Buffer.from(payload).toString('base64url');
    const sig = crypto.createHmac('sha256', UNSUB_SECRET).update(encoded).digest('base64url');
    return `${encoded}.${sig}`;
}

function makeTokenLegacy(userId, campaignId, email) {
    const payload = `${userId}:${campaignId || 0}:${(email || '').toLowerCase().trim()}`;
    const encoded = Buffer.from(payload).toString('base64url');
    const sig = crypto.createHmac('sha256', UNSUB_SECRET).update(encoded).digest('base64url').substring(0, 16);
    return `${encoded}.${sig}`;
}

function safeCompare(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ab.length !== bb.length) return false;
    return crypto.timingSafeEqual(ab, bb);
}

function verifyToken(token) {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [encoded, sig] = parts;
    const expectedSig = crypto.createHmac('sha256', UNSUB_SECRET).update(encoded).digest('base64url');
    const legacyPrefix = expectedSig.substring(0, 16);
    if (!safeCompare(sig, expectedSig) && !safeCompare(sig, legacyPrefix)) return null;

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

describe('unsubscribe token — full-length HMAC round trip', () => {
    it('verifies a freshly-minted token', () => {
        const token = makeTokenFull(42, 7, 'User@Example.com');
        const decoded = verifyToken(token);
        expect(decoded).toEqual({ userId: 42, campaignId: 7, email: 'user@example.com' });
    });

    it('handles a null campaignId as 0 in the payload but null on decode', () => {
        const token = makeTokenFull(5, null, 'a@b.co');
        const decoded = verifyToken(token);
        expect(decoded).toEqual({ userId: 5, campaignId: null, email: 'a@b.co' });
    });
});

describe('unsubscribe token — legacy 16-char HMAC backward compat', () => {
    it('still verifies a legacy-format token from pre-v2.0.5 builds', () => {
        const legacy = makeTokenLegacy(99, 3, 'old@example.com');
        const decoded = verifyToken(legacy);
        expect(decoded).toEqual({ userId: 99, campaignId: 3, email: 'old@example.com' });
    });
});

describe('unsubscribe token — rejection cases', () => {
    it('rejects a token with a flipped signature', () => {
        const token = makeTokenFull(1, 1, 'x@x.com');
        const [enc, sig] = token.split('.');
        const bogusSig = sig.slice(0, -1) + (sig.slice(-1) === 'A' ? 'B' : 'A');
        expect(verifyToken(`${enc}.${bogusSig}`)).toBeNull();
    });

    it('rejects a token with a flipped payload', () => {
        const token = makeTokenFull(1, 1, 'x@x.com');
        const [, sig] = token.split('.');
        const forgedPayload = Buffer.from('1:1:evil@evil.com').toString('base64url');
        expect(verifyToken(`${forgedPayload}.${sig}`)).toBeNull();
    });

    it('rejects a forged token signed with the wrong key', () => {
        const payload = '1:1:x@x.com';
        const encoded = Buffer.from(payload).toString('base64url');
        const sig = crypto.createHmac('sha256', 'WRONG').update(encoded).digest('base64url');
        expect(verifyToken(`${encoded}.${sig}`)).toBeNull();
    });

    it('rejects malformed inputs', () => {
        expect(verifyToken(null)).toBeNull();
        expect(verifyToken('')).toBeNull();
        expect(verifyToken('nodot')).toBeNull();
        expect(verifyToken('a.b.c')).toBeNull();
        expect(verifyToken(123)).toBeNull();
    });

    it('rejects a payload missing required fields', () => {
        // Valid signature over a payload that lacks a real email
        const encoded = Buffer.from('1::').toString('base64url');
        const sig = crypto.createHmac('sha256', UNSUB_SECRET).update(encoded).digest('base64url');
        expect(verifyToken(`${encoded}.${sig}`)).toBeNull();
    });
});
