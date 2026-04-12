/**
 * Tests for services/encryption.mjs — the SMTP password encryption layer.
 *
 * Scope:
 *   1. GCM roundtrip: encrypt → decrypt yields the original plaintext.
 *   2. Tampering detection: flipping a byte in the ciphertext MUST fail
 *      to decrypt (AEAD auth-tag verification).
 *   3. Legacy CBC compatibility: old "iv:ciphertext" blobs from pre-GCM
 *      builds still decrypt cleanly — no data loss on upgrade.
 *   4. reencryptIfLegacy: returns null for current ciphertexts, returns
 *      a new GCM ciphertext for old ones.
 *   5. Null / empty input is handled safely.
 *
 * Run:   npm test
 */
import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'crypto';

// Pin the encryption key BEFORE importing encryption.mjs, so the module's
// top-level resolveEncryptionKey() sees it and doesn't touch disk.
process.env.ENCRYPTION_KEY = 'a'.repeat(64); // 64-char hex-ish, deterministic

const { encrypt, decrypt, reencryptIfLegacy, generateToken } = await import(
    '../services/encryption.mjs'
);

describe('encryption.mjs — GCM roundtrip', () => {
    it('encrypts and decrypts an ASCII password', () => {
        const plain = 'correct-horse-battery-staple';
        const ct = encrypt(plain);
        expect(ct).toMatch(/^gcm:[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
        expect(decrypt(ct)).toBe(plain);
    });

    it('encrypts and decrypts a Unicode password with emoji', () => {
        const plain = 'pässwörd-🔐-ünïcödé';
        const ct = encrypt(plain);
        expect(decrypt(ct)).toBe(plain);
    });

    it('produces different ciphertext for the same plaintext (IV randomness)', () => {
        const plain = 'same-input';
        const a = encrypt(plain);
        const b = encrypt(plain);
        expect(a).not.toBe(b);
        expect(decrypt(a)).toBe(plain);
        expect(decrypt(b)).toBe(plain);
    });
});

describe('encryption.mjs — tamper detection', () => {
    it('rejects a ciphertext where the body has been flipped', () => {
        const ct = encrypt('something-private');
        const parts = ct.split(':'); // ['gcm', iv, tag, body]
        // Flip the last nibble of the body
        const body = parts[3];
        const flipped = body.slice(0, -1) + (body.slice(-1) === 'f' ? 'e' : 'f');
        const tampered = [parts[0], parts[1], parts[2], flipped].join(':');
        expect(() => decrypt(tampered)).toThrow();
    });

    it('rejects a ciphertext where the auth tag has been flipped', () => {
        const ct = encrypt('something-private');
        const parts = ct.split(':');
        const tag = parts[2];
        const flipped = tag.slice(0, -1) + (tag.slice(-1) === 'f' ? 'e' : 'f');
        const tampered = [parts[0], parts[1], flipped, parts[3]].join(':');
        expect(() => decrypt(tampered)).toThrow();
    });
});

describe('encryption.mjs — legacy CBC fallback', () => {
    // Reproduce what the old encrypt() used to write, using the same
    // padEnd(32).slice(0,32) key-derive trick the old makeKey() used.
    function legacyCbcEncrypt(plain, passphrase) {
        const key = Buffer.from(String(passphrase).padEnd(32).slice(0, 32));
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
        let enc = cipher.update(plain, 'utf8', 'hex');
        enc += cipher.final('hex');
        return iv.toString('hex') + ':' + enc;
    }

    it('decrypts a legacy CBC blob created with the current key', () => {
        const plain = 'old-smtp-password';
        const legacy = legacyCbcEncrypt(plain, process.env.ENCRYPTION_KEY);
        expect(decrypt(legacy)).toBe(plain);
    });

    it('decrypts a legacy CBC blob created with the pre-auto-key dev key', () => {
        const plain = 'very-old-smtp-password';
        const legacy = legacyCbcEncrypt(plain, 'dev-insecure-key-change-me!!!');
        expect(decrypt(legacy)).toBe(plain);
    });
});

describe('encryption.mjs — reencryptIfLegacy', () => {
    it('returns null for a current GCM ciphertext (no migration needed)', () => {
        const ct = encrypt('already-modern');
        expect(reencryptIfLegacy(ct)).toBeNull();
    });

    it('migrates a legacy CBC ciphertext to GCM', () => {
        const plain = 'needs-migration';
        const iv = crypto.randomBytes(16);
        const key = Buffer.from(String(process.env.ENCRYPTION_KEY).padEnd(32).slice(0, 32));
        const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
        let enc = cipher.update(plain, 'utf8', 'hex');
        enc += cipher.final('hex');
        const legacy = iv.toString('hex') + ':' + enc;

        const migrated = reencryptIfLegacy(legacy);
        expect(migrated).toMatch(/^gcm:/);
        expect(decrypt(migrated)).toBe(plain);
    });

    it('returns null for garbage that cannot be decrypted with any key', () => {
        expect(reencryptIfLegacy('not-a-real:ciphertext')).toBeNull();
    });
});

describe('encryption.mjs — edge cases', () => {
    it('returns null for null input to encrypt', () => {
        expect(encrypt(null)).toBeNull();
    });
    it('returns null for undefined input to encrypt', () => {
        expect(encrypt(undefined)).toBeNull();
    });
    it('returns null for empty string to encrypt', () => {
        expect(encrypt('')).toBeNull();
    });
    it('returns null for null input to decrypt', () => {
        expect(decrypt(null)).toBeNull();
    });
    it('generateToken produces 64-char hex for default 32 bytes', () => {
        const t = generateToken();
        expect(t).toMatch(/^[0-9a-f]{64}$/);
    });
});
