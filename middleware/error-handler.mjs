/**
 * Central error handling + async route wrapper.
 *
 * The existing routes have 68+ handwritten try/catch blocks that all return
 * 500 {error} — even for what should be validation errors (400) or not-found
 * (404). This module provides the two primitives needed to collapse all of
 * that into a single consistent shape:
 *
 *   1. HttpError — a throwable class that carries an HTTP status code.
 *      Throw from inside a route: `throw new HttpError(400, 'Name is required')`.
 *      The error middleware at the bottom of the stack picks it up and
 *      returns { error: message } with the correct status.
 *
 *   2. asyncHandler — wraps an async route handler so any thrown error
 *      (including rejected promises) goes to Express's error pipeline via
 *      next(err). Without this, an unhandled rejection in an async handler
 *      either hangs the request or triggers a global 'unhandledRejection'
 *      — neither is what you want.
 *
 *   3. errorMiddleware — the terminal Express error handler. Must be
 *      registered LAST via app.use(errorMiddleware) after all routes.
 *      Logs the error (stack on 5xx, message on 4xx) and sends a clean
 *      JSON body back to the client.
 *
 * Usage:
 *
 *   import { asyncHandler, HttpError, errorMiddleware } from '../middleware/error-handler.mjs';
 *
 *   router.post('/things', asyncHandler(async (req, res) => {
 *       if (!req.body.name) throw new HttpError(400, 'Name is required');
 *       const row = await createThing(req.body);
 *       res.json(row);
 *   }));
 *
 *   // in server.mjs, AFTER all routes:
 *   app.use(errorMiddleware);
 */

export class HttpError extends Error {
    constructor(status, message, details = undefined) {
        super(message);
        this.name = 'HttpError';
        this.status = status;
        if (details !== undefined) this.details = details;
    }
}

/**
 * Wrap an async route handler so rejected promises AND synchronous throws
 * both flow into Express's error pipeline via next(err).
 *
 * The `Promise.resolve().then(() => fn(...))` shape is deliberate: if we
 * called `Promise.resolve(fn(...)).catch(next)` directly, a synchronous
 * throw inside `fn` would escape the expression BEFORE the .catch attaches,
 * leaving us with an uncaught exception. The extra tick of indirection
 * catches the sync-throw case too.
 */
export function asyncHandler(fn) {
    return (req, res, next) => {
        // Return the chain so callers (and tests) can await completion.
        // Express ignores the return value from middleware, so this has
        // zero effect on production behaviour.
        return Promise.resolve().then(() => fn(req, res, next)).catch(next);
    };
}

/**
 * Terminal error middleware. Must be registered LAST.
 * Contract:
 *   - HttpError with explicit status → that status + { error: message }
 *     (optionally + { details } if provided)
 *   - SyntaxError from express.json() body parsing → 400 { error: 'Invalid JSON' }
 *   - SQLITE_CONSTRAINT errors → 409 { error: 'Conflict: ...' }
 *   - Anything else → 500 { error: 'Internal server error' } with full stack logged
 */
// eslint-disable-next-line no-unused-vars
export function errorMiddleware(err, req, res, next) {
    // If a response has already been flushed, delegate to Express's default
    // handler which will close the connection cleanly.
    if (res.headersSent) return next(err);

    // HttpError — explicit status code from the route
    if (err instanceof HttpError) {
        const body = { error: err.message };
        if (err.details !== undefined) body.details = err.details;
        // Log 4xx at warn, 5xx at error
        if (err.status >= 500) {
            console.error(`[${req.method} ${req.originalUrl}] ${err.status}`, err.stack || err.message);
        } else {
            console.warn(`[${req.method} ${req.originalUrl}] ${err.status} ${err.message}`);
        }
        return res.status(err.status).json(body);
    }

    // Bad JSON body from express.json()
    if (err && err.type === 'entity.parse.failed') {
        console.warn(`[${req.method} ${req.originalUrl}] 400 Invalid JSON`);
        return res.status(400).json({ error: 'Invalid JSON body' });
    }

    // SQLite UNIQUE / FK / NOT NULL constraint violations
    if (err && typeof err.code === 'string' && err.code.startsWith('SQLITE_CONSTRAINT')) {
        console.warn(`[${req.method} ${req.originalUrl}] 409`, err.message);
        return res.status(409).json({ error: 'Conflict: ' + (err.message || 'constraint failed') });
    }

    // Fallback — anything else is a server bug
    console.error(`[${req.method} ${req.originalUrl}] 500`, err && err.stack || err);
    return res.status(500).json({ error: 'Internal server error' });
}
