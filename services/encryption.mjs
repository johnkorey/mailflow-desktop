import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Resolve the encryption key:
 *   1. Use ENCRYPTION_KEY env var if set (production/custom deployments)
 *   2. Otherwise, read from persisted key file in the user data dir
 *   3. Otherwise, generate a new random key, persist it, and use it
 *
 * This eliminates the "insecure dev key" fallback — every install gets a
 * unique 64-char hex key that survives restarts.
 */
function resolveEncryptionKey() {
    if (process.env.ENCRYPTION_KEY) {
        return process.env.ENCRYPTION_KEY;
    }

    // Electron packaged app sets MAILFLOW_USER_DATA; fall back to ~/.mailflow-desktop
    const dataDir = process.env.MAILFLOW_USER_DATA
        || path.join(os.homedir(), '.mailflow-desktop');
    const keyPath = path.join(dataDir, 'encryption.key');

    try {
        if (fs.existsSync(keyPath)) {
            const saved = fs.readFileSync(keyPath, 'utf8').trim();
            if (saved.length >= 32) return saved;
        }
    } catch (e) {
        console.error('[Encryption] Failed to read persisted key:', e.message);
    }

    // Generate a new key and persist it
    try {
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        const newKey = crypto.randomBytes(32).toString('hex'); // 64-char hex
        fs.writeFileSync(keyPath, newKey, { mode: 0o600 });
        console.log('[Encryption] Generated new encryption key at', keyPath);
        return newKey;
    } catch (e) {
        console.error('[Encryption] Failed to persist new key:', e.message);
        // Last-resort in-memory key — will not survive restart but avoids crash
        return crypto.randomBytes(32).toString('hex');
    }
}

const ENCRYPTION_KEY = resolveEncryptionKey();
// Legacy key used by old builds before auto-generation was added.
// Kept here so existing encrypted SMTP passwords can still be decrypted after
// upgrading. The migration in db.mjs re-encrypts them with the new key.
const LEGACY_DEV_KEY = 'dev-insecure-key-change-me!!!';
const IV_LENGTH = 16;
const ALGORITHM = 'aes-256-cbc';

function makeKey(str) {
    return Buffer.from(str.padEnd(32).slice(0, 32));
}

/**
 * Encrypt a string
 * @param {string} text - Text to encrypt
 * @returns {string} - Encrypted text (iv:encrypted format)
 */
export function encrypt(text) {
    if (!text) return null;

    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, makeKey(ENCRYPTION_KEY), iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    return iv.toString('hex') + ':' + encrypted;
}

function tryDecrypt(encryptedText, keyString) {
    const parts = encryptedText.split(':');
    if (parts.length !== 2) {
        throw new Error('Invalid encrypted text format');
    }
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    const decipher = crypto.createDecipheriv(ALGORITHM, makeKey(keyString), iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

/**
 * Decrypt a string. Transparently falls back to the legacy dev key so
 * existing SMTP passwords from pre-auto-key builds continue to work.
 */
export function decrypt(encryptedText) {
    if (!encryptedText) return null;

    try {
        return tryDecrypt(encryptedText, ENCRYPTION_KEY);
    } catch (primaryErr) {
        // Fall back to the legacy dev key for backward compatibility
        try {
            return tryDecrypt(encryptedText, LEGACY_DEV_KEY);
        } catch {
            throw primaryErr;
        }
    }
}

/**
 * Re-encrypt a value if it was encrypted with the legacy dev key.
 * Returns the new ciphertext, or null if the value was already encrypted
 * with the current key (no re-encryption needed).
 */
export function reencryptIfLegacy(encryptedText) {
    if (!encryptedText) return null;
    try {
        tryDecrypt(encryptedText, ENCRYPTION_KEY);
        return null; // already current
    } catch {
        try {
            const plain = tryDecrypt(encryptedText, LEGACY_DEV_KEY);
            return encrypt(plain);
        } catch {
            return null; // can't decrypt with either key — leave alone
        }
    }
}

/**
 * Generate a random token
 * @param {number} length - Token length in bytes
 * @returns {string} - Random hex token
 */
export function generateToken(length = 32) {
    return crypto.randomBytes(length).toString('hex');
}

/**
 * Generate a random MD5 hash
 * @returns {string} - Random MD5 hash
 */
export function generateRandomMD5() {
    return crypto.createHash('md5').update(Math.random().toString()).digest('hex');
}

