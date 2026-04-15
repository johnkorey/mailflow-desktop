-- MailFlow Desktop Database Schema

-- Users table (single local user)
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    name TEXT,
    is_active INTEGER DEFAULT 1,
    test_email TEXT,
    test_interval INTEGER DEFAULT 50,
    test_enabled INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- App Settings (key-value store for license, preferences, etc.)
CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- SMTP Configurations table
CREATE TABLE IF NOT EXISTS smtp_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT DEFAULT 'Default',
    provider TEXT DEFAULT 'smtp',
    host TEXT,
    port INTEGER DEFAULT 587,
    secure INTEGER DEFAULT 0,
    auth_type TEXT DEFAULT 'login',
    username TEXT,
    password_encrypted TEXT,
    api_key_encrypted TEXT,
    api_domain TEXT,
    api_region TEXT,
    from_email TEXT,
    from_name TEXT,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Campaigns table
CREATE TABLE IF NOT EXISTS campaigns (
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
    smtp_rotation_type TEXT DEFAULT 'round_robin',
    body_html TEXT,
    body_text TEXT,
    reply_to TEXT,
    attachment_name TEXT,
    attachment_path TEXT,
    attachment_content TEXT,
    attachment_id INTEGER,
    attachment_format TEXT DEFAULT 'html',
    attachment_custom_name TEXT,
    encoding TEXT DEFAULT NULL,
    bulk_mode INTEGER DEFAULT 0,
    status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'sending', 'completed', 'paused', 'failed')),
    scheduled_at DATETIME,
    total_recipients INTEGER DEFAULT 0,
    sent_count INTEGER DEFAULT 0,
    failed_count INTEGER DEFAULT 0,
    smtp_config_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (smtp_config_id) REFERENCES smtp_configs(id) ON DELETE SET NULL,
    FOREIGN KEY (attachment_id) REFERENCES attachments(id) ON DELETE SET NULL
);

-- Recipients table
CREATE TABLE IF NOT EXISTS recipients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL,
    email TEXT NOT NULL,
    name TEXT,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'bounced')),
    error_message TEXT,
    sent_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);

-- Email Logs table
CREATE TABLE IF NOT EXISTS email_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    campaign_id INTEGER,
    recipient_email TEXT NOT NULL,
    status TEXT NOT NULL,
    message_id TEXT,
    error_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE SET NULL
);

-- Subject Lists
CREATE TABLE IF NOT EXISTS subject_lists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    subjects TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Sender Name Lists
CREATE TABLE IF NOT EXISTS sender_lists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    senders TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- CTA Link Lists
CREATE TABLE IF NOT EXISTS link_lists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    links TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Recipient Lists
CREATE TABLE IF NOT EXISTS recipient_lists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    recipients TEXT NOT NULL,
    count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Proxy Configurations
CREATE TABLE IF NOT EXISTS proxy_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    proxy_type TEXT NOT NULL CHECK (proxy_type IN ('http', 'https', 'socks4', 'socks5')),
    host TEXT NOT NULL,
    port INTEGER NOT NULL,
    username TEXT,
    password TEXT,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- User Sending Settings
CREATE TABLE IF NOT EXISTS sending_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER UNIQUE NOT NULL,
    threads INTEGER DEFAULT 1,
    delay_min INTEGER DEFAULT 1000,
    delay_max INTEGER DEFAULT 3000,
    retry_failed INTEGER DEFAULT 0,
    use_proxy INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Attachment Library
CREATE TABLE IF NOT EXISTS attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    html_content TEXT,
    file_name TEXT,
    file_content BLOB,
    file_type TEXT,
    file_size INTEGER DEFAULT 0,
    tags TEXT,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Email Templates Library
CREATE TABLE IF NOT EXISTS email_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    html_content TEXT NOT NULL,
    tags TEXT,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Inbox Finder Tests
CREATE TABLE IF NOT EXISTS inbox_finder_tests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    smtp_config_id INTEGER NOT NULL,
    name TEXT,
    usernames TEXT NOT NULL,
    domains TEXT NOT NULL,
    recipients TEXT,
    total_combinations INTEGER DEFAULT 0,
    sent_count INTEGER DEFAULT 0,
    failed_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'cancelled')),
    started_at DATETIME,
    completed_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (smtp_config_id) REFERENCES smtp_configs(id) ON DELETE CASCADE
);

-- Inbox Finder Results
CREATE TABLE IF NOT EXISTS inbox_finder_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    test_id INTEGER NOT NULL,
    email TEXT,
    sender_email TEXT NOT NULL,
    recipient_email TEXT NOT NULL,
    username TEXT NOT NULL,
    domain TEXT NOT NULL,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
    error_message TEXT,
    sent_at DATETIME,
    FOREIGN KEY (test_id) REFERENCES inbox_finder_tests(id) ON DELETE CASCADE
);

-- Unsubscribes (CAN-SPAM / GDPR)
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
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_unsubscribes_user_email ON unsubscribes(user_id, email);
CREATE INDEX IF NOT EXISTS idx_smtp_configs_user_id ON smtp_configs(user_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_user_id ON campaigns(user_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);
CREATE INDEX IF NOT EXISTS idx_recipients_campaign_id ON recipients(campaign_id);
CREATE INDEX IF NOT EXISTS idx_recipients_status ON recipients(status);
CREATE INDEX IF NOT EXISTS idx_email_logs_user_id ON email_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_attachments_user_id ON attachments(user_id);
CREATE INDEX IF NOT EXISTS idx_email_templates_user_id ON email_templates(user_id);
CREATE INDEX IF NOT EXISTS idx_inbox_finder_results_test ON inbox_finder_results(test_id);
