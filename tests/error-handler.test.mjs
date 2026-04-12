/**
 * Tests for middleware/error-handler.mjs — the central Express error pipe.
 *
 * The error middleware is the single point of control for HTTP status codes
 * returned to the client. If this breaks, every route starts returning the
 * wrong status, and clients silently misinterpret failures.
 *
 * Scope:
 *   1. HttpError with an explicit status flows through to res.status().
 *   2. HttpError.details is surfaced in the response when provided.
 *   3. express.json() body-parse errors become 400 "Invalid JSON body".
 *   4. SQLite constraint errors become 409.
 *   5. Anything else becomes 500 "Internal server error".
 *   6. asyncHandler catches rejected promises from async handlers.
 *   7. asyncHandler passes non-async errors through to next() too.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpError, asyncHandler, errorMiddleware } from '../middleware/error-handler.mjs';

// Minimal req/res fake that implements the tiny subset we care about.
function makeRes() {
    const res = {
        statusCode: 200,
        headersSent: false,
        body: undefined,
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; this.headersSent = true; return this; },
    };
    return res;
}
function makeReq(method = 'POST', url = '/x') {
    return { method, originalUrl: url };
}

// Silence the middleware's console.* during tests so the output is clean.
beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('errorMiddleware — HttpError path', () => {
    it('returns the exact status code from an HttpError', () => {
        const res = makeRes();
        errorMiddleware(new HttpError(404, 'Not found'), makeReq(), res, () => {});
        expect(res.statusCode).toBe(404);
        expect(res.body).toEqual({ error: 'Not found' });
    });

    it('includes details when HttpError carries them', () => {
        const res = makeRes();
        errorMiddleware(
            new HttpError(400, 'Validation failed', { field: 'email' }),
            makeReq(),
            res,
            () => {}
        );
        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({ error: 'Validation failed', details: { field: 'email' } });
    });

    it('handles 500-series HttpErrors (still HttpError — not generic)', () => {
        const res = makeRes();
        errorMiddleware(new HttpError(503, 'Backend down'), makeReq(), res, () => {});
        expect(res.statusCode).toBe(503);
        expect(res.body).toEqual({ error: 'Backend down' });
    });
});

describe('errorMiddleware — express.json parse failure', () => {
    it('maps entity.parse.failed to 400 Invalid JSON body', () => {
        const res = makeRes();
        const parseErr = Object.assign(new SyntaxError('Unexpected token'), {
            type: 'entity.parse.failed',
        });
        errorMiddleware(parseErr, makeReq(), res, () => {});
        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({ error: 'Invalid JSON body' });
    });
});

describe('errorMiddleware — SQLite constraint errors', () => {
    it('maps SQLITE_CONSTRAINT_UNIQUE to 409', () => {
        const res = makeRes();
        const err = Object.assign(new Error('UNIQUE constraint failed: smtp.name'), {
            code: 'SQLITE_CONSTRAINT_UNIQUE',
        });
        errorMiddleware(err, makeReq(), res, () => {});
        expect(res.statusCode).toBe(409);
        expect(res.body.error).toContain('Conflict');
    });

    it('maps SQLITE_CONSTRAINT_FOREIGNKEY to 409', () => {
        const res = makeRes();
        const err = Object.assign(new Error('FOREIGN KEY constraint failed'), {
            code: 'SQLITE_CONSTRAINT_FOREIGNKEY',
        });
        errorMiddleware(err, makeReq(), res, () => {});
        expect(res.statusCode).toBe(409);
    });
});

describe('errorMiddleware — fallback 500', () => {
    it('maps an unknown error to 500 Internal server error', () => {
        const res = makeRes();
        errorMiddleware(new Error('something weird'), makeReq(), res, () => {});
        expect(res.statusCode).toBe(500);
        expect(res.body).toEqual({ error: 'Internal server error' });
    });

    it('delegates to next() if headers have already been sent', () => {
        const res = makeRes();
        res.headersSent = true;
        const next = vi.fn();
        const err = new Error('late');
        errorMiddleware(err, makeReq(), res, next);
        expect(next).toHaveBeenCalledWith(err);
        // And the original response state is untouched.
        expect(res.statusCode).toBe(200);
    });
});

describe('asyncHandler', () => {
    it('passes rejected promises to next()', async () => {
        const err = new HttpError(400, 'bad');
        const next = vi.fn();
        const handler = asyncHandler(async () => { throw err; });
        await handler(makeReq(), makeRes(), next);
        expect(next).toHaveBeenCalledWith(err);
    });

    it('passes synchronous throws to next() too', async () => {
        const err = new HttpError(500, 'sync');
        const next = vi.fn();
        const handler = asyncHandler(() => { throw err; });
        await handler(makeReq(), makeRes(), next);
        expect(next).toHaveBeenCalledWith(err);
    });

    it('does NOT call next() when the handler resolves cleanly', async () => {
        const next = vi.fn();
        const handler = asyncHandler(async (req, res) => { res.json({ ok: true }); });
        await handler(makeReq(), makeRes(), next);
        expect(next).not.toHaveBeenCalled();
    });
});
