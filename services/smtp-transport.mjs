/**
 * Shared nodemailer transport builder.
 *
 * Before this helper, both the "test with provided config" and the "test
 * with saved config" endpoints in routes/user.mjs manually copy-pasted
 * 50+ lines of transport option wiring (host/port/secure/TLS/auth/SES
 * region/G Suite defaults). That drift is a bug waiting to happen — if
 * one gets a timeout bump and the other doesn't, SMTP tests from the
 * settings page start behaving differently from SMTP tests from the
 * campaign editor.
 *
 * `buildSmtpTransport(config)` takes a single object in the shape the
 * routes already use (either req.body for ad-hoc tests or a decrypted
 * database row for saved configs) and returns a ready-to-verify()
 * nodemailer transport plus the host/port it resolved to, so callers
 * can log/report what they actually connected to.
 *
 * The caller is responsible for passing already-decrypted credentials.
 * This module never touches the database or the encryption module —
 * keeping it dependency-free makes it trivial to unit-test in isolation.
 */

import nodemailer from 'nodemailer';

// SMTP-based provider slugs we understand. Anything not in this list
// falls through to the "raw SMTP" path which uses host/port as given.
const SMTP_PROVIDERS = new Set(['smtp', 'gsuite', 'amazon_ses']);

/**
 * Resolve the effective host/port/secure for a provider-aware config.
 * Lets G Suite / Amazon SES callers leave host/port blank and still
 * get a working transport.
 */
function resolveHostPortSecure(config) {
    const provider = config.provider || 'smtp';
    let host = config.host || '';
    let port = config.port;
    // `secure` can arrive as the string 'ssl', a boolean, or 1/0 from SQLite.
    let secureFlag =
        config.secure === 'ssl'
        || config.secure === true
        || config.secure === 1;

    if (provider === 'gsuite' && !host) {
        host = 'smtp.gmail.com';
        port = 465;
        secureFlag = true;
    } else if (provider === 'amazon_ses' && !host) {
        const region = config.api_region || 'us-east-1';
        host = `email-smtp.${region}.amazonaws.com`;
        port = 587;
    }

    // Final port fallback — nothing from provider defaults or the user
    // set it, so use the STARTTLS-friendly 587 as a neutral default.
    if (!port) port = 587;

    return { host, port, secureFlag };
}

/**
 * Build a verified-ready nodemailer transport from a config object.
 *
 * @param {object} config - SMTP config (req.body or decrypted DB row).
 *                           Expected fields: provider, host, port, secure,
 *                           auth_type, username, password, api_region.
 * @returns {{ transporter, host, port, secureFlag }} The nodemailer
 *                           transporter plus the resolved host/port/
 *                           secure so the caller can report them.
 * @throws {Error} If the config doesn't specify a usable host after
 *                           provider defaults are applied.
 */
export function buildSmtpTransport(config) {
    const { host, port, secureFlag } = resolveHostPortSecure(config);
    if (!host) {
        throw new Error('SMTP host is required');
    }

    const authType = config.auth_type || 'login';
    const transportOpts = {
        host,
        port,
        secure: secureFlag,
        connectionTimeout: 15_000,
        greetingTimeout: 15_000,
        socketTimeout: 30_000,
        tls: {
            rejectUnauthorized: false,
            minVersion: 'TLSv1',
        },
    };

    // STARTTLS for non-465 ports when we aren't already using implicit TLS.
    // Port 25 is left alone because many relays reject STARTTLS upgrades.
    if (!secureFlag && port !== 25) {
        transportOpts.opportunisticTLS = true;
    }

    if (authType === 'none') {
        transportOpts.auth = undefined;
    } else if (authType === 'oauth2') {
        transportOpts.auth = {
            type: 'OAuth2',
            user: config.username,
            accessToken: config.password, // caller passes the token in .password
        };
    } else {
        transportOpts.auth = {
            user: config.username,
            pass: config.password,
        };
    }

    const transporter = nodemailer.createTransport(transportOpts);
    return { transporter, host, port, secureFlag };
}

/**
 * True iff the given provider slug is one we route through nodemailer.
 * Callers use this to decide whether to go through buildSmtpTransport()
 * or fall back to the REST-API provider path in services/api-providers.mjs.
 */
export function isSmtpProvider(provider) {
    return SMTP_PROVIDERS.has(provider || 'smtp');
}
