const { app, BrowserWindow, ipcMain, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { machineIdSync } = require('node-machine-id');

// ==========================================================================
// Single-instance lock. Without this, a user who double-clicks the icon (or
// clicks a second desktop shortcut) launches two processes: both try to bind
// port 3000, both race on the SQLite WAL file, one of them crashes silently
// and the user sees "half of my campaigns disappeared". Acquire the lock
// BEFORE any other bootstrapping so a duplicate launch exits immediately.
// ==========================================================================
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    // Another instance already owns MailFlow — exit quietly. The first
    // instance's "second-instance" handler will focus its window.
    app.quit();
    // Hard-return so nothing else in this file runs in the losing process.
    process.exit(0);
}
app.on('second-instance', () => {
    // User tried to open MailFlow again — focus the existing window instead
    // of booting a new copy.
    if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
    }
});

// ==========================================================================
// Crash reporting + rotating logs. Winston is wired to write to
// app.getPath('logs') (resolved lazily inside setupLogging() because
// app.getPath is only available after the 'ready' event for some paths).
// Uncaught exceptions and unhandled rejections are piped to the log file
// AND shown to the user via a dialog so they don't silently lose work.
// ==========================================================================
let logger = null;
function setupLogging() {
    try {
        const winston = require('winston');
        const logsDir = app.getPath('logs');
        try { fs.mkdirSync(logsDir, { recursive: true }); } catch {}
        logger = winston.createLogger({
            level: process.env.MAILFLOW_LOG_LEVEL || 'info',
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.errors({ stack: true }),
                winston.format.printf(({ timestamp, level, message, stack }) =>
                    `${timestamp} [${level}] ${stack || message}`)
            ),
            transports: [
                new winston.transports.File({
                    filename: path.join(logsDir, 'main.log'),
                    maxsize: 5 * 1024 * 1024, // 5 MB per file
                    maxFiles: 5,              // keep 5 rotated files
                    tailable: true,
                }),
                new winston.transports.File({
                    filename: path.join(logsDir, 'error.log'),
                    level: 'error',
                    maxsize: 5 * 1024 * 1024,
                    maxFiles: 5,
                    tailable: true,
                }),
            ],
        });
        // Mirror console.log / console.error into winston so all existing
        // [License], [Updater], etc. logs land in the log file too. We
        // keep the original console bindings so dev runs still see output.
        const origLog = console.log.bind(console);
        const origErr = console.error.bind(console);
        const origWarn = console.warn.bind(console);
        console.log  = (...args) => { try { logger.info(args.map(a => a instanceof Error ? a.stack : typeof a === 'string' ? a : JSON.stringify(a)).join(' ')); } catch {} origLog(...args); };
        console.warn = (...args) => { try { logger.warn(args.map(a => a instanceof Error ? a.stack : typeof a === 'string' ? a : JSON.stringify(a)).join(' ')); } catch {} origWarn(...args); };
        console.error= (...args) => { try { logger.error(args.map(a => a instanceof Error ? a.stack : typeof a === 'string' ? a : JSON.stringify(a)).join(' ')); } catch {} origErr(...args); };
        logger.info(`[Logging] Initialized at ${logsDir}`);
    } catch (e) {
        // Winston missing or failed to init — don't crash the app over it.
        console.warn('[Logging] Setup failed:', e && e.message);
    }
}
process.on('uncaughtException', (err) => {
    try { (logger || console).error('[Fatal] uncaughtException:', err && err.stack || err); } catch {}
    try {
        if (app.isReady()) {
            dialog.showErrorBox('MailFlow crashed',
                `An unexpected error occurred:\n\n${err && err.message ? err.message : err}\n\nSee the log file under %APPDATA%\\MailFlow 2.0\\logs for details.`);
        }
    } catch {}
    // Give the log transport a moment to flush, then exit non-zero so the
    // OS records the crash.
    setTimeout(() => process.exit(1), 500);
});
process.on('unhandledRejection', (reason) => {
    try { (logger || console).error('[Fatal] unhandledRejection:', reason && reason.stack || reason); } catch {}
    // Do NOT exit on unhandled rejections in the main process — many come
    // from transient network failures (license server, auto-updater) that
    // we recover from. Log and continue.
});

// electron-updater is loaded lazily so a missing module never blocks app boot
// (e.g. when running in dev mode where it isn't strictly required).
let autoUpdater = null;
try {
    autoUpdater = require('electron-updater').autoUpdater;
} catch (e) {
    console.warn('[Updater] electron-updater not loaded:', e.message);
}

let mainWindow = null;
let serverReady = false;
let updateCheckInterval = null;
let licenseRevalidateInterval = null;

const PORT = process.env.PORT || 3000;
const LICENSE_API = 'https://mailflow.zeabur.app';
const PRODUCT_SLUG = 'mailflow';
const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
const LICENSE_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours — validate against server at most this often
const LICENSE_REVALIDATE_INTERVAL_MS = 24 * 60 * 60 * 1000; // full re-check every 24h while app runs
const VALIDATE_DEDUPE_WINDOW_MS = 30 * 1000; // renderer calls validateLicense() on boot; we already ran it — dedupe for 30s

// ==========================================================================
// License Management — talks to the MailFlow license server.
// Contract: https://mailflow.zeabur.app
//   POST /api/activate   { license_key, machine_id, product } → { license }
//   POST /api/validate   { license_key, machine_id }          → { valid, license }
//   POST /api/deactivate { license_key, machine_id }          → { success }
//   GET  /api/public-key?product=<slug>                       → { public_key, kid }
// ==========================================================================

function userDataPath(...segments) {
    return path.join(app.getPath('userData'), ...segments);
}

function machineIdFilePath() { return userDataPath('machine.id'); }
function licenseCachePath() { return userDataPath('license.json'); }

// Whitelist key identifiers to safe filename characters before using them
// in a path. The kid arrives from the network *before* we have a public
// key to verify any signature, so we must not let a malicious server
// supply path-traversal characters here.
function isSafeKid(kid) {
    return typeof kid === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(kid) && !kid.includes('..');
}
function publicKeyPath(kid) {
    if (!isSafeKid(kid)) throw new Error('refusing to use unsafe kid in filename: ' + JSON.stringify(kid));
    return userDataPath(`server-key-${kid}.pem`);
}

/**
 * Derive a stable hardware fingerprint once and persist it. `node-machine-id`
 * reads the OS-level unique machine ID (registry on Windows, /etc/machine-id on
 * Linux, IOPlatformUUID on macOS) — stable across reboots and reinstalls on
 * the same hardware. We also write it to userData so the user can copy it for
 * support and so a re-derivation never drifts.
 */
function getOrCreateMachineId() {
    const p = machineIdFilePath();
    try {
        const cached = fs.readFileSync(p, 'utf-8').trim();
        if (cached) return cached;
    } catch { /* fall through */ }
    let id;
    try {
        id = machineIdSync({ original: true });
    } catch (e) {
        // Extremely rare fallback — node-machine-id failed to read the OS ID.
        // Hash hostname + user home so we still produce SOMETHING stable.
        const fallback = `${require('os').hostname()}:${app.getPath('home')}`;
        id = crypto.createHash('sha256').update(fallback).digest('hex');
        console.warn('[License] machine-id fallback used:', e.message);
    }
    try { fs.writeFileSync(p, id); } catch (e) { console.warn('[License] could not persist machine.id:', e.message); }
    return id;
}

// In-memory mirror of the license cache so we don't hit disk on every IPC call.
// Populated by readLicenseCache() and kept in sync by writeLicenseCache()/clearLicenseCache().
let memCachedLicense = undefined; // `undefined` = not yet loaded, `null` = verified empty, object = loaded
// Short-lived memo of the last validateLicense() result, so boot + renderer's
// own call within a few seconds share the same answer instead of double-hitting
// /api/validate.
let lastValidateResult = null;
let lastValidateAt = 0;

function readLicenseCache() {
    if (memCachedLicense !== undefined) return memCachedLicense;
    try {
        const raw = fs.readFileSync(licenseCachePath(), 'utf-8');
        const blob = JSON.parse(raw);
        if (blob && typeof blob === 'object' && blob.license) {
            memCachedLicense = blob;
            return blob;
        }
        memCachedLicense = null;
        return null;
    } catch (e) {
        if (e && e.code !== 'ENOENT') console.warn('[License] cache read failed:', e.message);
        memCachedLicense = null;
        return null;
    }
}

function writeLicenseCache(license) {
    const blob = { license, last_validated_at: new Date().toISOString() };
    fs.writeFileSync(licenseCachePath(), JSON.stringify(blob, null, 2));
    memCachedLicense = blob;
    return blob;
}

function clearLicenseCache() {
    try { fs.unlinkSync(licenseCachePath()); } catch (e) {
        if (e && e.code !== 'ENOENT') console.warn('[License] cache delete failed:', e.message);
    }
    memCachedLicense = null;
    lastValidateResult = null;
    // A wiped cache should also stop the periodic 24h re-check — otherwise it
    // keeps firing against nothing and repeatedly notifies the renderer.
    stopPeriodicRevalidation();
}

function readPublicKey(kid) {
    if (!isSafeKid(kid)) return null;
    try {
        return fs.readFileSync(publicKeyPath(kid), 'utf-8');
    } catch (e) {
        if (e && e.code !== 'ENOENT') console.warn('[License] public key read failed for kid', kid, '—', e.message);
        return null;
    }
}

function writePublicKey(kid, pem) {
    if (!isSafeKid(kid)) {
        console.warn('[License] refusing to cache public key with unsafe kid:', kid);
        return;
    }
    try { fs.writeFileSync(publicKeyPath(kid), pem); } catch (e) { console.warn('[License] could not cache public key:', e.message); }
}

/**
 * Delete the on-disk public key cache for a kid. Called when signature
 * verification fails against the cached key — the server may have rotated
 * its keypair under the same kid (production incident 2026-04-15). On
 * next verification attempt we'll refetch a fresh key from the server.
 */
function clearCachedPublicKey(kid) {
    if (!isSafeKid(kid)) return;
    try {
        const p = publicKeyPath(kid);
        if (fs.existsSync(p)) {
            fs.unlinkSync(p);
            console.log('[License] Cleared cached public key for kid:', kid);
        }
    } catch (e) {
        console.warn('[License] Could not clear cached public key:', e.message);
    }
}

/**
 * One-time boot migration for v2.0.17. Installs from v2.0.0–v2.0.16 may
 * hold a cached server-key-<kid>.pem that was rotated under the same kid
 * during a server redeploy (prod incident 2026-04-15, before keys/ went
 * onto the persistent volume). Wipe all cached pubkeys exactly once so
 * the next activation refetches the current production key.
 *
 * The marker file ensures this only runs once per install, even though
 * future upgrades will re-trigger boot. Subsequent rotations are handled
 * automatically by verifyLicenseSignatureWithRetry().
 */
function runPubkeyCacheMigrationV2017() {
    const flagFile = userDataPath('pubkey-cache-migration-v2017.flag');
    if (fs.existsSync(flagFile)) return;
    try {
        const userData = userDataPath();
        let cleared = 0;
        for (const f of fs.readdirSync(userData)) {
            if (f.startsWith('server-key-') && f.endsWith('.pem')) {
                try { fs.unlinkSync(path.join(userData, f)); cleared++; } catch {}
            }
        }
        fs.writeFileSync(flagFile, new Date().toISOString());
        if (cleared > 0) {
            console.log(`[License] v2.0.17 migration: cleared ${cleared} stale cached public key(s). Next license check will refetch from the server.`);
        }
    } catch (e) {
        console.warn('[License] v2.0.17 pubkey cache migration failed:', e.message);
    }
}

/**
 * Minimal HTTPS client for license-server endpoints. Returns
 * `{ status, data }` with `data` parsed as JSON when possible.
 */
function licenseRequest(method, endpoint, body) {
    return new Promise((resolve, reject) => {
        const url = new URL(endpoint, LICENSE_API);
        const mod = url.protocol === 'https:' ? https : http;
        const payload = body ? JSON.stringify(body) : null;
        const headers = {};
        if (payload) {
            headers['Content-Type'] = 'application/json';
            headers['Content-Length'] = Buffer.byteLength(payload);
        }
        const req = mod.request(url, { method, headers, timeout: 15000 }, (res) => {
            let buf = '';
            res.on('data', chunk => buf += chunk);
            res.on('end', () => {
                let parsed = null;
                try { parsed = JSON.parse(buf); } catch { parsed = { error: buf }; }
                resolve({ status: res.statusCode, data: parsed });
            });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
        if (payload) req.write(payload);
        req.end();
    });
}

/**
 * Fetch and cache the server's public key for a given kid. The contract says
 * keys can rotate, so when a cached blob's kid isn't on disk we re-fetch.
 */
async function fetchPublicKey(kid) {
    const res = await licenseRequest('GET', `/api/public-key?product=${encodeURIComponent(PRODUCT_SLUG)}`);
    if (res.status !== 200 || !res.data || !res.data.public_key) {
        throw new Error(`public-key fetch failed: ${res.status}`);
    }
    const returnedKid = res.data.kid || kid;
    if (!isSafeKid(returnedKid)) {
        throw new Error('public-key response had unsafe kid: ' + JSON.stringify(returnedKid));
    }
    // Sanity-check the PEM looks like a PEM, not arbitrary binary
    const pem = String(res.data.public_key);
    if (!pem.includes('BEGIN PUBLIC KEY') && !pem.includes('BEGIN RSA PUBLIC KEY')) {
        throw new Error('public-key response did not look like a PEM');
    }
    writePublicKey(returnedKid, pem);
    return { kid: returnedKid, pem };
}

/**
 * Verify an RSA-SHA256 signature over the license payload. The server signs
 * JSON.stringify(licenseWithoutSignature) — we reproduce that by rest-
 * destructuring out `signature`, which preserves original key insertion order.
 */
/**
 * Recursively sort object keys for a canonical JSON representation.
 * Matches what `canonicalize` / RFC 8785 libraries produce — handles
 * the case where the server signs with sorted-key JSON instead of
 * insertion-order.
 */
function canonicalStringify(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(canonicalStringify).join(',') + ']';
    const keys = Object.keys(value).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalStringify(value[k])).join(',') + '}';
}

/**
 * Verify the RSA signature on a license blob. The server might have used
 * any of several signing conventions (insertion-order vs sorted JSON,
 * PKCS1-v1.5 vs PSS padding, SHA-256 vs SHA-512, base64 vs hex). Rather
 * than guess, we try all reasonable combinations — if ANY cryptographic
 * combination verifies, the signature is genuine and we accept.
 *
 * This is safe because:
 *   - All variants require the correct private key (which only the server has)
 *   - A tampered signature fails ALL 24 combinations (we'd still reject)
 *   - HTTPS + the public-key-fetch step independently authenticate the server
 *
 * The defense-in-depth property is preserved: only the serialization /
 * padding choice is flexible, not the cryptographic security.
 */
function verifyLicenseSignature(license, publicKeyPem) {
    if (!license || !license.signature || !publicKeyPem) {
        if (!license) console.warn('[License] verify: no license');
        else if (!license.signature) console.warn('[License] verify: no signature field');
        else console.warn('[License] verify: no public key PEM');
        return false;
    }

    const { signature, ...payload } = license;

    // Candidate signing inputs — each one is a plausible JSON encoding of
    // the payload. The server used one of these.
    const inputs = [
        {name: 'insertion', json: JSON.stringify(payload)},
        {name: 'shallow-sorted', json: JSON.stringify(payload, Object.keys(payload).sort())},
        {name: 'canonical-deep-sorted', json: canonicalStringify(payload)},
    ];

    // Candidate signature buffers (base64 is the overwhelmingly common choice
    // but try hex as a safety net).
    const sigBufs = [];
    try { sigBufs.push({name: 'base64', buf: Buffer.from(signature, 'base64')}); } catch {}
    try { sigBufs.push({name: 'hex', buf: Buffer.from(signature, 'hex')}); } catch {}

    const hashes = ['sha256', 'sha512'];
    const paddings = [
        {name: 'PKCS1', value: crypto.constants.RSA_PKCS1_PADDING},
        {name: 'PSS', value: crypto.constants.RSA_PKCS1_PSS_PADDING},
    ];

    for (const input of inputs) {
        const data = Buffer.from(input.json, 'utf-8');
        for (const hash of hashes) {
            for (const padding of paddings) {
                for (const sig of sigBufs) {
                    try {
                        const ok = crypto.verify(
                            hash,
                            data,
                            {key: publicKeyPem, padding: padding.value},
                            sig.buf
                        );
                        if (ok) {
                            console.log(`[License] signature verified via: ${input.name} + ${hash.toUpperCase()} + ${padding.name} + ${sig.name}`);
                            return true;
                        }
                    } catch {
                        // PSS + PKCS1 key types can throw; swallow and continue
                    }
                }
            }
        }
    }

    // All 24 combinations failed. Emit a focused diagnostic so we can hand off
    // details to the server team without recompiling.
    console.warn('[License] signature verification failed across all 24 variants');
    console.warn('[License] payload SHA256 (insertion): ' + crypto.createHash('sha256').update(inputs[0].json).digest('hex').substring(0, 16));
    console.warn('[License] payload SHA256 (sorted):    ' + crypto.createHash('sha256').update(inputs[1].json).digest('hex').substring(0, 16));
    console.warn('[License] payload SHA256 (canonical): ' + crypto.createHash('sha256').update(inputs[2].json).digest('hex').substring(0, 16));
    console.warn('[License] signature length: ' + String(signature).length);
    return false;
}

/**
 * Ensure we have a valid public key on disk for the license's kid, re-
 * fetching if needed. Returns the PEM or null on failure.
 */
async function ensurePublicKeyForLicense(license) {
    if (!license || !license.kid) return null;
    let pem = readPublicKey(license.kid);
    if (pem) return pem;
    try {
        const fresh = await fetchPublicKey(license.kid);
        return fresh.pem;
    } catch (e) {
        console.warn('[License] could not fetch public key for kid', license.kid, '—', e.message);
        return null;
    }
}

/**
 * Verify the license signature, retrying once with a fresh public key
 * if the first attempt fails. Self-heals server-side keypair rotations
 * (any future incident like 2026-04-15 won't break installed clients).
 *
 * Returns true on verified, false on rejected.
 */
async function verifyLicenseSignatureWithRetry(license) {
    if (!license || !license.kid) return false;

    // First attempt: cached key (or fetched fresh if no cache exists)
    const cachedPem = await ensurePublicKeyForLicense(license);
    if (cachedPem && verifyLicenseSignature(license, cachedPem)) {
        return true;
    }

    // Verification failed — could be a stale cached key from before a
    // server-side rotation. Wipe the cache and refetch from /api/public-key.
    console.warn('[License] First verify attempt failed — refreshing public key cache for kid:', license.kid);
    clearCachedPublicKey(license.kid);
    try {
        const fresh = await fetchPublicKey(license.kid);
        if (verifyLicenseSignature(license, fresh.pem)) {
            console.log('[License] Signature verified after refreshing public key cache (server keypair likely rotated)');
            return true;
        }
    } catch (e) {
        console.warn('[License] Public key refresh failed:', e.message);
    }

    return false;
}

function licenseExpiryMs(license) {
    if (!license || !license.expiry) return null;
    const t = new Date(license.expiry).getTime();
    return isNaN(t) ? null : t;
}

function isWithinCacheTtl(blob) {
    if (!blob || !blob.last_validated_at) return false;
    const t = new Date(blob.last_validated_at).getTime();
    if (isNaN(t)) return false;
    return (Date.now() - t) < LICENSE_CACHE_TTL_MS;
}

/**
 * Map server error shapes to human strings. Called from the activate flow.
 */
function activationErrorMessage(status, data) {
    if (status === 404) return "This license key doesn't exist. Check for typos.";
    if (status === 403) return 'This license has been revoked. Contact support if you believe this is a mistake.';
    if (status === 409) {
        const used = data?.used;
        const limit = data?.limit;
        if (used != null && limit != null) return `All ${limit} seats are in use. Deactivate another machine first or upgrade.`;
        return 'All seats are in use. Deactivate another machine first or upgrade.';
    }
    if (status >= 500) return "Couldn't reach the license server. Check your connection and try again.";
    return (data && data.error) || 'Activation failed';
}

async function activateLicense(licenseKey) {
    const machineId = getOrCreateMachineId();
    const trimmed = (licenseKey || '').trim().toUpperCase();
    try {
        const res = await licenseRequest('POST', '/api/activate', {
            license_key: trimmed,
            machine_id: machineId,
            product: PRODUCT_SLUG
        });

        if (res.status !== 200 || !res.data || !res.data.license) {
            return { success: false, error: activationErrorMessage(res.status, res.data) };
        }

        const license = res.data.license;

        // Verify the signature; retry with a fresh public key on failure
        // so a server-side keypair rotation auto-heals on the client.
        if (!(await verifyLicenseSignatureWithRetry(license))) {
            return { success: false, error: 'License signature invalid — refusing to trust this response.' };
        }

        writeLicenseCache(license);
        lastValidateResult = null; // force next validateLicense() to re-run
        startPeriodicRevalidation();
        return { success: true, license };
    } catch (err) {
        return { success: false, error: "Couldn't reach the license server. Check your connection and try again." };
    }
}

/**
 * Validate the cached license. Strategy:
 *   1. No cache → no_license.
 *   2. Cache hit AND expiry > 24h away AND last_validated_at < 24h old AND
 *      signature verifies → trust cache, no network.
 *   3. Otherwise hit /api/validate:
 *      - {valid:true} → refresh cache, return valid.
 *      - {valid:false} or 4xx → wipe cache, return invalid.
 *      - network error + cache still within expiry → offline grace.
 *      - network error + cache past expiry → hard fail.
 */
async function validateLicense() {
    // Dedupe: boot calls validateLicense(), then renderer's loadLicenseInfo()
    // fires the same IPC a moment later. Share the result within a short window.
    if (lastValidateResult && (Date.now() - lastValidateAt) < VALIDATE_DEDUPE_WINDOW_MS) {
        return lastValidateResult;
    }
    const result = await doValidateLicense();
    lastValidateResult = result;
    lastValidateAt = Date.now();
    return result;
}

async function doValidateLicense() {
    const cached = readLicenseCache();
    if (!cached) {
        return { valid: false, reason: 'no_license' };
    }

    const license = cached.license;
    const expiryMs = licenseExpiryMs(license);
    const now = Date.now();
    const hasExpired = expiryMs != null && expiryMs <= now;
    // A lifetime license (no expiry) is treated as "far in the future" for
    // fast-path purposes, otherwise every boot would force a server round-trip.
    const expiresFarEnoughAway = expiryMs == null || (expiryMs - now) > LICENSE_CACHE_TTL_MS;

    // --- Fast path: trust the cache if it's fresh and signature still verifies.
    // Use the retry-with-fresh-key helper so a server keypair rotation since
    // we last cached the license auto-heals on the next launch.
    if (!hasExpired && expiresFarEnoughAway && isWithinCacheTtl(cached)) {
        if (await verifyLicenseSignatureWithRetry(license)) {
            console.log('[License] cache-hit validation (signature OK, fresh)');
            return { valid: true, license, source: 'cache' };
        }
        console.warn('[License] cache signature invalid — forcing server revalidation');
    }

    // --- Slow path: hit the server
    console.log(`[License] Validating with server for key ${String(license.license_key || '').substring(0, 4)}••••...`);
    try {
        const res = await licenseRequest('POST', '/api/validate', {
            license_key: license.license_key,
            machine_id: getOrCreateMachineId()
        });

        if (res.status >= 400) {
            console.log('[License] Server rejected license:', res.status, res.data?.error);
            clearLicenseCache();
            return { valid: false, reason: res.data?.error || 'License invalid', status: res.status };
        }
        if (res.data && res.data.valid === false) {
            console.log('[License] Server says not valid:', res.data.error);
            clearLicenseCache();
            return { valid: false, reason: res.data.error || 'License invalid' };
        }

        const fresh = res.data.license || license;
        if (!(await verifyLicenseSignatureWithRetry(fresh))) {
            console.warn('[License] Server response signature invalid — refusing');
            clearLicenseCache();
            return { valid: false, reason: 'Signature invalid' };
        }

        writeLicenseCache(fresh);
        console.log('[License] Validated successfully by server');
        return { valid: true, license: fresh, source: 'server' };
    } catch (err) {
        // Network error — offline grace if the cache isn't expired. A lifetime
        // license (null expiry) always qualifies for offline grace.
        if (!hasExpired) {
            console.log('[License] Server unreachable, cache still valid — offline grace:', err.message);
            return { valid: true, license, offline: true, source: 'offline' };
        }
        console.log('[License] Server unreachable and cache expired — hard fail:', err.message);
        return { valid: false, reason: 'offline_and_expired' };
    }
}

async function deactivateLicense() {
    const cached = readLicenseCache();
    const machineId = getOrCreateMachineId();
    const licenseKey = cached?.license?.license_key;

    if (licenseKey) {
        try {
            await licenseRequest('POST', '/api/deactivate', { license_key: licenseKey, machine_id: machineId });
        } catch (e) {
            console.warn('[License] deactivate call failed (continuing to wipe local cache):', e.message);
        }
    }
    clearLicenseCache();
    stopPeriodicRevalidation();
    return { success: true };
}

/**
 * Summary view of the cached license for the renderer — includes masked key,
 * machine ID, tier/plan, entitlements, expiry, trial status. No signature.
 */
function getCachedLicenseSummary() {
    const cached = readLicenseCache();
    if (!cached || !cached.license) return null;
    const l = cached.license;
    return {
        license_key: l.license_key,
        // Always show the live machine ID — a backup restored onto a different
        // machine should surface the new host's ID, not the old one baked into
        // the stored license blob.
        machine_id: getOrCreateMachineId(),
        tier: l.tier,
        product: l.product,
        is_trial: !!l.is_trial,
        entitlements: l.entitlements || {},
        customer: l.customer || null,
        expiry: l.expiry,
        activated_at: l.activated_at,
        seat_index: l.seat_index,
        seat_limit: l.seat_limit,
        note: l.note,
        last_validated_at: cached.last_validated_at
    };
}

/**
 * Fire the 24h re-check. If the license comes back invalid mid-session, push
 * a `license-status-changed` event to the renderer so it can show a blocker.
 */
function startPeriodicRevalidation() {
    stopPeriodicRevalidation();
    licenseRevalidateInterval = setInterval(async () => {
        try {
            const result = await validateLicense();
            if (mainWindow && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
                mainWindow.webContents.send('license-status-changed', result);
            }
            if (!result.valid) {
                console.warn('[License] periodic re-check failed:', result.reason);
            }
        } catch (e) {
            console.warn('[License] periodic re-check threw:', e.message);
        }
    }, LICENSE_REVALIDATE_INTERVAL_MS);
}

function stopPeriodicRevalidation() {
    if (licenseRevalidateInterval) {
        clearInterval(licenseRevalidateInterval);
        licenseRevalidateInterval = null;
    }
}

// --- Auto-Updater (electron-updater) ---
function setupAutoUpdater() {
    if (!autoUpdater) {
        console.log('[Updater] Skipped — electron-updater not available');
        return;
    }
    // We control the prompt UX from the renderer — don't auto-download
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    // On Windows, electron-updater verifies SHA512 from latest.yml against the
    // downloaded installer regardless of code-signing status.
    autoUpdater.allowPrerelease = false;

    const send = (channel, payload) => {
        if (mainWindow && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
            mainWindow.webContents.send(channel, payload);
        }
    };

    autoUpdater.on('checking-for-update', () => {
        console.log('[Updater] Checking for update…');
        send('update:checking');
    });
    autoUpdater.on('update-available', (info) => {
        console.log('[Updater] Update available:', info.version);
        send('update:available', {
            version: info.version,
            releaseNotes: info.releaseNotes || '',
            releaseDate: info.releaseDate || ''
        });
    });
    autoUpdater.on('update-not-available', (info) => {
        console.log('[Updater] No update available (current ' + (info?.version || '?') + ')');
        send('update:not-available', { version: info?.version });
    });
    autoUpdater.on('download-progress', (progress) => {
        send('update:progress', {
            percent: Math.round(progress.percent || 0),
            bytesPerSecond: progress.bytesPerSecond,
            transferred: progress.transferred,
            total: progress.total
        });
    });
    autoUpdater.on('update-downloaded', (info) => {
        console.log('[Updater] Update downloaded:', info.version);
        send('update:downloaded', {
            version: info.version,
            releaseNotes: info.releaseNotes || ''
        });
    });
    autoUpdater.on('error', (err) => {
        console.error('[Updater] Error:', err?.message || err);
        send('update:error', { message: err?.message || String(err) });
    });

    // Initial check 5 seconds after window is ready (gives the server time to boot)
    setTimeout(() => {
        autoUpdater.checkForUpdates().catch(e => console.warn('[Updater] check failed:', e.message));
    }, 5000);

    // Recurring check every 4 hours
    updateCheckInterval = setInterval(() => {
        autoUpdater.checkForUpdates().catch(e => console.warn('[Updater] check failed:', e.message));
    }, UPDATE_CHECK_INTERVAL_MS);
}

async function startServer() {
    // Set user data path for database and uploads (app must be ready first)
    process.env.MAILFLOW_USER_DATA = app.getPath('userData');
    process.env.MAILFLOW_SCHEMA_PATH = path.join(__dirname, '..', 'database', 'schema.sql');
    try {
        // Dynamic import for ESM server module
        const server = await import(
            'file://' + path.join(__dirname, '..', 'server.mjs').replace(/\\/g, '/')
        );
        serverReady = true;
        console.log('Express server started successfully');
        return server;
    } catch (error) {
        console.error('Failed to start server:', error);
        const { dialog } = require('electron');
        dialog.showErrorBox('MailFlow 2.0',
            `Could not start server: ${error.message}\n\nMake sure no other instance is running.`);
        app.quit();
    }
}

function createWindow() {
    const iconPath = path.join(__dirname, '..', 'public', 'img', 'logo.ico');
    const appIcon = nativeImage.createFromPath(iconPath);

    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1280,
        minHeight: 720,
        frame: false,
        titleBarStyle: 'hidden',
        backgroundColor: '#050508',
        icon: appIcon,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        },
        show: false
    });

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    mainWindow.loadURL(`http://localhost:${PORT}`);

    mainWindow.on('maximize', () => {
        mainWindow.webContents.send('maximize-change', true);
    });

    mainWindow.on('unmaximize', () => {
        mainWindow.webContents.send('maximize-change', false);
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// App lifecycle
app.on('ready', async () => {
    // Wire rotating file logs + crash capture BEFORE anything else so
    // license validation, server boot, and auto-updater events all land
    // in main.log / error.log.
    setupLogging();

    // One-time migration: wipe stale cached pubkeys from pre-2.0.17 installs
    // (prod keypair rotation 2026-04-15 left clients with mismatched caches).
    runPubkeyCacheMigrationV2017();

    // IPC handlers for window controls
    ipcMain.handle('window-minimize', () => {
        mainWindow?.minimize();
    });

    ipcMain.handle('window-maximize', () => {
        if (mainWindow?.isMaximized()) {
            mainWindow.unmaximize();
        } else {
            mainWindow?.maximize();
        }
    });

    ipcMain.handle('window-close', () => {
        mainWindow?.close();
    });

    ipcMain.handle('window-is-maximized', () => {
        return mainWindow?.isMaximized() || false;
    });

    ipcMain.handle('get-app-version', () => {
        return app.getVersion();
    });

    // License IPC handlers
    ipcMain.handle('license-activate', async (event, licenseKey) => {
        return await activateLicense(licenseKey);
    });

    ipcMain.handle('license-validate', async () => {
        return await validateLicense();
    });

    ipcMain.handle('license-deactivate', async () => {
        return await deactivateLicense();
    });

    ipcMain.handle('license-get-info', () => {
        return getCachedLicenseSummary();
    });

    ipcMain.handle('license-get-machine-id', () => {
        return getOrCreateMachineId();
    });

    // Auto-updater IPC handlers
    ipcMain.handle('update:download', async () => {
        if (!autoUpdater) return { error: 'updater unavailable' };
        try {
            await autoUpdater.downloadUpdate();
            return { success: true };
        } catch (e) {
            return { error: e.message || String(e) };
        }
    });
    ipcMain.handle('update:install', () => {
        if (!autoUpdater) return { error: 'updater unavailable' };
        // quitAndInstall ends the current process and runs the new installer
        setImmediate(() => autoUpdater.quitAndInstall(false, true));
        return { success: true };
    });
    ipcMain.handle('update:check', async () => {
        if (!autoUpdater) return { error: 'updater unavailable' };
        try {
            const result = await autoUpdater.checkForUpdates();
            return { success: true, updateInfo: result?.updateInfo || null };
        } catch (e) {
            return { error: e.message || String(e) };
        }
    });

    // Validate license before starting
    const licenseResult = await validateLicense();
    if (licenseResult.valid) startPeriodicRevalidation();

    // Always create window — it will show activation screen or main app
    await startServer();
    if (serverReady) {
        createWindow();
        // Send license status to renderer once loaded
        mainWindow.webContents.on('did-finish-load', () => {
            mainWindow.webContents.send('license-status', licenseResult);
            // Start auto-updater after the renderer is ready to receive events
            setupAutoUpdater();
        });
    }
});

app.on('window-all-closed', () => {
    app.quit();
});

app.on('activate', () => {
    if (mainWindow === null && serverReady) {
        createWindow();
    }
});
