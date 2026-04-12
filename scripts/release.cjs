#!/usr/bin/env node
/**
 * MailFlow Desktop — release pipeline.
 *
 * Uploads the three artifacts electron-updater needs (latest.yml, the NSIS
 * installer, and its .blockmap) to the MailFlow license server's admin
 * update endpoint. From that moment, every installed copy of the app picks
 * up the new version on its next 4-hour update check.
 *
 * Usage:
 *   1. Bump "version" in package.json.
 *   2. Run `npm run release` — this triggers a full installer build first,
 *      then uploads the three artifacts.
 *   3. Set UPDATE_ADMIN_TOKEN in your shell or .env before running. If it's
 *      missing, the script aborts with a clear error (never ships the token
 *      inside the desktop app itself).
 *
 * Endpoint contract:
 *   POST https://mailflow.zeabur.app/admin/updates/upload
 *   Header: X-Admin-Token: <secret>
 *   Body (multipart/form-data):
 *     yml=@dist/latest.yml
 *     installer=@dist/MailFlow-Setup-<version>.exe
 *     blockmap=@dist/MailFlow-Setup-<version>.exe.blockmap
 *   Response: { ok: true, version, filesWritten: [...] }
 *
 * The server parses the version out of latest.yml and rejects non-monotonic
 * uploads with a 409 — so if you forget to bump package.json, this will fail
 * loudly instead of silently overwriting the previous release.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const pkg = require('../package.json');
const VERSION = pkg.version;
const UPLOAD_URL = 'https://mailflow.zeabur.app/admin/updates/upload';
const DIST_DIR = path.join(__dirname, '..', 'dist');

const TOKEN = process.env.UPDATE_ADMIN_TOKEN;
if (!TOKEN) {
    console.error('\n[release] ERROR: UPDATE_ADMIN_TOKEN not set in environment.');
    console.error('[release] Set it in your shell before running:');
    console.error('[release]   export UPDATE_ADMIN_TOKEN=<token-from-license-server>');
    console.error('[release] (Never commit this token or bake it into the desktop app.)\n');
    process.exit(1);
}

const files = {
    yml: path.join(DIST_DIR, 'latest.yml'),
    installer: path.join(DIST_DIR, `MailFlow-Setup-${VERSION}.exe`),
    blockmap: path.join(DIST_DIR, `MailFlow-Setup-${VERSION}.exe.blockmap`)
};

console.log(`\n[release] MailFlow Desktop v${VERSION}`);
for (const [key, p] of Object.entries(files)) {
    if (!fs.existsSync(p)) {
        console.error(`[release] ERROR: missing artifact ${key}: ${p}`);
        console.error('[release] Did you run `npm run build:installer` first?');
        process.exit(1);
    }
    const sizeMb = (fs.statSync(p).size / 1024 / 1024).toFixed(2);
    console.log(`[release]   ${key.padEnd(9)} ${sizeMb.padStart(8)} MB  ${path.basename(p)}`);
}

// -------------------- multipart builder --------------------
// Keep this dependency-free so `npm run release` works on any clean checkout.
// FormData support in Node 18+ would avoid this, but the electron-builder
// native image packaging doesn't include it in the release environment.
function buildMultipart(fields) {
    const boundary = '----MailFlowRelease' + crypto.randomBytes(16).toString('hex');
    const chunks = [];
    for (const { name, filename, contentType, body } of fields) {
        chunks.push(Buffer.from(`--${boundary}\r\n`));
        chunks.push(Buffer.from(`Content-Disposition: form-data; name="${name}"; filename="${filename}"\r\n`));
        chunks.push(Buffer.from(`Content-Type: ${contentType}\r\n\r\n`));
        chunks.push(body);
        chunks.push(Buffer.from('\r\n'));
    }
    chunks.push(Buffer.from(`--${boundary}--\r\n`));
    return { boundary, body: Buffer.concat(chunks) };
}

const fields = [
    {
        name: 'yml',
        filename: 'latest.yml',
        contentType: 'application/x-yaml',
        body: fs.readFileSync(files.yml)
    },
    {
        name: 'installer',
        filename: `MailFlow-Setup-${VERSION}.exe`,
        contentType: 'application/octet-stream',
        body: fs.readFileSync(files.installer)
    },
    {
        name: 'blockmap',
        filename: `MailFlow-Setup-${VERSION}.exe.blockmap`,
        contentType: 'application/octet-stream',
        body: fs.readFileSync(files.blockmap)
    }
];

const { boundary, body } = buildMultipart(fields);
const url = new URL(UPLOAD_URL);

console.log(`\n[release] Uploading to ${url.host}${url.pathname} ...`);
console.log(`[release]   total payload: ${(body.length / 1024 / 1024).toFixed(2)} MB`);

const started = Date.now();
const req = https.request(
    {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
            'X-Admin-Token': TOKEN,
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': body.length
        },
        timeout: 10 * 60 * 1000 // 10 min — big installer over slow links
    },
    (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
            const elapsed = ((Date.now() - started) / 1000).toFixed(1);
            if (res.statusCode === 200 || res.statusCode === 201) {
                let parsed = null;
                try { parsed = JSON.parse(buf); } catch {}
                console.log(`\n[release] ✓ Upload OK in ${elapsed}s`);
                if (parsed) {
                    console.log(`[release]   version:      ${parsed.version || VERSION}`);
                    if (parsed.filesWritten) {
                        console.log(`[release]   filesWritten: ${parsed.filesWritten.join(', ')}`);
                    }
                }
                console.log('\n[release] Every installed copy of MailFlow will pick up this update on its next check (at most 4 hours).');
                process.exit(0);
            } else {
                console.error(`\n[release] ✗ Upload failed with HTTP ${res.statusCode} in ${elapsed}s`);
                console.error('[release] Server response:', buf);
                if (res.statusCode === 401) {
                    console.error('[release] HINT: UPDATE_ADMIN_TOKEN is wrong or the server env var was rotated.');
                } else if (res.statusCode === 409) {
                    console.error('[release] HINT: version in package.json must be strictly greater than the last published release.');
                }
                process.exit(1);
            }
        });
    }
);

req.on('error', (err) => {
    console.error('\n[release] ✗ Network error:', err.message);
    process.exit(1);
});
req.on('timeout', () => {
    req.destroy();
    console.error('\n[release] ✗ Upload timed out after 10 minutes');
    process.exit(1);
});

// Lightweight progress reporting while the request socket drains
let lastLogged = 0;
req.on('socket', (socket) => {
    socket.on('drain', () => {
        const sent = body.length - (socket.writableLength || 0);
        const now = Date.now();
        if (now - lastLogged > 1000) {
            const pct = Math.round((sent / body.length) * 100);
            process.stdout.write(`[release]   uploading ${pct}%\r`);
            lastLogged = now;
        }
    });
});

req.write(body);
req.end();
