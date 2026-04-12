import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Encryption at rest for SMTP passwords and API keys.
 *
 * Format (current): "gcm:<iv-hex>:<tag-hex>:<ciphertext-hex>"
 *   - AES-256-GCM with a random 12-byte IV and 16-byte auth tag.
 *   - Tampering with the ciphertext is detected at decrypt time.
 *
 * Backward compatibility:
 *   - Legacy "iv-hex:ciphertext-hex" format (AES-256-CBC, unauthenticated)
 *     still decrypts via the CBC fallback. Old records from pre-GCM
 *     builds keep working — the first successful decrypt can be
 *     re-encrypted with reencryptIfLegacy() to migrate them in place.
 *   - The hardcoded legacy dev key used by the original pre-auto-key
 *     builds is also accepted during CBC decrypt, so SMTP passwords
 *     saved in the very first releases still survive an upgrade.
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
// Legacy key used by the very first MailFlow builds before auto-key
// generation was added. Kept so an upgrade from pre-auto-key builds can
// still decrypt saved SMTP passwords. Only used in the CBC fallback path.
const LEGACY_DEV_KEY = 'dev-insecure-key-change-me!!!';

const GCM_ALGORITHM = 'aes-256-gcm';
const CBC_ALGORITHM = 'aes-256-cbc';
const GCM_IV_BYTES = 12;      // NIST SP 800-38D recommendation
const CBC_IV_BYTES = 16;

/** Derive a 32-byte key from a passphrase via SHA-256. */
function deriveKey(passphrase) {
    return crypto.createHash('sha256').update(String(passphrase)).digest();
}

/**
 * Encrypt a string with AES-256-GCM.
 * Output: "gcm:<iv-hex>:<tag-hex>:<ciphertext-hex>"
 */
export function encrypt(text) {
    if (text === null || text === undefined) return null;
    const plaintext = String(text);
    if (plaintext === '') return null;

    const key = deriveKey(ENCRYPTION_KEY);
    const iv = crypto.randomBytes(GCM_IV_BYTES);
    const cipher = crypto.createCipheriv(GCM_ALGORITHM, key, iv);
    const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `gcm:${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

/** Try GCM decrypt. Throws on auth failure. */
function decryptGcm(encryptedText) {
    const parts = encryptedText.split(':');
    if (parts.length !== 4 || parts[0] !== 'gcm') {
        throw new Error('Not a GCM ciphertext');
    }
    const iv = Buffer.from(parts[1], 'hex');
    const tag = Buffer.from(parts[2], 'hex');
    const ct = Buffer.from(parts[3], 'hex');
    const key = deriveKey(ENCRYPTION_KEY);
    const decipher = crypto.createDecipheriv(GCM_ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(ct), decipher.final()]);
    return dec.toString('utf8');
}

/**
 * Legacy CBC decrypt. Format is "iv-hex:ciphertext-hex". The CBC key derive
 * matches the original makeKey() — ASCII-pad the passphrase to 32 bytes,
 * which is what older builds wrote to disk with.
 */
function makeCbcKeyLegacy(str) {
    return Buffer.from(String(str).padEnd(32).slice(0, 32));
}
function decryptCbc(encryptedText, passphrase) {
    const parts = encryptedText.split(':');
    if (parts.length !== 2) throw new Error('Not a CBC ciphertext');
    const iv = Buffer.from(parts[0], 'hex');
    if (iv.length !== CBC_IV_BYTES) throw new Error('CBC IV length wrong');
    const key = makeCbcKeyLegacy(passphrase);
    const decipher = crypto.createDecipheriv(CBC_ALGORITHM, key, iv);
    let decrypted = decipher.update(parts[1], 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

/**
 * Decrypt a string. Tries GCM first (modern format), falls back to legacy
 * CBC with the current key, then legacy CBC with the pre-auto-key dev key.
 * All failures result in the original GCM error being thrown, so callers
 * see a single, stable error shape.
 */
export function decrypt(encryptedText) {
    if (!encryptedText) return null;

    // Modern path: GCM
    if (typeof encryptedText === 'string' && encryptedText.startsWith('gcm:')) {
        return decryptGcm(encryptedText);
    }

    // Legacy path: CBC with current key, then CBC with the pre-auto-key dev key.
    let firstErr = null;
    try {
        return decryptCbc(encryptedText, ENCRYPTION_KEY);
    } catch (e) {
        firstErr = e;
    }
    try {
        return decryptCbc(encryptedText, LEGACY_DEV_KEY);
    } catch {
        throw firstErr;
    }
}

/**
 * Re-encrypt a value if it was written by a pre-GCM build (or with the
 * legacy dev key). Returns the new GCM ciphertext, or null if the value
 * is already current and no re-encryption is needed.
 */
export function reencryptIfLegacy(encryptedText) {
    if (!encryptedText) return null;
    if (typeof encryptedText === 'string' && encryptedText.startsWith('gcm:')) {
        return null; // already current
    }
    try {
        const plain = decrypt(encryptedText);
        if (plain == null) return null;
        return encrypt(plain);
    } catch {
        return null; // unreadable with any key — leave alone
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
    return crypto.createHash('md5').update(crypto.randomBytes(16)).digest('hex');
}
