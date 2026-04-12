import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { reencryptIfLegacy } from '../services/encryption.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Database file path - use MAILFLOW_USER_DATA for packaged Electron app
const DB_DIR = process.env.MAILFLOW_USER_DATA || __dirname;
const DB_PATH = path.join(DB_DIR, 'emailsaas.db');

// Create database connection
const db = new Database(DB_PATH);

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Initialize database with schema
export function initializeDatabase() {
    const schemaPath = process.env.MAILFLOW_SCHEMA_PATH || path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');

    const statements = schema.split(';').filter(s => s.trim());

    for (const statement of statements) {
        if (statement.trim()) {
            try {
                db.exec(statement + ';');
            } catch (error) {
                if (!error.message.includes('already exists')) {
                    console.error('Database error:', error.message);
                }
            }
        }
    }

    // Run migrations for existing databases
    runMigrations();

    // Ensure local user exists
    ensureLocalUser();

    console.log('Database initialized successfully');
}

// Run database migrations for schema changes
function runMigrations() {
    // Fix any users with NULL is_active
    try {
        db.prepare('UPDATE users SET is_active = 1 WHERE is_active IS NULL').run();
    } catch (error) {
        // Table might not exist yet
    }

    // Add deliverability-test columns to users if missing
    try {
        const userCols = db.prepare("PRAGMA table_info(users)").all();
        if (!userCols.some(col => col.name === 'test_email')) {
            db.exec("ALTER TABLE users ADD COLUMN test_email TEXT");
            console.log('Added test_email column to users');
        }
        if (!userCols.some(col => col.name === 'test_interval')) {
            db.exec("ALTER TABLE users ADD COLUMN test_interval INTEGER DEFAULT 50");
            console.log('Added test_interval column to users');
        }
        if (!userCols.some(col => col.name === 'test_enabled')) {
            db.exec("ALTER TABLE users ADD COLUMN test_enabled INTEGER DEFAULT 0");
            console.log('Added test_enabled column to users');
        }
    } catch (error) {
        // Columns already exist
    }

    // Create app_settings table if it doesn't exist (for upgrades from old schema)
    try {
        db.exec(`
            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
    } catch (error) {
        // Already exists
    }

    // Add recipients column to inbox_finder_tests if missing
    try {
        const testColumns = db.prepare("PRAGMA table_info(inbox_finder_tests)").all();
        if (!testColumns.some(col => col.name === 'recipients')) {
            db.exec('ALTER TABLE inbox_finder_tests ADD COLUMN recipients TEXT');
        }
    } catch (error) {
        // Table might not exist yet
    }

    // Add sender_email/recipient_email to inbox_finder_results if missing
    try {
        const resultColumns = db.prepare("PRAGMA table_info(inbox_finder_results)").all();
        if (!resultColumns.some(col => col.name === 'sender_email')) {
            db.exec('ALTER TABLE inbox_finder_results ADD COLUMN sender_email TEXT');
            db.exec('UPDATE inbox_finder_results SET sender_email = email WHERE sender_email IS NULL');
        }
        if (!resultColumns.some(col => col.name === 'recipient_email')) {
            db.exec('ALTER TABLE inbox_finder_results ADD COLUMN recipient_email TEXT');
            db.exec('UPDATE inbox_finder_results SET recipient_email = email WHERE recipient_email IS NULL');
        }
    } catch (error) {
        // Table might not exist yet
    }

    // Add file attachment columns to attachments table if missing
    try {
        const attColumns = db.prepare("PRAGMA table_info(attachments)").all();
        if (!attColumns.some(col => col.name === 'file_name')) {
            db.exec('ALTER TABLE attachments ADD COLUMN file_name TEXT');
        }
        if (!attColumns.some(col => col.name === 'file_content')) {
            db.exec('ALTER TABLE attachments ADD COLUMN file_content BLOB');
        }
        if (!attColumns.some(col => col.name === 'file_type')) {
            db.exec('ALTER TABLE attachments ADD COLUMN file_type TEXT');
        }
        if (!attColumns.some(col => col.name === 'file_size')) {
            db.exec('ALTER TABLE attachments ADD COLUMN file_size INTEGER DEFAULT 0');
        }
    } catch (error) {
        // Table might not exist yet
    }

    // Remove CHECK constraint on campaigns.attachment_format (recreate table without it)
    try {
        const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='campaigns'").get();
        if (tableInfo && tableInfo.sql && tableInfo.sql.includes('CHECK (attachment_format')) {
            // Recreate campaigns table without the CHECK constraint
            db.exec(`
                CREATE TABLE IF NOT EXISTS campaigns_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    name TEXT NOT NULL,
                    subject TEXT NOT NULL,
                    subjects_list TEXT,
                    sender_names_list TEXT,
                    cta_links_list TEXT,
                    smtp_ids_list TEXT,
                    rotate_subjects INTEGER DEFAULT 0,
                    rotate_senders INTEGER DEFAULT 0,
                    rotate_cta INTEGER DEFAULT 0,
                    rotate_smtp INTEGER DEFAULT 0,
                    body_html TEXT,
                    body_text TEXT,
                    reply_to TEXT,
                    attachment_name TEXT,
                    attachment_path TEXT,
                    attachment_content TEXT,
                    attachment_id INTEGER,
                    attachment_format TEXT DEFAULT 'html',
                    status TEXT DEFAULT 'draft',
                    total_recipients INTEGER DEFAULT 0,
                    sent_count INTEGER DEFAULT 0,
                    failed_count INTEGER DEFAULT 0,
                    smtp_config_id INTEGER,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    completed_at DATETIME,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                    FOREIGN KEY (smtp_config_id) REFERENCES smtp_configs(id) ON DELETE SET NULL
                );
                INSERT INTO campaigns_new SELECT * FROM campaigns;
                DROP TABLE campaigns;
                ALTER TABLE campaigns_new RENAME TO campaigns;
                CREATE INDEX IF NOT EXISTS idx_campaigns_user_id ON campaigns(user_id);
                CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);
            `);
            console.log('Migrated campaigns table: removed attachment_format CHECK constraint');
        }
    } catch (error) {
        // Table might not exist yet or migration already done
    }

    // Add smtp_rotation_type column to campaigns
    try {
        db.exec("ALTER TABLE campaigns ADD COLUMN smtp_rotation_type TEXT DEFAULT 'round_robin'");
        console.log('Added smtp_rotation_type column to campaigns');
    } catch (error) {
        // Column already exists
    }

    // Add attachment_custom_name column to campaigns
    try {
        db.exec("ALTER TABLE campaigns ADD COLUMN attachment_custom_name TEXT");
        console.log('Added attachment_custom_name column to campaigns');
    } catch (error) {
        // Column already exists
    }

    // Add auth_type column to smtp_configs and make username/password nullable
    try {
        const smtpCols = db.prepare("PRAGMA table_info(smtp_configs)").all();
        if (!smtpCols.some(col => col.name === 'auth_type')) {
            db.exec("ALTER TABLE smtp_configs ADD COLUMN auth_type TEXT DEFAULT 'login'");
            console.log('Added auth_type column to smtp_configs');
        }
    } catch (error) {
        // Column already exists
    }

    // Add API provider columns to smtp_configs
    try {
        const smtpCols = db.prepare("PRAGMA table_info(smtp_configs)").all();
        if (!smtpCols.some(col => col.name === 'provider')) {
            db.exec("ALTER TABLE smtp_configs ADD COLUMN provider TEXT DEFAULT 'smtp'");
            console.log('Added provider column to smtp_configs');
        }
        if (!smtpCols.some(col => col.name === 'api_key_encrypted')) {
            db.exec("ALTER TABLE smtp_configs ADD COLUMN api_key_encrypted TEXT");
            console.log('Added api_key_encrypted column to smtp_configs');
        }
        if (!smtpCols.some(col => col.name === 'api_domain')) {
            db.exec("ALTER TABLE smtp_configs ADD COLUMN api_domain TEXT");
            console.log('Added api_domain column to smtp_configs');
        }
        if (!smtpCols.some(col => col.name === 'api_region')) {
            db.exec("ALTER TABLE smtp_configs ADD COLUMN api_region TEXT");
            console.log('Added api_region column to smtp_configs');
        }
    } catch (error) {
        // Columns already exist
    }

    // Add scheduled_at column to campaigns (for "send later")
    try {
        const campCols = db.prepare("PRAGMA table_info(campaigns)").all();
        if (!campCols.some(col => col.name === 'scheduled_at')) {
            db.exec("ALTER TABLE campaigns ADD COLUMN scheduled_at DATETIME");
            console.log('Added scheduled_at column to campaigns');
        }
    } catch (error) {
        // Column already exists
    }

    // Create unsubscribes table for CAN-SPAM/GDPR compliance
    try {
        db.exec(`
            CREATE TABLE IF NOT EXISTS unsubscribes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                email TEXT NOT NULL,
                campaign_id INTEGER,
                source TEXT DEFAULT 'link',
                ip TEXT,
                unsubscribed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                UNIQUE(user_id, email)
            )
        `);
        db.exec('CREATE INDEX IF NOT EXISTS idx_unsubscribes_user_email ON unsubscribes(user_id, email)');
    } catch (error) {
        // Already exists
    }

    // Re-encrypt SMTP credentials that were stored under the legacy dev key.
    // This runs once after ENCRYPTION_KEY auto-generation; on subsequent
    // launches it's a no-op because everything is already current.
    try {
        const configs = db.prepare('SELECT id, password_encrypted, api_key_encrypted FROM smtp_configs').all();
        let migrated = 0;
        const updatePw = db.prepare('UPDATE smtp_configs SET password_encrypted = ? WHERE id = ?');
        const updateKey = db.prepare('UPDATE smtp_configs SET api_key_encrypted = ? WHERE id = ?');
        for (const c of configs) {
            if (c.password_encrypted) {
                const migrated_pw = reencryptIfLegacy(c.password_encrypted);
                if (migrated_pw) { updatePw.run(migrated_pw, c.id); migrated++; }
            }
            if (c.api_key_encrypted) {
                const migrated_key = reencryptIfLegacy(c.api_key_encrypted);
                if (migrated_key) { updateKey.run(migrated_key, c.id); migrated++; }
            }
        }
        if (migrated > 0) {
            console.log(`[Encryption migration] Re-encrypted ${migrated} credential field(s) with new key`);
        }
    } catch (e) {
        console.error('[Encryption migration] Failed:', e.message);
    }
}

// Ensure the single local user exists (auto-created on first launch)
function ensureLocalUser() {
    const existing = db.prepare('SELECT * FROM users WHERE id = 1').get();
    if (!existing) {
        db.prepare(`
            INSERT INTO users (email, name, is_active)
            VALUES ('user@mailflow.local', 'MailFlow User', 1)
        `).run();
        console.log('Local user created');
    }
}

// ========================================
// App Settings (key-value store)
// ========================================

export const appSettingsDb = {
    get: (key) => {
        const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
        return row ? row.value : null;
    },

    set: (key, value) => {
        return db.prepare(`
            INSERT INTO app_settings (key, value, updated_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = CURRENT_TIMESTAMP
        `).run(key, value, value);
    },

    delete: (key) => {
        return db.prepare('DELETE FROM app_settings WHERE key = ?').run(key);
    },

    getAll: () => {
        return db.prepare('SELECT * FROM app_settings').all();
    }
};

// ========================================
// User operations
// ========================================

export const userDb = {
    findByEmail: (email) => {
        return db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    },

    findById: (id) => {
        return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    },

    getLocalUser: () => {
        return db.prepare('SELECT * FROM users WHERE id = 1').get();
    },

    update: (id, userData) => {
        const fields = [];
        const values = { id };

        for (const [key, value] of Object.entries(userData)) {
            if (value !== undefined && key !== 'id') {
                fields.push(`${key} = @${key}`);
                values[key] = value;
            }
        }

        if (fields.length === 0) return null;

        fields.push('updated_at = CURRENT_TIMESTAMP');

        const stmt = db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = @id`);
        return stmt.run(values);
    },

    // Deliverability test settings
    getTestSettings: (id) => {
        try {
            const user = db.prepare('SELECT test_email, test_interval, test_enabled FROM users WHERE id = ?').get(id);
            return {
                test_email: user?.test_email || null,
                test_interval: user?.test_interval || 50,
                test_enabled: user?.test_enabled === 1
            };
        } catch {
            return { test_email: null, test_interval: 50, test_enabled: false };
        }
    },

    updateTestSettings: (id, settings) => {
        return db.prepare(`
            UPDATE users
            SET test_email = ?, test_interval = ?, test_enabled = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(
            settings.test_email || null,
            settings.test_interval || 50,
            settings.test_enabled ? 1 : 0,
            id
        );
    }
};

// ========================================
// SMTP Config operations
// ========================================

export const smtpDb = {
    findById: (id) => {
        return db.prepare('SELECT * FROM smtp_configs WHERE id = ?').get(id);
    },

    findByUserId: (userId) => {
        return db.prepare('SELECT * FROM smtp_configs WHERE user_id = ? ORDER BY created_at DESC').all(userId);
    },

    findActiveByUserId: (userId) => {
        return db.prepare('SELECT * FROM smtp_configs WHERE user_id = ? AND is_active = 1').get(userId);
    },

    create: (configData) => {
        const stmt = db.prepare(`
            INSERT INTO smtp_configs (user_id, name, provider, host, port, secure, auth_type, username, password_encrypted, api_key_encrypted, api_domain, api_region, from_email, from_name)
            VALUES (@user_id, @name, @provider, @host, @port, @secure, @auth_type, @username, @password_encrypted, @api_key_encrypted, @api_domain, @api_region, @from_email, @from_name)
        `);
        const result = stmt.run({
            user_id: configData.user_id,
            name: configData.name || 'Default',
            provider: configData.provider || 'smtp',
            host: configData.host || null,
            port: configData.port || 587,
            secure: configData.secure ? 1 : 0,
            auth_type: configData.auth_type || 'login',
            username: configData.username || null,
            password_encrypted: configData.password_encrypted || null,
            api_key_encrypted: configData.api_key_encrypted || null,
            api_domain: configData.api_domain || null,
            api_region: configData.api_region || null,
            from_email: configData.from_email || null,
            from_name: configData.from_name || null
        });
        return { id: result.lastInsertRowid, ...configData };
    },

    update: (id, configData) => {
        const fields = [];
        const values = { id };

        for (const [key, value] of Object.entries(configData)) {
            if (value !== undefined && key !== 'id') {
                fields.push(`${key} = @${key}`);
                values[key] = key === 'secure' ? (value ? 1 : 0) : value;
            }
        }

        if (fields.length === 0) return null;

        fields.push('updated_at = CURRENT_TIMESTAMP');

        const stmt = db.prepare(`UPDATE smtp_configs SET ${fields.join(', ')} WHERE id = @id`);
        return stmt.run(values);
    },

    delete: (id) => {
        return db.prepare('DELETE FROM smtp_configs WHERE id = ?').run(id);
    },

    setActive: (id, userId) => {
        db.prepare('UPDATE smtp_configs SET is_active = 0 WHERE user_id = ?').run(userId);
        return db.prepare('UPDATE smtp_configs SET is_active = 1 WHERE id = ? AND user_id = ?').run(id, userId);
    }
};

// ========================================
// Campaign operations
// ========================================

export const campaignDb = {
    findById: (id) => {
        return db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id);
    },

    findByUserId: (userId, limit = 50, offset = 0) => {
        return db.prepare(`
            SELECT * FROM campaigns
            WHERE user_id = ?
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
        `).all(userId, limit, offset);
    },

    /**
     * Find campaigns that are scheduled to send NOW or earlier.
     * A campaign is "scheduled" when scheduled_at is set, status is 'draft',
     * and total_recipients > 0.
     */
    findScheduledDue: () => {
        return db.prepare(`
            SELECT * FROM campaigns
            WHERE scheduled_at IS NOT NULL
              AND status = 'draft'
              AND total_recipients > 0
              AND datetime(scheduled_at) <= datetime('now')
        `).all();
    },

    create: (campaignData) => {
        const stmt = db.prepare(`
            INSERT INTO campaigns (
                user_id, name, subject, body_html, body_text, reply_to,
                attachment_name, attachment_content, attachment_id, attachment_format, attachment_custom_name, smtp_config_id,
                subjects_list, sender_names_list, cta_links_list, smtp_ids_list,
                rotate_subjects, rotate_senders, rotate_cta, rotate_smtp, smtp_rotation_type
            )
            VALUES (
                @user_id, @name, @subject, @body_html, @body_text, @reply_to,
                @attachment_name, @attachment_content, @attachment_id, @attachment_format, @attachment_custom_name, @smtp_config_id,
                @subjects_list, @sender_names_list, @cta_links_list, @smtp_ids_list,
                @rotate_subjects, @rotate_senders, @rotate_cta, @rotate_smtp, @smtp_rotation_type
            )
        `);
        const result = stmt.run({
            user_id: campaignData.user_id,
            name: campaignData.name,
            subject: campaignData.subject,
            body_html: campaignData.body_html || null,
            body_text: campaignData.body_text || null,
            reply_to: campaignData.reply_to || null,
            attachment_name: campaignData.attachment_name || null,
            attachment_content: campaignData.attachment_content || null,
            attachment_id: campaignData.attachment_id || null,
            attachment_format: campaignData.attachment_format || 'html',
            attachment_custom_name: campaignData.attachment_custom_name || null,
            smtp_config_id: campaignData.smtp_config_id || null,
            subjects_list: campaignData.subjects_list || null,
            sender_names_list: campaignData.sender_names_list || null,
            cta_links_list: campaignData.cta_links_list || null,
            smtp_ids_list: campaignData.smtp_ids_list || null,
            rotate_subjects: campaignData.rotate_subjects ? 1 : 0,
            rotate_senders: campaignData.rotate_senders ? 1 : 0,
            rotate_cta: campaignData.rotate_cta ? 1 : 0,
            rotate_smtp: campaignData.rotate_smtp ? 1 : 0,
            smtp_rotation_type: campaignData.smtp_rotation_type || 'round_robin'
        });
        return { id: result.lastInsertRowid, ...campaignData };
    },

    update: (id, campaignData) => {
        const fields = [];
        const values = { id };

        for (const [key, value] of Object.entries(campaignData)) {
            if (value !== undefined && key !== 'id') {
                fields.push(`${key} = @${key}`);
                values[key] = value;
            }
        }

        if (fields.length === 0) return null;

        fields.push('updated_at = CURRENT_TIMESTAMP');

        const stmt = db.prepare(`UPDATE campaigns SET ${fields.join(', ')} WHERE id = @id`);
        return stmt.run(values);
    },

    /**
     * Clone a campaign — copies all content/rotation/attachment settings to a
     * new draft with name "<original> (copy)". Recipients and send counters
     * are NOT copied (user starts fresh).
     */
    clone: (id, userId) => {
        const original = db.prepare('SELECT * FROM campaigns WHERE id = ? AND user_id = ?').get(id, userId);
        if (!original) return null;

        return campaignDb.create({
            user_id: userId,
            name: `${original.name} (copy)`,
            subject: original.subject,
            body_html: original.body_html,
            body_text: original.body_text,
            reply_to: original.reply_to,
            attachment_name: original.attachment_name,
            attachment_content: original.attachment_content,
            attachment_id: original.attachment_id,
            attachment_format: original.attachment_format,
            attachment_custom_name: original.attachment_custom_name,
            smtp_config_id: original.smtp_config_id,
            subjects_list: original.subjects_list,
            sender_names_list: original.sender_names_list,
            cta_links_list: original.cta_links_list,
            smtp_ids_list: original.smtp_ids_list,
            rotate_subjects: original.rotate_subjects,
            rotate_senders: original.rotate_senders,
            rotate_cta: original.rotate_cta,
            rotate_smtp: original.rotate_smtp,
            smtp_rotation_type: original.smtp_rotation_type
        });
    },

    updateStatus: (id, status) => {
        if (status === 'completed') {
            return db.prepare('UPDATE campaigns SET status = ?, completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, id);
        }
        return db.prepare('UPDATE campaigns SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, id);
    },

    incrementSent: (id) => {
        return db.prepare('UPDATE campaigns SET sent_count = sent_count + 1 WHERE id = ?').run(id);
    },

    incrementFailed: (id) => {
        return db.prepare('UPDATE campaigns SET failed_count = failed_count + 1 WHERE id = ?').run(id);
    },

    delete: (id) => {
        return db.prepare('DELETE FROM campaigns WHERE id = ?').run(id);
    },

    getStats: (userId) => {
        return db.prepare(`
            SELECT
                COUNT(*) as total_campaigns,
                SUM(sent_count) as total_sent,
                SUM(failed_count) as total_failed,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_campaigns
            FROM campaigns
            WHERE user_id = ?
        `).get(userId);
    }
};

// ========================================
// Recipients operations
// ========================================

// Shared email regex — simple but covers 99% of cases
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validate + deduplicate a batch of recipients before insertion.
 *
 * Returns a breakdown so callers can report back to the user how many were
 * imported vs. skipped and why.
 *
 * @param {number} campaignId - Campaign to dedupe against (pass null to skip)
 * @param {Array} recipients  - Array of { email, name? } — free-form input
 * @param {object} opts
 *   - skipExistingCheck: don't query the DB for existing recipients
 * @returns {{ valid, invalid, duplicates, already_exists, summary }}
 */
export function validateAndDedupeRecipients(campaignId, recipients, opts = {}) {
    const invalid = [];
    const duplicates = [];
    const already_exists = [];
    const valid = [];

    // Load existing emails for this campaign (all statuses)
    let existingSet = new Set();
    if (campaignId && !opts.skipExistingCheck) {
        try {
            const rows = db.prepare('SELECT email FROM recipients WHERE campaign_id = ?').all(campaignId);
            existingSet = new Set(rows.map(r => r.email.toLowerCase()));
        } catch (e) {
            // ignore — empty set is safe
        }
    }

    for (const raw of recipients || []) {
        if (!raw || typeof raw !== 'object') continue;
        const email = (raw.email || '').trim().toLowerCase();

        if (!email) continue;
        if (!EMAIL_REGEX.test(email)) {
            invalid.push(email);
            continue;
        }
        if (existingSet.has(email)) {
            already_exists.push(email);
            continue;
        }
        valid.push({ email, name: raw.name || null });
    }

    return {
        valid,
        invalid,
        already_exists,
        summary: {
            total_input: (recipients || []).length,
            imported: valid.length,
            invalid: invalid.length,
            already_exists: already_exists.length
        }
    };
}

export const recipientDb = {
    findByCampaignId: (campaignId) => {
        return db.prepare('SELECT * FROM recipients WHERE campaign_id = ? ORDER BY id').all(campaignId);
    },

    findPendingByCampaignId: (campaignId, limit = 100) => {
        return db.prepare(`
            SELECT * FROM recipients
            WHERE campaign_id = ? AND status = 'pending'
            ORDER BY id
            LIMIT ?
        `).all(campaignId, limit);
    },

    bulkCreate: (campaignId, recipients) => {
        const stmt = db.prepare(`
            INSERT INTO recipients (campaign_id, email, name)
            VALUES (@campaign_id, @email, @name)
        `);

        const insertMany = db.transaction((recipients) => {
            for (const recipient of recipients) {
                stmt.run({
                    campaign_id: campaignId,
                    email: recipient.email,
                    name: recipient.name || null
                });
            }
        });

        insertMany(recipients);

        const count = recipients.length;
        db.prepare('UPDATE campaigns SET total_recipients = total_recipients + ? WHERE id = ?').run(count, campaignId);

        return count;
    },

    updateStatus: (id, status, errorMessage = null) => {
        if (status === 'sent') {
            return db.prepare('UPDATE recipients SET status = ?, sent_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, id);
        }
        return db.prepare('UPDATE recipients SET status = ?, error_message = ? WHERE id = ?').run(status, errorMessage, id);
    },

    resetAllStatus: (campaignId) => {
        return db.prepare("UPDATE recipients SET status = 'pending', sent_at = NULL, error_message = NULL WHERE campaign_id = ?").run(campaignId);
    },

    deleteByampaignId: (campaignId) => {
        return db.prepare('DELETE FROM recipients WHERE campaign_id = ?').run(campaignId);
    },

    getStatsByCampaignId: (campaignId) => {
        return db.prepare(`
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
                SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
            FROM recipients
            WHERE campaign_id = ?
        `).get(campaignId);
    },

    resetForCampaign: (campaignId) => {
        return db.prepare(`
            UPDATE recipients
            SET status = 'pending', sent_at = NULL, error_message = NULL
            WHERE campaign_id = ?
        `).run(campaignId);
    }
};

// ========================================
// Email logs operations
// ========================================

export const emailLogDb = {
    create: (logData) => {
        const stmt = db.prepare(`
            INSERT INTO email_logs (user_id, campaign_id, recipient_email, status, message_id, error_message)
            VALUES (@user_id, @campaign_id, @recipient_email, @status, @message_id, @error_message)
        `);
        return stmt.run({
            user_id: logData.user_id,
            campaign_id: logData.campaign_id || null,
            recipient_email: logData.recipient_email,
            status: logData.status,
            message_id: logData.message_id || null,
            error_message: logData.error_message || null
        });
    },

    findByUserId: (userId, limit = 100, offset = 0) => {
        return db.prepare(`
            SELECT * FROM email_logs
            WHERE user_id = ?
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
        `).all(userId, limit, offset);
    },

    getStatsByUserId: (userId) => {
        return db.prepare(`
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
                DATE(created_at) as date
            FROM email_logs
            WHERE user_id = ?
            GROUP BY DATE(created_at)
            ORDER BY date DESC
            LIMIT 30
        `).all(userId);
    },

    getGlobalStats: () => {
        return db.prepare(`
            SELECT
                COUNT(*) as total_emails,
                SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as total_sent,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as total_failed
            FROM email_logs
            WHERE created_at >= datetime('now', '-30 days')
        `).get();
    }
};

// ========================================
// Attachment Library operations
// ========================================

export const attachmentDb = {
    findById: (id) => {
        return db.prepare('SELECT * FROM attachments WHERE id = ?').get(id);
    },

    findByUserId: (userId) => {
        return db.prepare('SELECT id, user_id, name, description, html_content, file_name, file_type, file_size, tags, is_active, created_at, updated_at FROM attachments WHERE user_id = ? AND is_active = 1 ORDER BY created_at DESC').all(userId);
    },

    findAllByUserId: (userId) => {
        return db.prepare('SELECT id, user_id, name, description, html_content, file_name, file_type, file_size, tags, is_active, created_at, updated_at FROM attachments WHERE user_id = ? ORDER BY created_at DESC').all(userId);
    },

    create: (data) => {
        const stmt = db.prepare(`
            INSERT INTO attachments (user_id, name, description, html_content, file_name, file_content, file_type, file_size, tags)
            VALUES (@user_id, @name, @description, @html_content, @file_name, @file_content, @file_type, @file_size, @tags)
        `);
        const result = stmt.run({
            user_id: data.user_id,
            name: data.name,
            description: data.description || null,
            html_content: data.html_content || null,
            file_name: data.file_name || null,
            file_content: data.file_content || null,
            file_type: data.file_type || null,
            file_size: data.file_size || 0,
            tags: data.tags || null
        });
        return { id: result.lastInsertRowid, ...data };
    },

    update: (id, data) => {
        const fields = [];
        const values = { id };

        for (const [key, value] of Object.entries(data)) {
            if (value !== undefined && key !== 'id') {
                fields.push(`${key} = @${key}`);
                values[key] = value;
            }
        }

        if (fields.length === 0) return null;

        fields.push('updated_at = CURRENT_TIMESTAMP');

        const stmt = db.prepare(`UPDATE attachments SET ${fields.join(', ')} WHERE id = @id`);
        return stmt.run(values);
    },

    delete: (id) => {
        return db.prepare('DELETE FROM attachments WHERE id = ?').run(id);
    },

    count: (userId) => {
        return db.prepare('SELECT COUNT(*) as count FROM attachments WHERE user_id = ?').get(userId).count;
    }
};

// ========================================
// Email Templates Library
// ========================================

export const emailTemplateDb = {
    findById: (id) => {
        return db.prepare('SELECT * FROM email_templates WHERE id = ?').get(id);
    },

    findByUserId: (userId) => {
        return db.prepare('SELECT * FROM email_templates WHERE user_id = ? AND is_active = 1 ORDER BY created_at DESC').all(userId);
    },

    findAllByUserId: (userId) => {
        return db.prepare('SELECT * FROM email_templates WHERE user_id = ? ORDER BY created_at DESC').all(userId);
    },

    create: (data) => {
        const stmt = db.prepare(`
            INSERT INTO email_templates (user_id, name, description, html_content, tags)
            VALUES (@user_id, @name, @description, @html_content, @tags)
        `);
        const result = stmt.run({
            user_id: data.user_id,
            name: data.name,
            description: data.description || null,
            html_content: data.html_content,
            tags: data.tags || null
        });
        return { id: result.lastInsertRowid, ...data };
    },

    update: (id, data) => {
        const fields = [];
        const values = { id };

        for (const [key, value] of Object.entries(data)) {
            if (value !== undefined && key !== 'id') {
                fields.push(`${key} = @${key}`);
                values[key] = value;
            }
        }

        if (fields.length === 0) return null;

        fields.push('updated_at = CURRENT_TIMESTAMP');
        const sql = `UPDATE email_templates SET ${fields.join(', ')} WHERE id = @id`;
        return db.prepare(sql).run(values);
    },

    delete: (id) => {
        return db.prepare('DELETE FROM email_templates WHERE id = ?').run(id);
    },

    count: (userId) => {
        return db.prepare('SELECT COUNT(*) as count FROM email_templates WHERE user_id = ?').get(userId).count;
    }
};

// ========================================
// List operations (subjects, senders, links, recipients)
// ========================================

export const subjectListDb = {
    findByUserId: (userId) => db.prepare('SELECT * FROM subject_lists WHERE user_id = ? ORDER BY created_at DESC').all(userId),
    findById: (id) => db.prepare('SELECT * FROM subject_lists WHERE id = ?').get(id),
    create: (data) => {
        const result = db.prepare('INSERT INTO subject_lists (user_id, name, subjects) VALUES (?, ?, ?)').run(data.user_id, data.name, data.subjects);
        return { id: result.lastInsertRowid, ...data };
    },
    update: (id, data) => db.prepare('UPDATE subject_lists SET name = ?, subjects = ? WHERE id = ?').run(data.name, data.subjects, id),
    delete: (id) => db.prepare('DELETE FROM subject_lists WHERE id = ?').run(id)
};

export const senderListDb = {
    findByUserId: (userId) => db.prepare('SELECT * FROM sender_lists WHERE user_id = ? ORDER BY created_at DESC').all(userId),
    findById: (id) => db.prepare('SELECT * FROM sender_lists WHERE id = ?').get(id),
    create: (data) => {
        const result = db.prepare('INSERT INTO sender_lists (user_id, name, senders) VALUES (?, ?, ?)').run(data.user_id, data.name, data.senders);
        return { id: result.lastInsertRowid, ...data };
    },
    update: (id, data) => db.prepare('UPDATE sender_lists SET name = ?, senders = ? WHERE id = ?').run(data.name, data.senders, id),
    delete: (id) => db.prepare('DELETE FROM sender_lists WHERE id = ?').run(id)
};

export const linkListDb = {
    findByUserId: (userId) => db.prepare('SELECT * FROM link_lists WHERE user_id = ? ORDER BY created_at DESC').all(userId),
    findById: (id) => db.prepare('SELECT * FROM link_lists WHERE id = ?').get(id),
    create: (data) => {
        const result = db.prepare('INSERT INTO link_lists (user_id, name, links) VALUES (?, ?, ?)').run(data.user_id, data.name, data.links);
        return { id: result.lastInsertRowid, ...data };
    },
    update: (id, data) => db.prepare('UPDATE link_lists SET name = ?, links = ? WHERE id = ?').run(data.name, data.links, id),
    delete: (id) => db.prepare('DELETE FROM link_lists WHERE id = ?').run(id)
};

export const recipientListDb = {
    findByUserId: (userId) => db.prepare('SELECT * FROM recipient_lists WHERE user_id = ? ORDER BY created_at DESC').all(userId),
    findById: (id) => db.prepare('SELECT * FROM recipient_lists WHERE id = ?').get(id),
    create: (data) => {
        const recipients = typeof data.recipients === 'string' ? data.recipients : JSON.stringify(data.recipients);
        const count = Array.isArray(data.recipients) ? data.recipients.length : JSON.parse(recipients).length;
        const result = db.prepare('INSERT INTO recipient_lists (user_id, name, description, recipients, count) VALUES (?, ?, ?, ?, ?)').run(
            data.user_id, data.name, data.description || null, recipients, count
        );
        return { id: result.lastInsertRowid, ...data, count };
    },
    update: (id, data) => {
        const recipients = typeof data.recipients === 'string' ? data.recipients : JSON.stringify(data.recipients);
        const count = Array.isArray(data.recipients) ? data.recipients.length : JSON.parse(recipients).length;
        return db.prepare('UPDATE recipient_lists SET name = ?, description = ?, recipients = ?, count = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
            data.name, data.description || null, recipients, count, id
        );
    },
    delete: (id) => db.prepare('DELETE FROM recipient_lists WHERE id = ?').run(id)
};

// ========================================
// Proxy Configs operations
// ========================================

export const proxyDb = {
    findByUserId: (userId) => db.prepare('SELECT * FROM proxy_configs WHERE user_id = ? ORDER BY created_at DESC').all(userId),
    findActiveByUserId: (userId) => db.prepare('SELECT * FROM proxy_configs WHERE user_id = ? AND is_active = 1').all(userId),
    findById: (id) => db.prepare('SELECT * FROM proxy_configs WHERE id = ?').get(id),
    create: (data) => {
        const result = db.prepare(`
            INSERT INTO proxy_configs (user_id, name, proxy_type, host, port, username, password)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(data.user_id, data.name, data.proxy_type, data.host, data.port, data.username || null, data.password || null);
        return { id: result.lastInsertRowid, ...data };
    },
    update: (id, data) => {
        const fields = [];
        const values = [];
        for (const [key, value] of Object.entries(data)) {
            if (value !== undefined) {
                fields.push(`${key} = ?`);
                values.push(value);
            }
        }
        values.push(id);
        return db.prepare(`UPDATE proxy_configs SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    },
    delete: (id) => db.prepare('DELETE FROM proxy_configs WHERE id = ?').run(id),
    toggleActive: (id) => db.prepare('UPDATE proxy_configs SET is_active = NOT is_active WHERE id = ?').run(id)
};

// ========================================
// Sending Settings operations
// ========================================

/**
 * Find emails that have failed N or more times in email_logs for this user.
 * Used by the list cleanup feature to remove repeatedly-failing addresses.
 */
export function findRepeatedlyFailedEmails(userId, candidateEmails, minFails = 2) {
    if (!candidateEmails || candidateEmails.length === 0) return new Set();
    const lower = candidateEmails.map(e => (e || '').toLowerCase().trim());
    const placeholders = lower.map(() => '?').join(',');
    const rows = db.prepare(`
        SELECT recipient_email, COUNT(*) as fails
        FROM email_logs
        WHERE user_id = ? AND status = 'failed' AND lower(recipient_email) IN (${placeholders})
        GROUP BY recipient_email
        HAVING fails >= ?
    `).all(userId, ...lower, minFails);
    return new Set(rows.map(r => (r.recipient_email || '').toLowerCase()));
}

// ========================================
// Unsubscribes (CAN-SPAM / GDPR)
// ========================================
export const unsubscribeDb = {
    isUnsubscribed: (userId, email) => {
        const e = (email || '').toLowerCase().trim();
        if (!e) return false;
        const row = db.prepare('SELECT 1 FROM unsubscribes WHERE user_id = ? AND email = ?').get(userId, e);
        return !!row;
    },
    add: (userId, email, campaignId = null, source = 'link', ip = null) => {
        const e = (email || '').toLowerCase().trim();
        if (!e) return false;
        try {
            db.prepare(`
                INSERT OR IGNORE INTO unsubscribes (user_id, email, campaign_id, source, ip)
                VALUES (?, ?, ?, ?, ?)
            `).run(userId, e, campaignId, source, ip);
            return true;
        } catch {
            return false;
        }
    },
    remove: (userId, email) => {
        const e = (email || '').toLowerCase().trim();
        return db.prepare('DELETE FROM unsubscribes WHERE user_id = ? AND email = ?').run(userId, e);
    },
    findByUserId: (userId) => {
        return db.prepare('SELECT * FROM unsubscribes WHERE user_id = ? ORDER BY unsubscribed_at DESC').all(userId);
    },
    /**
     * Bulk check — given an array of emails, return a Set of those that are
     * unsubscribed for this user. Used to filter recipients before a send.
     */
    findUnsubscribedSet: (userId, emails) => {
        if (!emails || emails.length === 0) return new Set();
        const placeholders = emails.map(() => '?').join(',');
        const lower = emails.map(e => (e || '').toLowerCase().trim());
        const rows = db.prepare(
            `SELECT email FROM unsubscribes WHERE user_id = ? AND email IN (${placeholders})`
        ).all(userId, ...lower);
        return new Set(rows.map(r => r.email));
    },
    count: (userId) => {
        const row = db.prepare('SELECT COUNT(*) as n FROM unsubscribes WHERE user_id = ?').get(userId);
        return row?.n || 0;
    }
};

export const sendingSettingsDb = {
    findByUserId: (userId) => db.prepare('SELECT * FROM sending_settings WHERE user_id = ?').get(userId),
    upsert: (userId, data) => {
        const existing = db.prepare('SELECT id FROM sending_settings WHERE user_id = ?').get(userId);
        if (existing) {
            return db.prepare(`
                UPDATE sending_settings
                SET threads = ?, delay_min = ?, delay_max = ?, retry_failed = ?, use_proxy = ?, updated_at = CURRENT_TIMESTAMP
                WHERE user_id = ?
            `).run(data.threads, data.delay_min, data.delay_max, data.retry_failed ? 1 : 0, data.use_proxy ? 1 : 0, userId);
        } else {
            return db.prepare(`
                INSERT INTO sending_settings (user_id, threads, delay_min, delay_max, retry_failed, use_proxy)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(userId, data.threads, data.delay_min, data.delay_max, data.retry_failed ? 1 : 0, data.use_proxy ? 1 : 0);
        }
    }
};

// ========================================
// Inbox Finder operations
// ========================================

export const inboxFinderTestDb = {
    findByUserId: (userId) => {
        return db.prepare(`
            SELECT t.*, s.name as smtp_name, s.host as smtp_host
            FROM inbox_finder_tests t
            LEFT JOIN smtp_configs s ON t.smtp_config_id = s.id
            WHERE t.user_id = ?
            ORDER BY t.created_at DESC
        `).all(userId);
    },

    findById: (id) => {
        return db.prepare(`
            SELECT t.*, s.name as smtp_name, s.host as smtp_host
            FROM inbox_finder_tests t
            LEFT JOIN smtp_configs s ON t.smtp_config_id = s.id
            WHERE t.id = ?
        `).get(id);
    },

    create: (data) => {
        const stmt = db.prepare(`
            INSERT INTO inbox_finder_tests (
                user_id, smtp_config_id, name, usernames, domains, recipients,
                total_combinations, status
            ) VALUES (
                @user_id, @smtp_config_id, @name, @usernames, @domains, @recipients,
                @total_combinations, 'pending'
            )
        `);
        const result = stmt.run({
            user_id: data.user_id,
            smtp_config_id: data.smtp_config_id,
            name: data.name || `Test ${new Date().toLocaleString()}`,
            usernames: JSON.stringify(data.usernames),
            domains: JSON.stringify(data.domains),
            recipients: JSON.stringify(data.recipients || []),
            total_combinations: data.total_combinations || 0
        });
        return { id: result.lastInsertRowid, ...data };
    },

    update: (id, data) => {
        const fields = [];
        const values = { id };

        for (const [key, value] of Object.entries(data)) {
            if (value !== undefined && key !== 'id') {
                fields.push(`${key} = @${key}`);
                values[key] = value;
            }
        }

        if (fields.length === 0) return null;

        return db.prepare(`UPDATE inbox_finder_tests SET ${fields.join(', ')} WHERE id = @id`).run(values);
    },

    delete: (id) => {
        return db.prepare('DELETE FROM inbox_finder_tests WHERE id = ?').run(id);
    },

    getStats: (userId) => {
        return db.prepare(`
            SELECT
                COUNT(*) as total_tests,
                SUM(sent_count) as total_sent,
                SUM(failed_count) as total_failed
            FROM inbox_finder_tests
            WHERE user_id = ?
        `).get(userId);
    }
};

export const inboxFinderResultDb = {
    findByTestId: (testId) => {
        return db.prepare(`
            SELECT * FROM inbox_finder_results
            WHERE test_id = ?
            ORDER BY id ASC
        `).all(testId);
    },

    create: (data) => {
        const stmt = db.prepare(`
            INSERT INTO inbox_finder_results (
                test_id, email, sender_email, recipient_email, username, domain, status
            ) VALUES (
                @test_id, @email, @sender_email, @recipient_email, @username, @domain, 'pending'
            )
        `);
        const result = stmt.run({
            test_id: data.test_id,
            email: data.sender_email || data.email,
            sender_email: data.sender_email || data.email,
            recipient_email: data.recipient_email || data.email,
            username: data.username,
            domain: data.domain
        });
        return { id: result.lastInsertRowid, ...data };
    },

    bulkCreate: (testId, combinations) => {
        const stmt = db.prepare(`
            INSERT INTO inbox_finder_results (test_id, email, sender_email, recipient_email, username, domain, status)
            VALUES (@test_id, @email, @sender_email, @recipient_email, @username, @domain, 'pending')
        `);

        const insertMany = db.transaction((combos) => {
            for (const combo of combos) {
                stmt.run({
                    test_id: testId,
                    email: combo.email,
                    sender_email: combo.email,
                    recipient_email: combo.email,
                    username: combo.username,
                    domain: combo.domain
                });
            }
            return combos.length;
        });

        return insertMany(combinations);
    },

    bulkCreateWithRecipients: (testId, testResults) => {
        const stmt = db.prepare(`
            INSERT INTO inbox_finder_results (test_id, email, sender_email, recipient_email, username, domain, status)
            VALUES (@test_id, @email, @sender_email, @recipient_email, @username, @domain, 'pending')
        `);

        const insertMany = db.transaction((results) => {
            for (const result of results) {
                stmt.run({
                    test_id: testId,
                    email: result.sender_email,
                    sender_email: result.sender_email,
                    recipient_email: result.recipient_email,
                    username: result.username,
                    domain: result.domain
                });
            }
            return results.length;
        });

        return insertMany(testResults);
    },

    updateStatus: (id, status, errorMessage = null) => {
        return db.prepare(`
            UPDATE inbox_finder_results
            SET status = ?, error_message = ?, sent_at = CASE WHEN ? = 'sent' THEN CURRENT_TIMESTAMP ELSE sent_at END
            WHERE id = ?
        `).run(status, errorMessage, status, id);
    },

    getStatusCounts: (testId) => {
        return db.prepare(`
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
                SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending
            FROM inbox_finder_results
            WHERE test_id = ?
        `).get(testId);
    },

    deleteByTestId: (testId) => {
        return db.prepare('DELETE FROM inbox_finder_results WHERE test_id = ?').run(testId);
    }
};

export default db;
