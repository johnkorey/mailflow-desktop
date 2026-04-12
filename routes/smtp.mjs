import { Router } from 'express';
import { smtpDb } from '../database/db.mjs';
import { encrypt, decrypt } from '../services/encryption.mjs';
import { SUPPORTED_PROVIDERS, verifyApiProvider, getProviderSmtpDefaults } from '../services/api-providers.mjs';
import { buildSmtpTransport, isSmtpProvider } from '../services/smtp-transport.mjs';

const router = Router();

/**
 * GET /api/user/smtp/providers
 * List supported email providers
 */
router.get('/providers', (req, res) => {
    res.json({ providers: SUPPORTED_PROVIDERS });
});

/**
 * GET /api/user/smtp/provider-defaults/:provider
 * Get auto-fill SMTP defaults for a provider
 */
router.get('/provider-defaults/:provider', (req, res) => {
    const defaults = getProviderSmtpDefaults(req.params.provider, req.query.region);
    res.json({ defaults: defaults || {} });
});

/**
 * GET /api/user/smtp
 * Get all SMTP configs for current user
 */
router.get('/', (req, res) => {
    try {
        const configs = smtpDb.findByUserId(req.user.id);

        // Remove encrypted passwords/keys from response
        const safeConfigs = configs.map(config => ({
            ...config,
            password_encrypted: undefined,
            api_key_encrypted: undefined,
            has_password: !!config.password_encrypted,
            has_api_key: !!config.api_key_encrypted
        }));

        res.json({ smtp_configs: safeConfigs });
    } catch (error) {
        console.error('Get SMTP configs error:', error);
        res.status(500).json({ error: 'Failed to get SMTP configs' });
    }
});

/**
 * POST /api/user/smtp
 * Create new SMTP config (supports both SMTP and API providers)
 */
router.post('/', (req, res) => {
    try {
        const { name, provider, host, port, secure, auth_type, username, password, api_key, api_domain, api_region, from_email, from_name } = req.body;

        const providerType = provider || 'smtp';
        const isApiProvider = ['sendgrid', 'mailgun', 'postmark', 'sparkpost'].includes(providerType);

        // Validate based on provider type
        if (!isApiProvider && providerType !== 'gsuite' && providerType !== 'amazon_ses' && !host) {
            return res.status(400).json({ error: 'Host is required for SMTP providers' });
        }

        if (isApiProvider && !api_key) {
            return res.status(400).json({ error: 'API key is required for this provider' });
        }

        if (providerType === 'mailgun' && !api_domain) {
            return res.status(400).json({ error: 'Domain is required for Mailgun' });
        }

        const authType = auth_type || (isApiProvider ? 'api-key' : 'login');

        if (!isApiProvider && authType !== 'none' && (!username || !password)) {
            return res.status(400).json({ error: 'Credentials are required for this auth type' });
        }

        // Encrypt secrets
        const password_encrypted = password ? encrypt(password) : null;
        const api_key_encrypted = api_key ? encrypt(api_key) : null;

        // Resolve secure flag
        let secureFlag = false;
        if (secure === 'ssl' || secure === true || secure === 1) secureFlag = true;

        const existingConfigs = smtpDb.findByUserId(req.user.id);

        const config = smtpDb.create({
            user_id: req.user.id,
            name: name || 'Default',
            provider: providerType,
            host: host || null,
            port: port || 587,
            secure: secureFlag,
            auth_type: authType,
            username: username || null,
            password_encrypted,
            api_key_encrypted,
            api_domain: api_domain || null,
            api_region: api_region || null,
            from_email,
            from_name
        });

        // If this is the first config, make it active
        if (existingConfigs.length === 0) {
            smtpDb.setActive(config.id, req.user.id);
        }

        res.status(201).json({
            message: 'SMTP configuration created',
            smtp_config: {
                ...config,
                password_encrypted: undefined,
                api_key_encrypted: undefined,
                has_password: !!password,
                has_api_key: !!api_key
            }
        });
    } catch (error) {
        console.error('Create SMTP config error:', error);
        res.status(500).json({ error: 'Failed to create SMTP config' });
    }
});

/**
 * POST /api/user/smtp/test
 * Test SMTP or API provider connection with provided credentials
 */
router.post('/test', async (req, res) => {
    try {
        const { provider, host, port, auth_type, secure, username, password, api_key, api_domain, api_region } = req.body;
        const providerType = provider || 'smtp';

        // API-based providers (SendGrid, Mailgun, Postmark, SparkPost)
        // go through their REST API, not nodemailer.
        if (!isSmtpProvider(providerType)) {
            if (!api_key) {
                return res.status(400).json({ error: 'API key is required' });
            }
            const testConfig = {
                api_key_encrypted: encrypt(api_key),
                api_domain: api_domain || null,
                api_region: api_region || null,
                provider: providerType
            };
            await verifyApiProvider(providerType, testConfig);
            return res.json({ success: true, message: `${providerType} API connection successful!` });
        }

        // SMTP-based providers (smtp, gsuite, amazon_ses) — shared helper
        // resolves host/port/secure and builds the nodemailer transport.
        const { transporter } = buildSmtpTransport({
            provider: providerType,
            host,
            port,
            secure,
            auth_type,
            username,
            password,
            api_region,
        });
        await transporter.verify();
        res.json({ success: true, message: 'SMTP connection successful!' });
    } catch (error) {
        console.error('SMTP test error:', error);
        res.status(400).json({ error: error.message || 'Connection test failed' });
    }
});

/**
 * POST /api/user/smtp/:id/test
 * Test a previously-saved SMTP/API config by loading it from the database
 * and decrypting credentials server-side. This is what the Test button on
 * the SMTP grid/list uses — no plaintext credentials leave the server.
 */
router.post('/:id/test', async (req, res) => {
    try {
        const { id } = req.params;
        const config = smtpDb.findById(id);
        if (!config || config.user_id !== req.user.id) {
            return res.status(404).json({ error: 'SMTP configuration not found' });
        }

        const providerType = config.provider || 'smtp';

        // API-based providers — verify via their REST API, no nodemailer.
        if (!isSmtpProvider(providerType)) {
            if (!config.api_key_encrypted) {
                return res.status(400).json({ error: 'No API key stored for this config' });
            }
            await verifyApiProvider(providerType, config);
            return res.json({ success: true, message: `${providerType} API connection successful!` });
        }

        // SMTP-based: decrypt the saved password, then hand off to the
        // shared transport builder so this path stays in lockstep with
        // the ad-hoc /smtp/test endpoint.
        const password = config.password_encrypted ? decrypt(config.password_encrypted) : '';
        const { transporter } = buildSmtpTransport({
            provider: providerType,
            host: config.host,
            port: config.port,
            secure: config.secure,
            auth_type: config.auth_type,
            username: config.username,
            password,
            api_region: config.api_region,
        });
        await transporter.verify();
        res.json({ success: true, message: `${config.name}: connection successful!` });
    } catch (error) {
        console.error('Saved SMTP test error:', error);
        res.status(400).json({ error: error.message || 'Connection test failed' });
    }
});

/**
 * PUT /api/user/smtp/:id
 * Update SMTP config (supports both SMTP and API providers)
 */
router.put('/:id', (req, res) => {
    try {
        const { id } = req.params;
        const { name, provider, host, port, secure, auth_type, username, password, api_key, api_domain, api_region, from_email, from_name } = req.body;

        // Verify ownership
        const config = smtpDb.findById(id);
        if (!config || config.user_id !== req.user.id) {
            return res.status(404).json({ error: 'SMTP configuration not found' });
        }

        let secureFlag = config.secure;
        if (secure === 'ssl') secureFlag = true;
        else if (secure === 'starttls' || secure === 'none') secureFlag = false;

        const updateData = {
            name,
            provider: provider || config.provider || 'smtp',
            host: host || null,
            port,
            secure: secureFlag,
            auth_type: auth_type || config.auth_type,
            username: username || null,
            api_domain: api_domain !== undefined ? api_domain : config.api_domain,
            api_region: api_region !== undefined ? api_region : config.api_region,
            from_email,
            from_name
        };

        // Only update password if provided
        if (password) {
            updateData.password_encrypted = encrypt(password);
        } else if (auth_type === 'none') {
            updateData.password_encrypted = null;
        }

        // Only update API key if provided
        if (api_key) {
            updateData.api_key_encrypted = encrypt(api_key);
        }

        smtpDb.update(id, updateData);

        res.json({ message: 'SMTP configuration updated' });
    } catch (error) {
        console.error('Update SMTP config error:', error);
        res.status(500).json({ error: 'Failed to update SMTP config' });
    }
});

/**
 * DELETE /api/user/smtp/:id
 * Delete SMTP config
 */
router.delete('/:id', (req, res) => {
    try {
        const { id } = req.params;

        // Verify ownership
        const config = smtpDb.findById(id);
        if (!config || config.user_id !== req.user.id) {
            return res.status(404).json({ error: 'SMTP configuration not found' });
        }

        smtpDb.delete(id);

        res.json({ message: 'SMTP configuration deleted' });
    } catch (error) {
        console.error('Delete SMTP config error:', error);
        res.status(500).json({ error: 'Failed to delete SMTP config' });
    }
});

/**
 * POST /api/user/smtp/:id/activate
 * Set SMTP config as active
 */
router.post('/:id/activate', (req, res) => {
    try {
        const { id } = req.params;

        // Verify ownership
        const config = smtpDb.findById(id);
        if (!config || config.user_id !== req.user.id) {
            return res.status(404).json({ error: 'SMTP configuration not found' });
        }

        smtpDb.setActive(id, req.user.id);

        res.json({ message: 'SMTP configuration activated' });
    } catch (error) {
        console.error('Activate SMTP config error:', error);
        res.status(500).json({ error: 'Failed to activate SMTP config' });
    }
});

export default router;
