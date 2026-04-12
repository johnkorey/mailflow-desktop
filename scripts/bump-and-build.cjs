#!/usr/bin/env node
/**
 * MailFlow Desktop — one-shot release builder.
 *
 * Bumps the version in package.json and rebuilds the NSIS installer in a
 * single command. After it finishes, the three artifacts in dist/ are
 * ready to drag into a new GitHub release; the license server mirror
 * picks them up within 5 minutes and every installed customer auto-
 * updates on their next 4-hour check.
 *
 * Usage:
 *   npm run release:patch   →  2.0.3 → 2.0.4
 *   npm run release:minor   →  2.0.4 → 2.1.0
 *   npm run release:major   →  2.1.0 → 3.0.0
 *   npm run release -- 2.5.1  →  explicit version
 *
 * Does NOT commit, tag, or push — that's on you so version bumps don't
 * auto-hit main if the build fails.
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PKG_PATH = path.join(ROOT, 'package.json');
const DIST = path.join(ROOT, 'dist');

// ----- args: level (patch|minor|major) OR explicit version string -----
const arg = process.argv[2] || 'patch';
const levels = { patch: 2, minor: 1, major: 0 };

function bumpSemver(current, level) {
    const parts = current.split('.').map(Number);
    if (parts.length !== 3 || parts.some(isNaN)) {
        throw new Error(`current version '${current}' is not plain semver`);
    }
    const idx = levels[level];
    if (idx === undefined) {
        // Treat as explicit version string
        if (!/^\d+\.\d+\.\d+$/.test(level)) {
            throw new Error(`invalid version: '${level}' — use patch | minor | major | X.Y.Z`);
        }
        return level;
    }
    parts[idx]++;
    for (let i = idx + 1; i < 3; i++) parts[i] = 0;
    return parts.join('.');
}

// ----- read and bump package.json -----
const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf-8'));
const oldVersion = pkg.version;
const newVersion = bumpSemver(oldVersion, arg);

if (newVersion === oldVersion) {
    console.error(`\n[release] ERROR: new version equals old (${oldVersion}) — already at target`);
    process.exit(1);
}

pkg.version = newVersion;
fs.writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + '\n');

console.log(`\n[release] MailFlow Desktop ${oldVersion}  →  ${newVersion}`);
console.log('[release] package.json updated\n');

// ----- run the existing installer build -----
console.log('[release] Running build:installer ...\n');
const result = spawnSync('npm', ['run', 'build:installer'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true
});

if (result.status !== 0) {
    console.error(`\n[release] ✗ build:installer failed with exit code ${result.status}`);
    console.error('[release] Rolling back package.json to previous version');
    pkg.version = oldVersion;
    fs.writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + '\n');
    process.exit(result.status || 1);
}

// ----- verify artifacts exist -----
const expected = [
    path.join(DIST, 'latest.yml'),
    path.join(DIST, `MailFlow-Setup-${newVersion}.exe`),
    path.join(DIST, `MailFlow-Setup-${newVersion}.exe.blockmap`)
];
const missing = expected.filter(p => !fs.existsSync(p));
if (missing.length) {
    console.error('\n[release] ✗ Missing artifacts after build:');
    for (const p of missing) console.error('   ' + p);
    process.exit(1);
}

// ----- success summary -----
const installerSizeMb = (fs.statSync(expected[1]).size / 1024 / 1024).toFixed(1);
console.log(`\n[release] ✓ Built v${newVersion} (${installerSizeMb} MB)\n`);
console.log('[release] Drag these three files into a new GitHub release:');
console.log(`[release]   ${path.basename(expected[1])}`);
console.log(`[release]   ${path.basename(expected[2])}`);
console.log(`[release]   ${path.basename(expected[0])}`);
console.log(`\n[release] → https://github.com/johnkorey/mailflow-desktop/releases/new`);
console.log(`[release] → tag:  v${newVersion}`);
console.log(`[release] → title: MailFlow ${newVersion}`);
console.log(`[release] → IMPORTANT: check "Set as the latest release" before publishing\n`);
console.log('[release] After publishing, the license server mirror picks it up within 5 minutes,');
console.log('[release] and every installed copy auto-updates on its next 4-hour check.\n');

// ----- optionally open the dist folder for drag-drop -----
try {
    if (process.platform === 'win32') {
        execSync(`explorer "${DIST}"`, { stdio: 'ignore' });
    } else if (process.platform === 'darwin') {
        execSync(`open "${DIST}"`, { stdio: 'ignore' });
    }
} catch { /* non-fatal */ }
