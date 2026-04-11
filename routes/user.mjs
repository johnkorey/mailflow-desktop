import { Router } from 'express';
import { smtpDb, campaignDb, recipientDb, emailLogDb, userDb, attachmentDb, emailTemplateDb, subjectListDb, senderListDb, linkListDb, recipientListDb, proxyDb, sendingSettingsDb, validateAndDedupeRecipients, unsubscribeDb, findRepeatedlyFailedEmails } from '../database/db.mjs';
import { authenticate } from '../middleware/auth.mjs';
import { encrypt, decrypt } from '../services/encryption.mjs';
import { convertAttachment } from '../services/attachment-converter.mjs';
import { SUPPORTED_PROVIDERS, verifyApiProvider, getProviderSmtpDefaults } from '../services/api-providers.mjs';
import { buildBackup, restoreBackup, BACKUP_VERSION } from '../services/backup.mjs';
import { buildCampaignPreview } from '../services/preview.mjs';

const router = Router();

// All routes require authentication
router.use(authenticate);

// ============ SMTP Configuration Routes ============

/**
 * GET /api/user/smtp/providers
 * List supported email providers
 */
router.get('/smtp/providers', (req, res) => {
    res.json({ providers: SUPPORTED_PROVIDERS });
});

/**
 * GET /api/user/smtp/provider-defaults/:provider
 * Get auto-fill SMTP defaults for a provider
 */
router.get('/smtp/provider-defaults/:provider', (req, res) => {
    const defaults = getProviderSmtpDefaults(req.params.provider, req.query.region);
    res.json({ defaults: defaults || {} });
});

/**
 * GET /api/user/smtp
 * Get all SMTP configs for current user
 */
router.get('/smtp', (req, res) => {
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
router.post('/smtp', (req, res) => {
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
router.post('/smtp/test', async (req, res) => {
    try {
        const { provider, host, port, auth_type, secure, username, password, api_key, api_domain, api_region } = req.body;
        const providerType = provider || 'smtp';
        const isApiProvider = ['sendgrid', 'mailgun', 'postmark', 'sparkpost'].includes(providerType);

        // For API-based providers, verify via their REST API
        if (isApiProvider) {
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

        // For SMTP-based providers (smtp, gsuite, amazon_ses), use Nodemailer verify
        let smtpHost = host;
        let smtpPort = port;
        let secureFlag = false;
        if (secure === 'ssl') secureFlag = true;

        // Auto-fill for known SMTP providers
        if (providerType === 'gsuite' && !smtpHost) {
            smtpHost = 'smtp.gmail.com';
            smtpPort = 465;
            secureFlag = true;
        } else if (providerType === 'amazon_ses' && !smtpHost) {
            const region = api_region || 'us-east-1';
            smtpHost = `email-smtp.${region}.amazonaws.com`;
            smtpPort = 587;
        }

        if (!smtpHost) {
            return res.status(400).json({ error: 'Host is required' });
        }

        const authType = auth_type || 'login';
        const portNum = smtpPort || 587;

        const nodemailer = await import('nodemailer');
        const transportOpts = {
            host: smtpHost,
            port: portNum,
            secure: secureFlag,
            connectionTimeout: 15000,
            greetingTimeout: 15000,
            socketTimeout: 30000,
            tls: {
                rejectUnauthorized: false,
                minVersion: 'TLSv1'
            },
        };

        if (!secureFlag && portNum !== 25) {
            transportOpts.opportunisticTLS = true;
        }

        if (authType === 'none') {
            transportOpts.auth = undefined;
        } else if (authType === 'oauth2') {
            transportOpts.auth = { type: 'OAuth2', user: username, accessToken: password };
        } else {
            transportOpts.auth = { user: username, pass: password };
        }

        const transporter = nodemailer.default.createTransport(transportOpts);
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
router.post('/smtp/:id/test', async (req, res) => {
    try {
        const { id } = req.params;
        const config = smtpDb.findById(id);
        if (!config || config.user_id !== req.user.id) {
            return res.status(404).json({ error: 'SMTP configuration not found' });
        }

        const providerType = config.provider || 'smtp';
        const isApiProvider = ['sendgrid', 'mailgun', 'postmark', 'sparkpost'].includes(providerType);

        // API provider: verify via REST API
        if (isApiProvider) {
            if (!config.api_key_encrypted) {
                return res.status(400).json({ error: 'No API key stored for this config' });
            }
            await verifyApiProvider(providerType, config);
            return res.json({ success: true, message: `${providerType} API connection successful!` });
        }

        // SMTP-based: build a nodemailer transport with decrypted creds
        let smtpHost = config.host;
        let smtpPort = config.port;
        let secureFlag = config.secure === 1 || config.secure === true;

        if (providerType === 'gsuite' && !smtpHost) {
            smtpHost = 'smtp.gmail.com';
            smtpPort = 465;
            secureFlag = true;
        } else if (providerType === 'amazon_ses' && !smtpHost) {
            const region = config.api_region || 'us-east-1';
            smtpHost = `email-smtp.${region}.amazonaws.com`;
            smtpPort = 587;
        }

        if (!smtpHost) {
            return res.status(400).json({ error: 'No host configured' });
        }

        const authType = config.auth_type || 'login';
        const portNum = smtpPort || 587;

        const nodemailer = await import('nodemailer');
        const transportOpts = {
            host: smtpHost,
            port: portNum,
            secure: secureFlag,
            connectionTimeout: 15000,
            greetingTimeout: 15000,
            socketTimeout: 30000,
            tls: { rejectUnauthorized: false, minVersion: 'TLSv1' }
        };
        if (!secureFlag && portNum !== 25) transportOpts.opportunisticTLS = true;

        if (authType === 'none') {
            transportOpts.auth = undefined;
        } else {
            const password = config.password_encrypted ? decrypt(config.password_encrypted) : '';
            if (authType === 'oauth2') {
                transportOpts.auth = { type: 'OAuth2', user: config.username, accessToken: password };
            } else {
                transportOpts.auth = { user: config.username, pass: password };
            }
        }

        const transporter = nodemailer.default.createTransport(transportOpts);
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
router.put('/smtp/:id', (req, res) => {
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
router.delete('/smtp/:id', (req, res) => {
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
router.post('/smtp/:id/activate', (req, res) => {
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

// ============ Campaign Routes ============

/**
 * GET /api/user/campaigns
 * Get all campaigns for current user
 */
router.get('/campaigns', (req, res) => {
    try {
        const { limit = 50, offset = 0 } = req.query;
        const campaigns = campaignDb.findByUserId(req.user.id, parseInt(limit), parseInt(offset));
        
        res.json({ campaigns });
    } catch (error) {
        console.error('Get campaigns error:', error);
        res.status(500).json({ error: 'Failed to get campaigns' });
    }
});

/**
 * GET /api/user/campaigns/:id
 * Get single campaign with recipients
 */
router.get('/campaigns/:id', (req, res) => {
    try {
        const { id } = req.params;
        
        const campaign = campaignDb.findById(id);
        if (!campaign || campaign.user_id !== req.user.id) {
            return res.status(404).json({ error: 'Campaign not found' });
        }
        
        const recipients = recipientDb.findByCampaignId(id);
        const stats = recipientDb.getStatsByCampaignId(id);
        
        res.json({ campaign, recipients, stats });
    } catch (error) {
        console.error('Get campaign error:', error);
        res.status(500).json({ error: 'Failed to get campaign' });
    }
});

/**
 * POST /api/user/campaigns
 * Create new campaign
 */
router.post('/campaigns', (req, res) => {
    try {
        const { 
            name, subject, body_html, body_text, reply_to, 
            attachment, attachment_id, attachment_format, attachment_custom_name, smtp_config_id,
            // Rotation fields
            subjects_list, sender_names_list, cta_links_list, smtp_ids_list,
            rotate_subjects, rotate_senders, rotate_cta, rotate_smtp, smtp_rotation_type
        } = req.body;

        // Subject is required unless a subjects_list is provided for rotation
        const hasSubjectList = subjects_list && Array.isArray(subjects_list) && subjects_list.length > 0;
        if (!name) {
            return res.status(400).json({ error: 'Campaign name is required' });
        }
        if (!subject && !hasSubjectList) {
            return res.status(400).json({ error: 'Subject is required (or select a subject list for rotation)' });
        }
        
        // Verify SMTP config ownership if provided
        if (smtp_config_id) {
            const smtpConfig = smtpDb.findById(smtp_config_id);
            if (!smtpConfig || smtpConfig.user_id !== req.user.id) {
                return res.status(400).json({ error: 'Invalid SMTP configuration' });
            }
        }
        
        // Verify all SMTP IDs in rotation list
        if (smtp_ids_list && Array.isArray(smtp_ids_list)) {
            for (const smtpId of smtp_ids_list) {
                const smtpConfig = smtpDb.findById(smtpId);
                if (!smtpConfig || smtpConfig.user_id !== req.user.id) {
                    return res.status(400).json({ error: 'Invalid SMTP in rotation list' });
                }
            }
        }
        
        // Verify attachment library ownership if provided
        if (attachment_id) {
            const libraryAttachment = attachmentDb.findById(attachment_id);
            if (!libraryAttachment || libraryAttachment.user_id !== req.user.id) {
                return res.status(400).json({ error: 'Invalid attachment' });
            }
        }
        
        // Handle direct upload attachment
        let attachment_name = null;
        let attachment_content = null;
        if (attachment && attachment.name && attachment.content) {
            attachment_name = attachment.name;
            attachment_content = attachment.content;
        }
        
        // Debug: Log received rotation data
        console.log('[Campaign Create] Rotation data received:', {
            rotate_cta,
            cta_links_list,
            rotate_subjects,
            rotate_senders,
            subjects_list: subjects_list ? `${subjects_list.length} items` : null,
            sender_names_list: sender_names_list ? `${sender_names_list.length} items` : null
        });
        
        console.log('[Campaign Create] Attachment data:', { attachment_id, attachment_format, attachment_name, has_attachment_content: !!attachment_content });

        const campaign = campaignDb.create({
            user_id: req.user.id,
            name,
            subject,
            body_html,
            body_text,
            reply_to,
            attachment_name,
            attachment_content,
            attachment_id: attachment_id || null,
            attachment_format: attachment_format || 'html',
            attachment_custom_name: attachment_custom_name || null,
            smtp_config_id,
            // Rotation fields
            subjects_list: subjects_list ? JSON.stringify(subjects_list) : null,
            sender_names_list: sender_names_list ? JSON.stringify(sender_names_list) : null,
            cta_links_list: cta_links_list ? JSON.stringify(cta_links_list) : null,
            smtp_ids_list: smtp_ids_list ? JSON.stringify(smtp_ids_list) : null,
            rotate_subjects: rotate_subjects || false,
            rotate_senders: rotate_senders || false,
            rotate_cta: rotate_cta || false,
            rotate_smtp: rotate_smtp || false,
            smtp_rotation_type: smtp_rotation_type || 'round_robin'
        });

        res.status(201).json({
            message: 'Campaign created',
            campaign
        });
    } catch (error) {
        console.error('Create campaign error:', error);
        res.status(500).json({ error: 'Failed to create campaign' });
    }
});

/**
 * PUT /api/user/campaigns/:id
 * Update campaign
 */
router.put('/campaigns/:id', (req, res) => {
    try {
        const { id } = req.params;
        const { 
            name, subject, body_html, body_text, reply_to, 
            attachment, attachment_id, attachment_format, attachment_custom_name, smtp_config_id,
            // Rotation fields
            subjects_list, sender_names_list, cta_links_list, smtp_ids_list,
            rotate_subjects, rotate_senders, rotate_cta, rotate_smtp, smtp_rotation_type
        } = req.body;

        // Verify ownership
        const campaign = campaignDb.findById(id);
        if (!campaign || campaign.user_id !== req.user.id) {
            return res.status(404).json({ error: 'Campaign not found' });
        }
        
        // Can't update if sending
        if (campaign.status === 'sending') {
            return res.status(400).json({ error: 'Cannot update campaign while sending' });
        }
        
        // Verify all SMTP IDs in rotation list
        if (smtp_ids_list && Array.isArray(smtp_ids_list)) {
            for (const smtpId of smtp_ids_list) {
                const smtpConfig = smtpDb.findById(smtpId);
                if (!smtpConfig || smtpConfig.user_id !== req.user.id) {
                    return res.status(400).json({ error: 'Invalid SMTP in rotation list' });
                }
            }
        }
        
        // Verify attachment library ownership if provided
        if (attachment_id) {
            const libraryAttachment = attachmentDb.findById(attachment_id);
            if (!libraryAttachment || libraryAttachment.user_id !== req.user.id) {
                return res.status(400).json({ error: 'Invalid attachment' });
            }
        }
        
        // Handle direct upload attachment - only update if new attachment provided
        let attachment_name = campaign.attachment_name;
        let attachment_content = campaign.attachment_content;
        if (attachment && attachment.name && attachment.content) {
            attachment_name = attachment.name;
            attachment_content = attachment.content;
        } else if (attachment === null) {
            // Explicitly remove direct attachment
            attachment_name = null;
            attachment_content = null;
        }
        
        campaignDb.update(id, {
            name,
            subject,
            body_html,
            body_text,
            reply_to,
            attachment_name,
            attachment_content,
            attachment_id: attachment_id !== undefined ? attachment_id : campaign.attachment_id,
            attachment_format: attachment_format || campaign.attachment_format || 'html',
            attachment_custom_name: attachment_custom_name !== undefined ? attachment_custom_name : campaign.attachment_custom_name,
            smtp_config_id,
            // Rotation fields
            subjects_list: subjects_list !== undefined ? JSON.stringify(subjects_list) : campaign.subjects_list,
            sender_names_list: sender_names_list !== undefined ? JSON.stringify(sender_names_list) : campaign.sender_names_list,
            cta_links_list: cta_links_list !== undefined ? JSON.stringify(cta_links_list) : campaign.cta_links_list,
            smtp_ids_list: smtp_ids_list !== undefined ? JSON.stringify(smtp_ids_list) : campaign.smtp_ids_list,
            rotate_subjects: rotate_subjects !== undefined ? (rotate_subjects ? 1 : 0) : campaign.rotate_subjects,
            rotate_senders: rotate_senders !== undefined ? (rotate_senders ? 1 : 0) : campaign.rotate_senders,
            rotate_cta: rotate_cta !== undefined ? (rotate_cta ? 1 : 0) : campaign.rotate_cta,
            rotate_smtp: rotate_smtp !== undefined ? (rotate_smtp ? 1 : 0) : campaign.rotate_smtp,
            smtp_rotation_type: smtp_rotation_type || campaign.smtp_rotation_type || 'round_robin'
        });

        // Reset campaign to draft and reset all recipients to pending so it can be re-sent
        if (campaign.status !== 'draft') {
            campaignDb.updateStatus(id, 'draft');
            campaignDb.update(id, { sent_count: 0, failed_count: 0 });
            recipientDb.resetAllStatus(id);
        }

        res.json({ message: 'Campaign updated' });
    } catch (error) {
        console.error('Update campaign error:', error);
        res.status(500).json({ error: 'Failed to update campaign' });
    }
});

/**
 * DELETE /api/user/campaigns/:id
 * Delete campaign
 */
router.delete('/campaigns/:id', (req, res) => {
    try {
        const { id } = req.params;
        
        // Verify ownership
        const campaign = campaignDb.findById(id);
        if (!campaign || campaign.user_id !== req.user.id) {
            return res.status(404).json({ error: 'Campaign not found' });
        }
        
        // Can't delete if sending
        if (campaign.status === 'sending') {
            return res.status(400).json({ error: 'Cannot delete campaign while sending' });
        }
        
        campaignDb.delete(id);
        
        res.json({ message: 'Campaign deleted' });
    } catch (error) {
        console.error('Delete campaign error:', error);
        res.status(500).json({ error: 'Failed to delete campaign' });
    }
});

/**
 * POST /api/user/campaigns/:id/reset
 * Reset a campaign for resending
 */
router.post('/campaigns/:id/reset', (req, res) => {
    try {
        const { id } = req.params;
        
        // Verify ownership
        const campaign = campaignDb.findById(id);
        if (!campaign || campaign.user_id !== req.user.id) {
            return res.status(404).json({ error: 'Campaign not found' });
        }
        
        // Only allow resending completed/sent campaigns
        if (!['sent', 'completed', 'paused', 'failed'].includes(campaign.status)) {
            return res.status(400).json({ error: 'Can only reset completed, paused, or failed campaigns' });
        }
        
        // Reset campaign status to draft
        campaignDb.update(id, { 
            status: 'draft',
            sent_count: 0,
            failed_count: 0,
            completed_at: null
        });
        
        // Reset all recipients to pending
        recipientDb.resetForCampaign(id);
        
        res.json({ success: true, message: 'Campaign reset for resending' });
    } catch (error) {
        console.error('Reset campaign error:', error);
        res.status(500).json({ error: 'Failed to reset campaign' });
    }
});

/**
 * POST /api/user/campaigns/:id/schedule
 * Schedule a campaign to send at a future time.
 * Body: { scheduled_at: "2026-04-11T15:00:00" }  (null to cancel)
 */
router.post('/campaigns/:id/schedule', (req, res) => {
    try {
        const { id } = req.params;
        const { scheduled_at } = req.body;

        const campaign = campaignDb.findById(id);
        if (!campaign || campaign.user_id !== req.user.id) {
            return res.status(404).json({ error: 'Campaign not found' });
        }
        if (campaign.status === 'sending') {
            return res.status(400).json({ error: 'Cannot schedule while sending' });
        }

        // null clears the schedule
        if (scheduled_at === null || scheduled_at === '') {
            campaignDb.update(id, { scheduled_at: null });
            return res.json({ message: 'Schedule cleared', scheduled_at: null });
        }

        // Validate — must parse as a date and be in the future
        const date = new Date(scheduled_at);
        if (isNaN(date.getTime())) {
            return res.status(400).json({ error: 'Invalid scheduled_at date' });
        }

        // Must have recipients
        if ((campaign.total_recipients || 0) <= 0) {
            return res.status(400).json({ error: 'Add recipients before scheduling' });
        }

        // Reset to draft in case it was paused/failed
        if (campaign.status !== 'draft') {
            campaignDb.updateStatus(id, 'draft');
        }

        // Store as SQLite-friendly ISO string
        const isoString = date.toISOString().replace('T', ' ').replace('Z', '').slice(0, 19);
        campaignDb.update(id, { scheduled_at: isoString });

        res.json({ message: 'Campaign scheduled', scheduled_at: isoString });
    } catch (error) {
        console.error('Schedule campaign error:', error);
        res.status(500).json({ error: 'Failed to schedule campaign' });
    }
});

/**
 * POST /api/user/campaigns/preview
 * Render a campaign as it would appear, without sending. Accepts either:
 *   - { campaign_id: <id> }                       — load from DB
 *   - { subject, body_html, body_text }           — preview unsaved draft
 * Plus optional sample_recipient: { email, name }
 *
 * Returns { subject, html, text, score: { score, level, levelText, flags, reasons } }
 */
router.post('/campaigns/preview', (req, res) => {
    try {
        const { campaign_id, subject, body_html, body_text, sample_recipient } = req.body;

        let campaign;
        if (campaign_id) {
            campaign = campaignDb.findById(campaign_id);
            if (!campaign || campaign.user_id !== req.user.id) {
                return res.status(404).json({ error: 'Campaign not found' });
            }
        } else {
            campaign = {
                subject: subject || '',
                body_html: body_html || '',
                body_text: body_text || ''
            };
        }

        const preview = buildCampaignPreview(campaign, sample_recipient);
        res.json(preview);
    } catch (error) {
        console.error('Preview error:', error);
        res.status(500).json({ error: 'Failed to build preview' });
    }
});

/**
 * POST /api/user/campaigns/:id/clone
 * Duplicate a campaign as a new draft (no recipients copied)
 */
router.post('/campaigns/:id/clone', (req, res) => {
    try {
        const { id } = req.params;
        const newCampaign = campaignDb.clone(id, req.user.id);
        if (!newCampaign) {
            return res.status(404).json({ error: 'Campaign not found' });
        }
        res.status(201).json({
            message: 'Campaign cloned',
            campaign: newCampaign
        });
    } catch (error) {
        console.error('Clone campaign error:', error);
        res.status(500).json({ error: 'Failed to clone campaign' });
    }
});

/**
 * POST /api/user/campaigns/:id/recipients
 * Add recipients to campaign
 */
router.post('/campaigns/:id/recipients', (req, res) => {
    try {
        const { id } = req.params;
        const { recipients } = req.body; // Array of { email, name? }

        // Verify ownership
        const campaign = campaignDb.findById(id);
        if (!campaign || campaign.user_id !== req.user.id) {
            return res.status(404).json({ error: 'Campaign not found' });
        }

        if (campaign.status !== 'draft') {
            campaignDb.updateStatus(id, 'draft');
        }

        if (!Array.isArray(recipients) || recipients.length === 0) {
            return res.status(400).json({ error: 'Recipients array is required' });
        }

        // Validate + dedupe (within batch AND against existing recipients)
        const result = validateAndDedupeRecipients(id, recipients);

        if (result.valid.length === 0) {
            return res.status(400).json({
                error: 'No valid new email addresses to add',
                ...result.summary
            });
        }

        recipientDb.bulkCreate(id, result.valid);

        res.json({
            message: `Added ${result.summary.imported} recipients`,
            ...result.summary
        });
    } catch (error) {
        console.error('Add recipients error:', error);
        res.status(500).json({ error: 'Failed to add recipients' });
    }
});

/**
 * PUT /api/user/campaigns/:id/recipients
 * Replace all recipients for a campaign
 */
router.put('/campaigns/:id/recipients', (req, res) => {
    try {
        const { id } = req.params;
        const { recipients } = req.body;

        const campaign = campaignDb.findById(id);
        if (!campaign || campaign.user_id !== req.user.id) {
            return res.status(404).json({ error: 'Campaign not found' });
        }

        if (!Array.isArray(recipients) || recipients.length === 0) {
            return res.status(400).json({ error: 'Recipients array is required' });
        }

        // For replace mode, skip the "already exists" check because we're wiping first
        const result = validateAndDedupeRecipients(null, recipients, { skipExistingCheck: true });

        if (result.valid.length === 0) {
            return res.status(400).json({
                error: 'No valid email addresses provided',
                ...result.summary
            });
        }

        // Delete old recipients and reset counters
        recipientDb.deleteByampaignId(id);
        campaignDb.update(id, { total_recipients: 0, sent_count: 0, failed_count: 0 });
        campaignDb.updateStatus(id, 'draft');

        recipientDb.bulkCreate(id, result.valid);

        res.json({
            message: `Replaced with ${result.summary.imported} recipients`,
            ...result.summary
        });
    } catch (error) {
        console.error('Replace recipients error:', error);
        res.status(500).json({ error: 'Failed to replace recipients' });
    }
});

/**
 * DELETE /api/user/campaigns/:id/recipients
 * Clear all recipients from campaign
 */
router.delete('/campaigns/:id/recipients', (req, res) => {
    try {
        const { id } = req.params;
        
        // Verify ownership
        const campaign = campaignDb.findById(id);
        if (!campaign || campaign.user_id !== req.user.id) {
            return res.status(404).json({ error: 'Campaign not found' });
        }
        
        if (campaign.status !== 'draft') {
            return res.status(400).json({ error: 'Can only clear recipients from draft campaigns' });
        }
        
        recipientDb.deleteByampaignId(id);
        campaignDb.update(id, { total_recipients: 0 });
        
        res.json({ message: 'Recipients cleared' });
    } catch (error) {
        console.error('Clear recipients error:', error);
        res.status(500).json({ error: 'Failed to clear recipients' });
    }
});

// ============ Dashboard & Stats Routes ============

/**
 * GET /api/user/dashboard
 * Get dashboard stats
 */
router.get('/dashboard', (req, res) => {
    try {
        const campaignStats = campaignDb.getStats(req.user.id);
        const emailStats = emailLogDb.getStatsByUserId(req.user.id);
        const recentCampaigns = campaignDb.findByUserId(req.user.id, 5, 0);
        const smtpConfigs = smtpDb.findByUserId(req.user.id);
        
        res.json({
            stats: {
                campaigns: campaignStats
            },
            email_history: emailStats,
            recent_campaigns: recentCampaigns,
            smtp_count: smtpConfigs.length
        });
    } catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).json({ error: 'Failed to get dashboard data' });
    }
});

/**
 * GET /api/user/logs
 * Get email logs
 */
router.get('/logs', (req, res) => {
    try {
        const { limit = 100, offset = 0 } = req.query;
        const logs = emailLogDb.findByUserId(req.user.id, parseInt(limit), parseInt(offset));
        
        res.json({ logs });
    } catch (error) {
        console.error('Get logs error:', error);
        res.status(500).json({ error: 'Failed to get logs' });
    }
});

// ============ Attachment Library Routes ============

/**
 * GET /api/user/attachments
 * Get all attachments for current user
 */
router.get('/attachments', (req, res) => {
    try {
        const attachments = attachmentDb.findAllByUserId(req.user.id);
        res.json({ attachments });
    } catch (error) {
        console.error('Get attachments error:', error);
        res.status(500).json({ error: 'Failed to get attachments' });
    }
});

/**
 * GET /api/user/attachments/:id
 * Get single attachment
 */
router.get('/attachments/:id', (req, res) => {
    try {
        const { id } = req.params;
        const attachment = attachmentDb.findById(id);
        
        if (!attachment || attachment.user_id !== req.user.id) {
            return res.status(404).json({ error: 'Attachment not found' });
        }
        
        res.json({ attachment });
    } catch (error) {
        console.error('Get attachment error:', error);
        res.status(500).json({ error: 'Failed to get attachment' });
    }
});

/**
 * POST /api/user/attachments
 * Create new attachment
 */
router.post('/attachments', (req, res) => {
    try {
        const { name, description, html_content, tags, file_name, file_content, file_type, file_size } = req.body;

        if (!name) {
            return res.status(400).json({ error: 'Name is required' });
        }

        if (!html_content && !file_content) {
            return res.status(400).json({ error: 'HTML content or file upload is required' });
        }

        const attachData = {
            user_id: req.user.id,
            name,
            description,
            html_content: html_content || null,
            tags
        };

        // Handle file upload (base64)
        if (file_content) {
            attachData.file_name = file_name;
            attachData.file_content = Buffer.from(file_content, 'base64');
            attachData.file_type = file_type;
            attachData.file_size = file_size || 0;
        }

        const attachment = attachmentDb.create(attachData);

        // Don't send file_content back in response
        delete attachment.file_content;

        res.status(201).json({
            message: 'Attachment created',
            attachment
        });
    } catch (error) {
        console.error('Create attachment error:', error);
        res.status(500).json({ error: 'Failed to create attachment' });
    }
});

/**
 * PUT /api/user/attachments/:id
 * Update attachment
 */
router.put('/attachments/:id', (req, res) => {
    try {
        const { id } = req.params;
        const { name, description, html_content, tags, is_active, file_name, file_content, file_type, file_size } = req.body;

        const attachment = attachmentDb.findById(id);
        if (!attachment || attachment.user_id !== req.user.id) {
            return res.status(404).json({ error: 'Attachment not found' });
        }

        const updateData = {};
        if (name !== undefined) updateData.name = name;
        if (description !== undefined) updateData.description = description;
        if (html_content !== undefined) updateData.html_content = html_content;
        if (tags !== undefined) updateData.tags = tags;
        if (is_active !== undefined) updateData.is_active = is_active ? 1 : 0;
        if (file_content) {
            updateData.file_name = file_name;
            updateData.file_content = Buffer.from(file_content, 'base64');
            updateData.file_type = file_type;
            updateData.file_size = file_size || 0;
        }

        attachmentDb.update(id, updateData);
        
        res.json({ message: 'Attachment updated' });
    } catch (error) {
        console.error('Update attachment error:', error);
        res.status(500).json({ error: 'Failed to update attachment' });
    }
});

/**
 * DELETE /api/user/attachments/:id
 * Delete attachment
 */
router.delete('/attachments/:id', (req, res) => {
    try {
        const { id } = req.params;
        
        const attachment = attachmentDb.findById(id);
        if (!attachment || attachment.user_id !== req.user.id) {
            return res.status(404).json({ error: 'Attachment not found' });
        }
        
        attachmentDb.delete(id);
        
        res.json({ message: 'Attachment deleted' });
    } catch (error) {
        console.error('Delete attachment error:', error);
        res.status(500).json({ error: 'Failed to delete attachment' });
    }
});

/**
 * POST /api/user/attachments/:id/preview
 * Preview attachment in different formats
 */
router.post('/attachments/:id/preview', async (req, res) => {
    try {
        const { id } = req.params;
        const { format = 'html' } = req.body;
        
        const attachment = attachmentDb.findById(id);
        if (!attachment || attachment.user_id !== req.user.id) {
            return res.status(404).json({ error: 'Attachment not found' });
        }
        
        // Convert to requested format
        const converted = await convertAttachment(
            attachment.html_content,
            format,
            attachment.name.replace(/[^a-zA-Z0-9]/g, '_')
        );
        
        res.json({
            format,
            filename: converted.filename,
            mimeType: converted.mimeType,
            content: converted.content // Base64
        });
    } catch (error) {
        console.error('Preview attachment error:', error);
        res.status(500).json({ error: 'Failed to preview attachment: ' + error.message });
    }
});

/**
 * POST /api/user/attachments/:id/convert
 * Convert and download attachment in specified format
 */
router.post('/attachments/:id/convert', async (req, res) => {
    try {
        const { id } = req.params;
        const { format = 'html' } = req.body;
        
        const attachment = attachmentDb.findById(id);
        if (!attachment || attachment.user_id !== req.user.id) {
            return res.status(404).json({ error: 'Attachment not found' });
        }
        
        const converted = await convertAttachment(
            attachment.html_content,
            format,
            attachment.name.replace(/[^a-zA-Z0-9]/g, '_')
        );
        
        const buffer = Buffer.from(converted.content, 'base64');
        
        res.setHeader('Content-Type', converted.mimeType);
        res.setHeader('Content-Disposition', `attachment; filename="${converted.filename}"`);
        res.send(buffer);
    } catch (error) {
        console.error('Convert attachment error:', error);
        res.status(500).json({ error: 'Failed to convert attachment: ' + error.message });
    }
});

// ============ Settings Routes ============

// --- Subject Lists ---
router.get('/settings/subjects', (req, res) => {
    try {
        const lists = subjectListDb.findByUserId(req.user.id);
        res.json({ lists: lists.map(l => ({ ...l, subjects: JSON.parse(l.subjects) })) });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get subject lists' });
    }
});

router.post('/settings/subjects', (req, res) => {
    try {
        const { name, subjects } = req.body;
        if (!name || !subjects || !Array.isArray(subjects)) {
            return res.status(400).json({ error: 'Name and subjects array required' });
        }
        const list = subjectListDb.create({ user_id: req.user.id, name, subjects: JSON.stringify(subjects) });
        res.status(201).json({ list: { ...list, subjects } });
    } catch (error) {
        res.status(500).json({ error: 'Failed to create subject list' });
    }
});

router.put('/settings/subjects/:id', (req, res) => {
    try {
        const { id } = req.params;
        const { name, subjects } = req.body;
        const list = subjectListDb.findById(id);
        if (!list || list.user_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
        subjectListDb.update(id, { name, subjects: JSON.stringify(subjects) });
        res.json({ message: 'Updated' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update' });
    }
});

router.delete('/settings/subjects/:id', (req, res) => {
    try {
        const list = subjectListDb.findById(req.params.id);
        if (!list || list.user_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
        subjectListDb.delete(req.params.id);
        res.json({ message: 'Deleted' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete' });
    }
});

// --- Sender Lists ---
router.get('/settings/senders', (req, res) => {
    try {
        const lists = senderListDb.findByUserId(req.user.id);
        res.json({ lists: lists.map(l => ({ ...l, senders: JSON.parse(l.senders) })) });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get sender lists' });
    }
});

router.post('/settings/senders', (req, res) => {
    try {
        const { name, senders } = req.body;
        if (!name || !senders || !Array.isArray(senders)) {
            return res.status(400).json({ error: 'Name and senders array required' });
        }
        const list = senderListDb.create({ user_id: req.user.id, name, senders: JSON.stringify(senders) });
        res.status(201).json({ list: { ...list, senders } });
    } catch (error) {
        res.status(500).json({ error: 'Failed to create sender list' });
    }
});

router.put('/settings/senders/:id', (req, res) => {
    try {
        const { id } = req.params;
        const { name, senders } = req.body;
        const list = senderListDb.findById(id);
        if (!list || list.user_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
        senderListDb.update(id, { name, senders: JSON.stringify(senders) });
        res.json({ message: 'Updated' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update' });
    }
});

router.delete('/settings/senders/:id', (req, res) => {
    try {
        const list = senderListDb.findById(req.params.id);
        if (!list || list.user_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
        senderListDb.delete(req.params.id);
        res.json({ message: 'Deleted' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete' });
    }
});

// --- Link Lists ---
router.get('/settings/links', (req, res) => {
    try {
        const lists = linkListDb.findByUserId(req.user.id);
        res.json({ lists: lists.map(l => ({ ...l, links: JSON.parse(l.links) })) });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get link lists' });
    }
});

router.post('/settings/links', (req, res) => {
    try {
        const { name, links } = req.body;
        if (!name || !links || !Array.isArray(links)) {
            return res.status(400).json({ error: 'Name and links array required' });
        }
        const list = linkListDb.create({ user_id: req.user.id, name, links: JSON.stringify(links) });
        res.status(201).json({ list: { ...list, links } });
    } catch (error) {
        res.status(500).json({ error: 'Failed to create link list' });
    }
});

router.put('/settings/links/:id', (req, res) => {
    try {
        const { id } = req.params;
        const { name, links } = req.body;
        const list = linkListDb.findById(id);
        if (!list || list.user_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
        linkListDb.update(id, { name, links: JSON.stringify(links) });
        res.json({ message: 'Updated' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update' });
    }
});

router.delete('/settings/links/:id', (req, res) => {
    try {
        const list = linkListDb.findById(req.params.id);
        if (!list || list.user_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
        linkListDb.delete(req.params.id);
        res.json({ message: 'Deleted' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete' });
    }
});

// --- Recipient Lists ---
router.get('/settings/recipients', (req, res) => {
    try {
        const lists = recipientListDb.findByUserId(req.user.id);
        res.json({ lists: lists.map(l => ({ ...l, recipients: JSON.parse(l.recipients) })) });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get recipient lists' });
    }
});

router.post('/settings/recipients', (req, res) => {
    try {
        const { name, description, recipients } = req.body;
        if (!name || !recipients || !Array.isArray(recipients)) {
            return res.status(400).json({ error: 'Name and recipients array required' });
        }
        const list = recipientListDb.create({ 
            user_id: req.user.id, 
            name, 
            description,
            recipients 
        });
        res.status(201).json({ list: { ...list, recipients } });
    } catch (error) {
        console.error('Create recipient list error:', error);
        res.status(500).json({ error: 'Failed to create recipient list' });
    }
});

router.put('/settings/recipients/:id', (req, res) => {
    try {
        const { id } = req.params;
        const { name, description, recipients } = req.body;
        const list = recipientListDb.findById(id);
        if (!list || list.user_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
        recipientListDb.update(id, { name, description, recipients });
        res.json({ message: 'Updated' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update' });
    }
});

router.delete('/settings/recipients/:id', (req, res) => {
    try {
        const list = recipientListDb.findById(req.params.id);
        if (!list || list.user_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
        recipientListDb.delete(req.params.id);
        res.json({ message: 'Deleted' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete' });
    }
});

/**
 * POST /api/user/settings/recipients/:id/clean
 * Body: { remove_unsubscribes, remove_duplicates, remove_invalid, remove_failed }
 *
 * Filters the saved recipient list and saves the cleaned version. Returns
 * a breakdown of what was removed so the UI can display it.
 */
router.post('/settings/recipients/:id/clean', (req, res) => {
    try {
        const { id } = req.params;
        const opts = req.body || {};
        const list = recipientListDb.findById(id);
        if (!list || list.user_id !== req.user.id) return res.status(404).json({ error: 'Not found' });

        // Recipients are stored as a JSON string. Items can be plain strings (just emails)
        // or objects with at least an `email` field plus optional custom fields.
        let recipients;
        try { recipients = JSON.parse(list.recipients) || []; }
        catch { recipients = []; }

        const getEmail = (r) => (typeof r === 'string' ? r : r?.email || '').toLowerCase().trim();
        const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        const removed = { invalid: 0, duplicates: 0, unsubscribed: 0, failed: 0 };
        let cleaned = recipients;

        // 1. Invalid emails
        if (opts.remove_invalid) {
            const before = cleaned.length;
            cleaned = cleaned.filter(r => EMAIL_RX.test(getEmail(r)));
            removed.invalid = before - cleaned.length;
        }

        // 2. Duplicates (case-insensitive, keep first occurrence)
        if (opts.remove_duplicates) {
            const seen = new Set();
            const before = cleaned.length;
            cleaned = cleaned.filter(r => {
                const e = getEmail(r);
                if (seen.has(e)) return false;
                seen.add(e);
                return true;
            });
            removed.duplicates = before - cleaned.length;
        }

        // 3. Unsubscribed addresses
        if (opts.remove_unsubscribes) {
            const allEmails = cleaned.map(getEmail);
            const unsubSet = unsubscribeDb.findUnsubscribedSet(req.user.id, allEmails);
            const before = cleaned.length;
            cleaned = cleaned.filter(r => !unsubSet.has(getEmail(r)));
            removed.unsubscribed = before - cleaned.length;
        }

        // 4. Addresses that have failed N+ times in email_logs
        if (opts.remove_failed) {
            const minFails = parseInt(opts.failed_threshold) || 2;
            const allEmails = cleaned.map(getEmail);
            if (allEmails.length > 0) {
                const failSet = findRepeatedlyFailedEmails(req.user.id, allEmails, minFails);
                const before = cleaned.length;
                cleaned = cleaned.filter(r => !failSet.has(getEmail(r)));
                removed.failed = before - cleaned.length;
            }
        }

        // Persist
        recipientListDb.update(id, {
            name: list.name,
            description: list.description,
            recipients: JSON.stringify(cleaned)
        });

        res.json({
            message: 'List cleaned',
            removed,
            remaining: cleaned.length,
            original: recipients.length
        });
    } catch (error) {
        console.error('Clean recipient list error:', error);
        res.status(500).json({ error: 'Failed to clean list' });
    }
});

// --- Proxy Configs ---
router.get('/settings/proxies', (req, res) => {
    try {
        const proxies = proxyDb.findByUserId(req.user.id);
        // Hide passwords
        res.json({ proxies: proxies.map(p => ({ ...p, password: p.password ? '••••••' : null })) });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get proxies' });
    }
});

router.post('/settings/proxies', (req, res) => {
    try {
        const { name, proxy_type, host, port, username, password } = req.body;
        if (!name || !proxy_type || !host || !port) {
            return res.status(400).json({ error: 'Name, type, host, and port required' });
        }
        if (!['http', 'https', 'socks4', 'socks5'].includes(proxy_type)) {
            return res.status(400).json({ error: 'Invalid proxy type' });
        }
        const proxy = proxyDb.create({ user_id: req.user.id, name, proxy_type, host, port, username, password });
        res.status(201).json({ proxy: { ...proxy, password: password ? '••••••' : null } });
    } catch (error) {
        res.status(500).json({ error: 'Failed to create proxy' });
    }
});

router.put('/settings/proxies/:id', (req, res) => {
    try {
        const { id } = req.params;
        const proxy = proxyDb.findById(id);
        if (!proxy || proxy.user_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
        
        const { name, proxy_type, host, port, username, password, is_active } = req.body;
        const updateData = {};
        if (name !== undefined) updateData.name = name;
        if (proxy_type !== undefined) updateData.proxy_type = proxy_type;
        if (host !== undefined) updateData.host = host;
        if (port !== undefined) updateData.port = port;
        if (username !== undefined) updateData.username = username;
        if (password !== undefined) updateData.password = password;
        if (is_active !== undefined) updateData.is_active = is_active ? 1 : 0;
        
        proxyDb.update(id, updateData);
        res.json({ message: 'Updated' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update' });
    }
});

router.delete('/settings/proxies/:id', (req, res) => {
    try {
        const proxy = proxyDb.findById(req.params.id);
        if (!proxy || proxy.user_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
        proxyDb.delete(req.params.id);
        res.json({ message: 'Deleted' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete' });
    }
});

router.post('/settings/proxies/:id/toggle', (req, res) => {
    try {
        const proxy = proxyDb.findById(req.params.id);
        if (!proxy || proxy.user_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
        proxyDb.toggleActive(req.params.id);
        res.json({ message: 'Toggled', is_active: !proxy.is_active });
    } catch (error) {
        res.status(500).json({ error: 'Failed to toggle' });
    }
});

// --- Sending Settings ---
router.get('/settings/sending', (req, res) => {
    try {
        let settings = sendingSettingsDb.findByUserId(req.user.id);
        if (!settings) {
            settings = { threads: 1, delay_min: 1000, delay_max: 3000, retry_failed: 0, use_proxy: 0 };
        }
        res.json({ settings });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get settings' });
    }
});

router.put('/settings/sending', (req, res) => {
    try {
        const { threads, delay_min, delay_max, retry_failed, use_proxy } = req.body;

        // Coerce + clamp. Use Number() and isNaN checks so that 0 is preserved
        // (don't use `|| fallback` which silently replaces 0 with the default).
        const threadsN = Number(threads);
        const delayMinN = Number(delay_min);
        const delayMaxN = Number(delay_max);

        sendingSettingsDb.upsert(req.user.id, {
            threads: Math.min(Math.max(1, isNaN(threadsN) ? 1 : threadsN), 10), // 1–10
            delay_min: Math.max(0, isNaN(delayMinN) ? 1000 : delayMinN),
            delay_max: Math.max(0, isNaN(delayMaxN) ? (isNaN(delayMinN) ? 1000 : delayMinN) : delayMaxN),
            retry_failed: !!retry_failed,
            use_proxy: !!use_proxy
        });
        res.json({ message: 'Settings saved' });
    } catch (error) {
        console.error('Save sending settings error:', error);
        res.status(500).json({ error: 'Failed to save settings' });
    }
});

// --- Get All Settings (for dropdowns) ---
router.get('/settings/all', (req, res) => {
    try {
        const subjectLists = subjectListDb.findByUserId(req.user.id).map(l => ({ ...l, subjects: JSON.parse(l.subjects) }));
        const senderLists = senderListDb.findByUserId(req.user.id).map(l => ({ ...l, senders: JSON.parse(l.senders) }));
        const linkLists = linkListDb.findByUserId(req.user.id).map(l => ({ ...l, links: JSON.parse(l.links) }));
        const recipientLists = recipientListDb.findByUserId(req.user.id).map(l => ({ ...l, recipients: JSON.parse(l.recipients) }));
        const proxies = proxyDb.findByUserId(req.user.id).map(p => ({ ...p, password: p.password ? '••••••' : null }));
        let sendingSettings = sendingSettingsDb.findByUserId(req.user.id);
        if (!sendingSettings) {
            sendingSettings = { threads: 1, delay_min: 1000, delay_max: 3000, retry_failed: 0, use_proxy: 0 };
        }
        
        res.json({ subjectLists, senderLists, linkLists, recipientLists, proxies, sendingSettings });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get settings' });
    }
});

// --- Deliverability Test Settings ---
router.get('/settings/test', (req, res) => {
    try {
        const settings = userDb.getTestSettings(req.user.id);
        res.json(settings);
    } catch (error) {
        console.error('Get test settings error:', error);
        res.status(500).json({ error: 'Failed to get test settings' });
    }
});

router.put('/settings/test', (req, res) => {
    try {
        const { test_email, test_interval, test_enabled } = req.body;
        
        // Validate test email if provided
        if (test_email && !test_email.includes('@')) {
            return res.status(400).json({ error: 'Invalid test email address' });
        }
        
        // Validate interval (minimum 10 emails)
        const interval = parseInt(test_interval) || 50;
        if (interval < 10) {
            return res.status(400).json({ error: 'Test interval must be at least 10 emails' });
        }
        
        userDb.updateTestSettings(req.user.id, {
            test_email: test_email || null,
            test_interval: interval,
            test_enabled: test_enabled || false
        });
        
        res.json({ message: 'Test settings saved' });
    } catch (error) {
        console.error('Save test settings error:', error);
        res.status(500).json({ error: 'Failed to save test settings' });
    }
});

// --- Send Manual Test Email ---
router.post('/settings/test/send', async (req, res) => {
    try {
        const { test_email, campaign_id } = req.body;
        
        if (!test_email || !test_email.includes('@')) {
            return res.status(400).json({ error: 'Valid test email is required' });
        }
        
        // Get user's active SMTP
        const smtpConfig = smtpDb.findActiveByUserId(req.user.id);
        if (!smtpConfig) {
            return res.status(400).json({ error: 'No active SMTP configuration found' });
        }
        
        // Get campaign content if specified
        let subject = '🧪 Test Email - Deliverability Check';
        let htmlBody = `
            <div style="font-family: Arial, sans-serif; padding: 20px;">
                <h2>✅ Test Email Delivered Successfully</h2>
                <p>This is a test email to verify deliverability.</p>
                <p><strong>Sent at:</strong> ${new Date().toLocaleString()}</p>
                <p><strong>SMTP:</strong> ${smtpConfig.name} (${smtpConfig.host})</p>
                <hr>
                <p style="color: #666; font-size: 12px;">
                    If you received this in your inbox (not spam), your emails are being delivered correctly!
                </p>
            </div>
        `;
        
        if (campaign_id) {
            const campaign = campaignDb.findById(campaign_id);
            if (campaign && campaign.user_id === req.user.id) {
                subject = `🧪 TEST: ${campaign.subject}`;
                htmlBody = campaign.body_html || htmlBody;
            }
        }
        
        // Create transporter
        const { decrypt } = await import('../services/encryption.mjs');
        const nodemailer = await import('nodemailer');
        
        const transporter = nodemailer.default.createTransport({
            host: smtpConfig.host,
            port: smtpConfig.port,
            secure: smtpConfig.secure === 1,
            auth: {
                user: smtpConfig.username,
                pass: decrypt(smtpConfig.password_encrypted)
            }
        });
        
        // Send test email
        await transporter.sendMail({
            from: `"${smtpConfig.from_name || 'Test'}" <${smtpConfig.from_email || smtpConfig.username}>`,
            to: test_email,
            subject: subject,
            html: htmlBody
        });
        
        res.json({ message: `Test email sent to ${test_email}` });
    } catch (error) {
        console.error('Send test email error:', error);
        res.status(500).json({ error: error.message || 'Failed to send test email' });
    }
});

// ===== EMAIL TEMPLATES (AI-generated letters library) =====

// Get all templates for user
router.get('/templates', (req, res) => {
    try {
        const templates = emailTemplateDb.findByUserId(req.user.id);
        res.json({ templates });
    } catch (error) {
        console.error('Error fetching templates:', error);
        res.status(500).json({ error: 'Failed to fetch templates' });
    }
});

// Get single template
router.get('/templates/:id', (req, res) => {
    try {
        const { id } = req.params;
        const template = emailTemplateDb.findById(id);
        
        if (!template || template.user_id !== req.user.id) {
            return res.status(404).json({ error: 'Template not found' });
        }
        
        res.json({ template });
    } catch (error) {
        console.error('Error fetching template:', error);
        res.status(500).json({ error: 'Failed to fetch template' });
    }
});

// Create template
router.post('/templates', (req, res) => {
    try {
        const { name, description, html_content, tags } = req.body;
        
        if (!name || !html_content) {
            return res.status(400).json({ error: 'Name and HTML content are required' });
        }
        
        const template = emailTemplateDb.create({
            user_id: req.user.id,
            name,
            description: description || '',
            html_content,
            tags: tags || ''
        });
        
        res.json({ message: 'Template saved', template });
    } catch (error) {
        console.error('Error creating template:', error);
        res.status(500).json({ error: 'Failed to save template' });
    }
});

// Update template
router.put('/templates/:id', (req, res) => {
    try {
        const { id } = req.params;
        const { name, description, html_content, tags, is_active } = req.body;
        
        const template = emailTemplateDb.findById(id);
        if (!template || template.user_id !== req.user.id) {
            return res.status(404).json({ error: 'Template not found' });
        }
        
        const updateData = {};
        if (name !== undefined) updateData.name = name;
        if (description !== undefined) updateData.description = description;
        if (html_content !== undefined) updateData.html_content = html_content;
        if (tags !== undefined) updateData.tags = tags;
        if (is_active !== undefined) updateData.is_active = is_active ? 1 : 0;
        
        emailTemplateDb.update(id, updateData);
        
        res.json({ message: 'Template updated' });
    } catch (error) {
        console.error('Error updating template:', error);
        res.status(500).json({ error: 'Failed to update template' });
    }
});

// Delete template
router.delete('/templates/:id', (req, res) => {
    try {
        const { id } = req.params;
        
        const template = emailTemplateDb.findById(id);
        if (!template || template.user_id !== req.user.id) {
            return res.status(404).json({ error: 'Template not found' });
        }
        
        emailTemplateDb.delete(id);

        res.json({ message: 'Template deleted' });
    } catch (error) {
        console.error('Error deleting template:', error);
        res.status(500).json({ error: 'Failed to delete template' });
    }
});

// ============ Unsubscribes management ============

/**
 * GET /api/user/unsubscribes
 * List all unsubscribed addresses for this user.
 */
router.get('/unsubscribes', (req, res) => {
    try {
        const list = unsubscribeDb.findByUserId(req.user.id);
        res.json({ unsubscribes: list, count: list.length });
    } catch (error) {
        console.error('Get unsubscribes error:', error);
        res.status(500).json({ error: 'Failed to load unsubscribes' });
    }
});

/**
 * POST /api/user/unsubscribes
 * Manually add an email to the unsubscribe list.
 */
router.post('/unsubscribes', (req, res) => {
    try {
        const { email } = req.body;
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ error: 'Valid email required' });
        }
        unsubscribeDb.add(req.user.id, email, null, 'manual', null);
        res.status(201).json({ message: 'Added to unsubscribe list' });
    } catch (error) {
        console.error('Add unsubscribe error:', error);
        res.status(500).json({ error: 'Failed to add unsubscribe' });
    }
});

/**
 * DELETE /api/user/unsubscribes/:email
 * Remove an email from the unsubscribe list (re-allow sending).
 */
router.delete('/unsubscribes/:email', (req, res) => {
    try {
        const email = decodeURIComponent(req.params.email);
        unsubscribeDb.remove(req.user.id, email);
        res.json({ message: 'Removed from unsubscribe list' });
    } catch (error) {
        console.error('Remove unsubscribe error:', error);
        res.status(500).json({ error: 'Failed to remove unsubscribe' });
    }
});

// ============ Backup / Restore ============

/**
 * GET /api/user/backup/export
 * Returns a JSON envelope of all user-owned data. Sets Content-Disposition
 * so the browser triggers a file download.
 */
router.get('/backup/export', (req, res) => {
    try {
        const envelope = buildBackup(req.user.id);
        const filename = `mailflow-backup-${new Date().toISOString().slice(0, 10)}.json`;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(JSON.stringify(envelope, null, 2));
    } catch (error) {
        console.error('Backup export error:', error);
        res.status(500).json({ error: 'Failed to build backup' });
    }
});

/**
 * POST /api/user/backup/import
 * Body: { envelope: <parsed JSON>, replace_existing?: boolean }
 */
router.post('/backup/import', (req, res) => {
    try {
        const { envelope, replace_existing } = req.body;
        if (!envelope || typeof envelope !== 'object') {
            return res.status(400).json({ error: 'Missing backup envelope' });
        }
        const result = restoreBackup(req.user.id, envelope, { skipExisting: !replace_existing });
        res.json({
            message: 'Backup restored',
            ...result
        });
    } catch (error) {
        console.error('Backup import error:', error);
        res.status(400).json({ error: error.message || 'Failed to restore backup' });
    }
});

export default router;

