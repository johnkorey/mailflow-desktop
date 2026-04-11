import { appSettingsDb } from '../database/db.mjs';

const LICENSE_KEY_SETTING = 'license_key';
const LICENSE_EXPIRY_SETTING = 'license_expiry';
const LICENSE_TIER_SETTING = 'license_tier';

/**
 * Check current license status.
 * Returns { valid, key, expiresAt, tier }
 */
export function checkLicense() {
    const key = appSettingsDb.get(LICENSE_KEY_SETTING);

    if (!key) {
        return { valid: false, key: null, expiresAt: null, tier: null };
    }

    const expiresAt = appSettingsDb.get(LICENSE_EXPIRY_SETTING);
    const tier = appSettingsDb.get(LICENSE_TIER_SETTING) || 'pro';

    // Check expiry
    if (expiresAt && new Date(expiresAt) < new Date()) {
        return { valid: false, key, expiresAt, tier, reason: 'expired' };
    }

    return { valid: true, key: maskKey(key), expiresAt, tier };
}

/**
 * Activate a license key.
 * TODO: Replace this stub with real server validation when license server details are provided.
 * @param {string} key - The license key to activate
 */
export async function activateLicense(key) {
    if (!key || key.trim().length < 8) {
        return { success: false, error: 'Invalid license key format' };
    }

    // TODO: Validate against remote license server
    // const response = await fetch('https://your-license-server.com/api/validate', {
    //     method: 'POST',
    //     headers: { 'Content-Type': 'application/json' },
    //     body: JSON.stringify({ key: key.trim() })
    // });
    // const result = await response.json();

    // Placeholder: accept any key with 8+ characters
    const result = {
        valid: true,
        expiresAt: '2099-12-31T23:59:59.000Z',
        tier: 'pro'
    };

    if (!result.valid) {
        return { success: false, error: result.error || 'Invalid license key' };
    }

    // Store license data
    appSettingsDb.set(LICENSE_KEY_SETTING, key.trim());
    appSettingsDb.set(LICENSE_EXPIRY_SETTING, result.expiresAt);
    appSettingsDb.set(LICENSE_TIER_SETTING, result.tier || 'pro');

    return {
        success: true,
        expiresAt: result.expiresAt,
        tier: result.tier || 'pro'
    };
}

/**
 * Deactivate the current license.
 */
export function deactivateLicense() {
    appSettingsDb.delete(LICENSE_KEY_SETTING);
    appSettingsDb.delete(LICENSE_EXPIRY_SETTING);
    appSettingsDb.delete(LICENSE_TIER_SETTING);
    return { success: true };
}

/**
 * Mask a license key for display (show first 4 and last 4 chars).
 */
function maskKey(key) {
    if (!key || key.length <= 8) return '****';
    return key.substring(0, 4) + '****' + key.substring(key.length - 4);
}
