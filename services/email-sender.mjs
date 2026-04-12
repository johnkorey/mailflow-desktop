import nodemailer from 'nodemailer';
import { EventEmitter } from 'events';
import crypto from 'crypto';
import { faker } from '@faker-js/faker';
import QRCode from 'qrcode';
import { smtpDb, campaignDb, recipientDb, emailLogDb, userDb, attachmentDb, sendingSettingsDb, proxyDb, unsubscribeDb } from '../database/db.mjs';
import { decrypt } from './encryption.mjs';
import { convertAttachment } from './attachment-converter.mjs';
import { createApiTransport } from './api-providers.mjs';
import socks from 'socks';

// Active sending sessions
const activeSessions = new Map();

/**
 * Generate a stateless unsubscribe token. Format: base64url(payload).hmac
 * Payload = "userId:campaignId:emailLower". HMAC verifies authenticity.
 * The /u/:token route can decode this and add to the unsubscribes table.
 *
 * The full 256-bit HMAC (43 base64url chars) is emitted — earlier builds
 * truncated to 16 chars (~96 bits) which is short of modern forgery budgets.
 * The /u/:token verifier accepts BOTH the full HMAC and the legacy 16-char
 * prefix, so already-sent links in recipients' inboxes continue to work.
 */
function makeUnsubscribeToken(userId, campaignId, email) {
    const payload = `${userId}:${campaignId || 0}:${(email || '').toLowerCase().trim()}`;
    const encoded = Buffer.from(payload).toString('base64url');
    const secret = process.env.ENCRYPTION_KEY || 'unsubscribe-fallback-key';
    const sig = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
    return `${encoded}.${sig}`;
}

/**
 * Build the unsubscribe URL for a recipient. The base URL is configurable
 * via UNSUBSCRIBE_BASE_URL env var (e.g. https://your-domain.com), defaulting
 * to http://localhost:3000 for desktop use.
 */
function buildUnsubscribeUrl(userId, campaignId, email) {
    const base = process.env.UNSUBSCRIBE_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
    return `${base}/u/${makeUnsubscribeToken(userId, campaignId, email)}`;
}

/**
 * Detect permanent SMTP failures that should NOT be retried.
 * Common permanent errors: 550 (mailbox doesn't exist), 553 (bad syntax),
 * 554 (transaction failed), "invalid address" messages, "no such user".
 */
function isPermanentFailure(errorMessage) {
    if (!errorMessage) return false;
    const msg = String(errorMessage).toLowerCase();
    // 5xx SMTP codes (except 421 which is transient)
    if (/\b5[05][0-9]\b/.test(msg)) return true;
    // Common permanent-failure phrases
    const permanentPhrases = [
        'invalid address', 'invalid recipient', 'no such user',
        'user unknown', 'mailbox not found', 'mailbox unavailable',
        'recipient rejected', 'address rejected', 'does not exist',
        'relay access denied', 'sender address rejected'
    ];
    return permanentPhrases.some(phrase => msg.includes(phrase));
}

/**
 * Email Sender class with event emitter for progress tracking
 */
export class EmailSender extends EventEmitter {
    constructor(userId, campaignId) {
        super();
        this.userId = userId;
        this.campaignId = campaignId;
        this.isRunning = false;
        this.isPaused = false;
        this.sentCount = 0;
        this.failedCount = 0;
        this.totalCount = 0;
        
        // Rotation tracking
        this.rotationIndex = 0;
        this.smtpConfigs = [];
        this.transporters = [];
        this.subjectsList = [];
        this.senderNamesList = [];
        this.ctaLinksList = [];
        
        // Deliverability testing
        this.testSettings = null;
        this.emailsSinceLastTest = 0;
    }
    
    /**
     * Get next item in rotation
     */
    getRotatedItem(list, index) {
        if (!list || list.length === 0) return null;
        return list[index % list.length];
    }
    
    /**
     * Detect email category from subject
     */
    detectEmailCategory(subject) {
        const subjectLower = (subject || '').toLowerCase();
        
        const categories = {
            'welcome': ['welcome', 'hello', 'getting started', 'onboard'],
            'notification': ['notification', 'alert', 'update', 'notice', 'reminder'],
            'newsletter': ['newsletter', 'weekly', 'monthly', 'digest', 'news'],
            'promotional': ['offer', 'discount', 'sale', 'deal', 'promo'],
            'transactional': ['receipt', 'invoice', 'order', 'confirmation', 'payment'],
            'security': ['password', 'security', 'verify', 'confirm', 'encrypted', 'access'],
            'document': ['document', 'sign', 'docusign', 'pdf', 'attachment', 'file']
        };
        
        for (const [category, keywords] of Object.entries(categories)) {
            if (keywords.some(keyword => subjectLower.includes(keyword))) {
                return category;
            }
        }
        
        return 'general';
    }
    
    /**
     * Start sending emails for a campaign
     */
    async start() {
        if (this.isRunning) {
            throw new Error('Campaign is already running');
        }
        
        // Get campaign
        const campaign = campaignDb.findById(this.campaignId);
        if (!campaign) {
            throw new Error('Campaign not found');
        }
        
        if (campaign.user_id !== this.userId) {
            throw new Error('Unauthorized');
        }
        
        // Parse rotation lists
        this.subjectsList = campaign.subjects_list ? (JSON.parse(campaign.subjects_list) || []) : [];
        this.senderNamesList = campaign.sender_names_list ? (JSON.parse(campaign.sender_names_list) || []) : [];
        this.ctaLinksList = campaign.cta_links_list ? (JSON.parse(campaign.cta_links_list) || []) : [];
        const smtpIdsList = campaign.smtp_ids_list ? (JSON.parse(campaign.smtp_ids_list) || []) : [];
        
        // Debug: Log rotation data
        console.log('[Campaign Rotation] Raw campaign data:', {
            rotate_cta: campaign.rotate_cta,
            cta_links_list_raw: campaign.cta_links_list,
            rotate_subjects: campaign.rotate_subjects,
            rotate_senders: campaign.rotate_senders
        });
        console.log('[Campaign Rotation] Parsed lists:', {
            ctaLinksCount: this.ctaLinksList.length,
            ctaLinks: this.ctaLinksList,
            subjectsCount: this.subjectsList.length,
            senderNamesCount: this.senderNamesList.length
        });
        
        // Get SMTP configs for rotation
        if (campaign.rotate_smtp && smtpIdsList.length > 0) {
            this.smtpConfigs = smtpIdsList.map(id => smtpDb.findById(id)).filter(c => c);
            if (this.smtpConfigs.length === 0) {
                throw new Error('No valid SMTP configurations for rotation');
            }
        } else {
            // Single SMTP mode
            let smtpConfig;
            if (campaign.smtp_config_id) {
                smtpConfig = smtpDb.findById(campaign.smtp_config_id);
            } else {
                smtpConfig = smtpDb.findActiveByUserId(this.userId);
            }
            if (!smtpConfig) {
                throw new Error('No SMTP configuration found');
            }
            this.smtpConfigs = [smtpConfig];
        }
        
        // Build a Nodemailer-compatible proxy URL once (used by createTransporter)
        if (this.activeProxy) {
            const p = this.activeProxy;
            const auth = (p.username && p.password) ? `${encodeURIComponent(p.username)}:${encodeURIComponent(p.password)}@` : '';
            const scheme = p.proxy_type || 'http';
            this.proxyUrl = `${scheme}://${auth}${p.host}:${p.port}`;
        } else {
            this.proxyUrl = null;
        }

        // Create transporters for all SMTP configs (Nodemailer or API-based)
        this.transporters = this.smtpConfigs.map(config => {
            const apiTransport = createApiTransport(config);
            return {
                transporter: apiTransport || this.createTransporter(config),
                config: config,
                isApi: !!apiTransport
            };
        });
        
        // Get pending recipients (no limit in desktop app)
        let recipients = recipientDb.findPendingByCampaignId(this.campaignId, 999999);
        if (recipients.length === 0) {
            throw new Error('No pending recipients found');
        }

        // Filter out unsubscribed addresses (CAN-SPAM / GDPR compliance)
        const allEmails = recipients.map(r => r.email);
        const unsubSet = unsubscribeDb.findUnsubscribedSet(this.userId, allEmails);
        if (unsubSet.size > 0) {
            const before = recipients.length;
            recipients = recipients.filter(r => !unsubSet.has((r.email || '').toLowerCase().trim()));
            const skipped = before - recipients.length;
            console.log(`[Sending] Skipped ${skipped} unsubscribed recipient(s)`);
            // Mark them as 'failed' with a clear message so they don't keep trying
            for (const email of unsubSet) {
                const r = recipientDb.findByCampaignId(this.campaignId).find(x => (x.email || '').toLowerCase() === email && x.status === 'pending');
                if (r) recipientDb.updateStatus(r.id, 'failed', 'Recipient previously unsubscribed');
            }
            if (recipients.length === 0) {
                throw new Error('All recipients are unsubscribed');
            }
        }
        
        // Load user sending settings (delay, retry, proxy, threads)
        const settings = sendingSettingsDb.findByUserId(this.userId);
        this.delayMin = settings?.delay_min ?? 1000;
        this.delayMax = settings?.delay_max ?? 3000;
        if (this.delayMax < this.delayMin) this.delayMax = this.delayMin;
        this.retryFailed = !!(settings?.retry_failed);
        this.useProxy = !!(settings?.use_proxy);
        this.threads = Math.max(1, Math.min(10, settings?.threads || 1));
        console.log(`[Sending] Delay: ${this.delayMin}-${this.delayMax}ms | Threads: ${this.threads} | Retry: ${this.retryFailed} | Proxy: ${this.useProxy}`);

        // Load deliverability test settings
        try {
            const testSettings = userDb.getTestSettings(this.userId);
            if (testSettings?.test_enabled && testSettings?.test_email) {
                this.testSettings = testSettings;
                console.log(`[Sending] Deliverability test ON: ${testSettings.test_email} every ${testSettings.test_interval} emails`);
            }
        } catch (e) {
            console.warn('[Sending] Could not load test settings:', e.message);
        }

        // Load active proxy if proxy is enabled
        this.activeProxy = null;
        if (this.useProxy) {
            try {
                const proxies = proxyDb.findByUserId(this.userId);
                this.activeProxy = proxies.find(p => p.is_active) || proxies[0] || null;
                if (this.activeProxy) {
                    console.log(`[Sending] Using proxy: ${this.activeProxy.proxy_type}://${this.activeProxy.host}:${this.activeProxy.port}`);
                }
            } catch (e) {
                console.warn('[Sending] Could not load proxy:', e.message);
            }
        }

        this.totalCount = recipients.length;
        this.isRunning = true;
        this.isPaused = false;
        
        // Update campaign status
        campaignDb.updateStatus(this.campaignId, 'sending');
        
        // Store session
        activeSessions.set(this.campaignId, this);
        
        this.emit('start', { total: this.totalCount });

        // Pick the processing strategy:
        //  - threads > 1 → unified processThreaded() (handles single + multi-SMTP, both rotation modes)
        //  - threads === 1 → preserve legacy paths exactly as before
        const useThreaded = this.threads > 1;
        const runProcessor = async (recs) => {
            if (useThreaded) {
                await this.processThreaded(recs, campaign);
            } else if (campaign.smtp_rotation_type === 'batch' && this.transporters.length > 1) {
                await this.processBatchParallel(recs, campaign);
            } else {
                await this.processRoundRobin(recs, campaign);
            }
        };

        await runProcessor(recipients);

        // Retry failed recipients with exponential backoff (30s → 2min → 5min)
        // Skips permanent failures (550, 553, invalid address) to avoid wasted retries
        if (this.retryFailed && this.isRunning && this.failedCount > 0) {
            const retryDelays = [30_000, 120_000, 300_000];
            for (let attempt = 0; attempt < retryDelays.length; attempt++) {
                if (!this.isRunning) break;

                const failedRecipients = recipientDb.findByCampaignId(this.campaignId)
                    .filter(r => r.status === 'failed' && !isPermanentFailure(r.error_message));

                if (failedRecipients.length === 0) {
                    console.log(`[Retry] No retryable failures remain after attempt ${attempt}`);
                    break;
                }

                const delay = retryDelays[attempt];
                console.log(`[Retry] Attempt ${attempt + 1}/${retryDelays.length}: waiting ${delay / 1000}s before retrying ${failedRecipients.length} recipients`);
                await this.sleep(delay);
                if (!this.isRunning) break;

                // Reset to pending so processSingleRecipient handles them
                for (const r of failedRecipients) {
                    recipientDb.updateStatus(r.id, 'pending');
                }
                const beforeRetry = this.failedCount;
                this.failedCount = Math.max(0, this.failedCount - failedRecipients.length);
                await runProcessor(failedRecipients);
                const recovered = beforeRetry - this.failedCount;
                console.log(`[Retry] Attempt ${attempt + 1}: recovered ${recovered}, ${this.failedCount} still failing`);

                if (this.failedCount === 0) break;
            }
        }

        // Complete
        this.isRunning = false;
        activeSessions.delete(this.campaignId);
        
        // Check if all done
        const stats = recipientDb.getStatsByCampaignId(this.campaignId);
        if (stats.pending === 0) {
            campaignDb.updateStatus(this.campaignId, 'completed');
        } else {
            campaignDb.updateStatus(this.campaignId, 'paused');
        }
        
        this.emit('complete', {
            sent: this.sentCount,
            failed: this.failedCount,
            total: this.totalCount
        });
        
        return { sent: this.sentCount, failed: this.failedCount };
    }
    
    /**
     * Process recipients sequentially with round-robin SMTP rotation
     */
    async processRoundRobin(recipients, campaign) {
        for (const recipient of recipients) {
            if (!this.isRunning) break;
            while (this.isPaused) {
                await this.sleep(1000);
                if (!this.isRunning) break;
            }
            if (!this.isRunning) break;

            const transporterData = this.transporters[this.rotationIndex % this.transporters.length];
            await this.processSingleRecipient(recipient, transporterData, campaign);
            this.rotationIndex++;

            // User-configured delay between emails
            await this.sleep(this.randomDelay());
        }
    }

    /**
     * Process recipients in parallel waves — all SMTPs fire simultaneously.
     * With 20 SMTPs and 100 leads: 5 waves of 20 parallel sends.
     */
    async processBatchParallel(recipients, campaign) {
        const smtpCount = this.transporters.length;

        for (let i = 0; i < recipients.length; i += smtpCount) {
            if (!this.isRunning) break;
            while (this.isPaused) {
                await this.sleep(1000);
                if (!this.isRunning) break;
            }
            if (!this.isRunning) break;

            // Take a chunk of recipients equal to the number of SMTPs
            const chunk = recipients.slice(i, i + smtpCount);

            console.log(`[Batch] Wave ${Math.floor(i / smtpCount) + 1}: sending ${chunk.length} emails in parallel via ${smtpCount} SMTPs`);

            // Fire all emails in this wave simultaneously
            const promises = chunk.map((recipient, idx) => {
                const transporterData = this.transporters[idx % smtpCount];
                return this.processSingleRecipient(recipient, transporterData, campaign);
            });

            await Promise.all(promises);
            this.rotationIndex += chunk.length;

            // User-configured delay between waves
            await this.sleep(this.randomDelay());
        }
    }

    /**
     * Unified threaded processor — wave model with `Promise.all` chunks.
     * Honors `this.threads` for concurrency, `campaign.smtp_rotation_type` for SMTP selection.
     *
     * Wave size:
     *  - 1 SMTP                          → this.threads
     *  - Multi-SMTP, round-robin         → this.threads
     *  - Multi-SMTP, instantly (batch)   → max(this.threads, smtpCount)
     *
     * SMTP picker (per slot in a wave):
     *  - Round-robin: cycles through SMTPs by rotationIndex
     *  - Instantly:   slot i in wave → SMTP[i % smtpCount] (every wave fans out across all SMTPs)
     */
    async processThreaded(recipients, campaign) {
        const smtpCount = this.transporters.length;
        const isInstantly = campaign.smtp_rotation_type === 'batch' && smtpCount > 1;

        // Wave size: instantly mode guarantees every wave touches every SMTP
        const waveSize = isInstantly
            ? Math.max(this.threads, smtpCount)
            : this.threads;

        let waveNum = 0;
        for (let i = 0; i < recipients.length; i += waveSize) {
            if (!this.isRunning) break;
            while (this.isPaused) {
                await this.sleep(1000);
                if (!this.isRunning) break;
            }
            if (!this.isRunning) break;

            const chunk = recipients.slice(i, i + waveSize);
            waveNum++;

            console.log(`[Threaded] Wave ${waveNum}: sending ${chunk.length} in parallel via ${smtpCount} SMTP(s) [${isInstantly ? 'instantly' : 'round-robin'}]`);

            const promises = chunk.map((recipient, slotIdx) => {
                let transporterData;
                if (isInstantly) {
                    // Slot i in the wave → SMTP[i % smtpCount]; ensures every wave fans out
                    transporterData = this.transporters[slotIdx % smtpCount];
                } else {
                    // Round-robin across all sends (continues across waves)
                    transporterData = this.transporters[(this.rotationIndex + slotIdx) % smtpCount];
                }
                return this.processSingleRecipient(recipient, transporterData, campaign);
            });

            await Promise.all(promises);
            this.rotationIndex += chunk.length;

            // User-configured delay between waves
            await this.sleep(this.randomDelay());
        }
    }

    /**
     * Send to one recipient and handle success/failure bookkeeping
     */
    async processSingleRecipient(recipient, transporterData, campaign) {
        try {
            const rotatedSubject = campaign.rotate_subjects && this.subjectsList.length > 0
                ? this.getRotatedItem(this.subjectsList, this.rotationIndex)
                : null;
            const rotatedSenderName = campaign.rotate_senders && this.senderNamesList.length > 0
                ? this.getRotatedItem(this.senderNamesList, this.rotationIndex)
                : null;
            const rotatedCtaLink = campaign.rotate_cta && this.ctaLinksList.length > 0
                ? this.getRotatedItem(this.ctaLinksList, this.rotationIndex)
                : null;

            await this.sendEmail(
                transporterData.transporter,
                transporterData.config,
                campaign,
                recipient,
                { rotatedSubject, rotatedSenderName, rotatedCtaLink }
            );

            this.sentCount++;
            this.emailsSinceLastTest++;
            recipientDb.updateStatus(recipient.id, 'sent');
            campaignDb.incrementSent(this.campaignId);

            emailLogDb.create({
                user_id: this.userId,
                campaign_id: this.campaignId,
                recipient_email: recipient.email,
                status: 'sent'
            });

            this.emit('sent', {
                email: recipient.email,
                sent: this.sentCount,
                failed: this.failedCount,
                total: this.totalCount
            });

            // Trigger deliverability test if interval reached
            if (this.testSettings && this.emailsSinceLastTest >= this.testSettings.test_interval) {
                this.emailsSinceLastTest = 0;
                await this.sendDeliverabilityTest(transporterData, campaign);
            }
        } catch (error) {
            this.failedCount++;
            recipientDb.updateStatus(recipient.id, 'failed', error.message);
            campaignDb.incrementFailed(this.campaignId);

            emailLogDb.create({
                user_id: this.userId,
                campaign_id: this.campaignId,
                recipient_email: recipient.email,
                status: 'failed',
                error_message: error.message
            });

            this.emit('failed', {
                email: recipient.email,
                error: error.message,
                sent: this.sentCount,
                failed: this.failedCount,
                total: this.totalCount
            });
        }
    }

    /**
     * Pause sending
     */
    pause() {
        this.isPaused = true;
        this.emit('paused');
    }
    
    /**
     * Resume sending
     */
    resume() {
        this.isPaused = false;
        this.emit('resumed');
    }
    
    /**
     * Send deliverability test email
     */
    async sendDeliverabilityTest(transporterData, campaign) {
        if (!this.testSettings?.test_email) return;
        
        try {
            console.log(`[Deliverability] Sending test email to ${this.testSettings.test_email} (after ${this.testSettings.test_interval} emails)`);
            
            const testSubject = `🧪 TEST #${Math.floor(this.sentCount / this.testSettings.test_interval)} - ${campaign.subject}`;
            const testHtmlBody = `
                <div style="background: #fff3cd; border: 1px solid #ffc107; padding: 15px; margin-bottom: 20px; border-radius: 4px;">
                    <strong>🧪 DELIVERABILITY TEST</strong><br>
                    <small>This is an automatic test email to verify deliverability.</small><br>
                    <small>Campaign: ${campaign.name} | Emails sent: ${this.sentCount} | Time: ${new Date().toLocaleString()}</small>
                </div>
                ${campaign.body_html || '<p>Campaign content preview</p>'}
            `;
            
            const smtpConfig = transporterData.config;
            const fromName = smtpConfig.from_name || '';
            const fromEmail = smtpConfig.from_email || smtpConfig.username || 'noreply@localhost';

            await transporterData.transporter.sendMail({
                from: fromName ? `"${fromName}" <${fromEmail}>` : fromEmail,
                to: this.testSettings.test_email,
                subject: testSubject,
                html: testHtmlBody
            });
            
            console.log(`[Deliverability] Test email sent successfully to ${this.testSettings.test_email}`);
            
            this.emit('test_sent', {
                email: this.testSettings.test_email,
                sent: this.sentCount,
                interval: this.testSettings.test_interval
            });
        } catch (error) {
            console.error(`[Deliverability] Failed to send test email: ${error.message}`);
            this.emit('test_failed', {
                email: this.testSettings.test_email,
                error: error.message
            });
        }
    }
    
    /**
     * Stop sending
     */
    stop() {
        this.isRunning = false;
        this.isPaused = false;
        activeSessions.delete(this.campaignId);
        campaignDb.updateStatus(this.campaignId, 'paused');
        this.emit('stopped');
    }
    
    /**
     * Create nodemailer transporter.
     * For API-based providers (gsuite, amazon_ses) that still use SMTP,
     * auto-fills host/port when not explicitly set.
     */
    createTransporter(smtpConfig) {
        const provider = smtpConfig.provider || 'smtp';
        const authType = smtpConfig.auth_type || 'login';

        // Auto-fill SMTP settings for known providers
        let host = smtpConfig.host;
        let port = smtpConfig.port;
        let secure = smtpConfig.secure;

        if (provider === 'gsuite' && !host) {
            host = 'smtp.gmail.com';
            port = 465;
            secure = 1;
        } else if (provider === 'amazon_ses' && !host) {
            const region = smtpConfig.api_region || 'us-east-1';
            host = `email-smtp.${region}.amazonaws.com`;
            port = 587;
            secure = 0;
        }

        const isSecure = secure === 1 || secure === true;

        const transportOpts = {
            host: host,
            port: port,
            secure: isSecure,
            tls: {
                rejectUnauthorized: false,
                minVersion: 'TLSv1'
            },
            connectionTimeout: 30000,
            greetingTimeout: 30000,
            socketTimeout: 60000,
        };

        // Try STARTTLS for non-SSL, non-port-25 connections but don't force it
        if (!isSecure && smtpConfig.port !== 25) {
            transportOpts.opportunisticTLS = true;
        }

        // Route SMTP connection through proxy if enabled
        if (this.proxyUrl) {
            transportOpts.proxy = this.proxyUrl;
        }

        if (authType === 'none') {
            // IP-authenticated or open relay — no auth
        } else if (authType === 'oauth2') {
            const accessToken = decrypt(smtpConfig.password_encrypted);
            transportOpts.auth = {
                type: 'OAuth2',
                user: smtpConfig.username,
                accessToken
            };
        } else {
            // login, api-key — standard user/pass auth
            const password = decrypt(smtpConfig.password_encrypted);
            transportOpts.auth = {
                user: smtpConfig.username,
                pass: password
            };
        }

        const transporter = nodemailer.createTransport(transportOpts);

        // Register the SOCKS module with Nodemailer for socks4/socks5 URLs
        if (this.proxyUrl && /^socks/.test(this.proxyUrl)) {
            transporter.set('proxy_socks_module', socks);
        }

        return transporter;
    }
    
    /**
     * Send single email
     * @param {object} transporter - Nodemailer transporter
     * @param {object} smtpConfig - SMTP configuration
     * @param {object} campaign - Campaign data
     * @param {object} recipient - Recipient data
     * @param {object} rotation - Rotation overrides { rotatedSubject, rotatedSenderName, rotatedCtaLink }
     */
    async sendEmail(transporter, smtpConfig, campaign, recipient, rotation = {}) {
        const { rotatedSubject, rotatedSenderName, rotatedCtaLink } = rotation;
        
        // Process placeholders
        const recipientName = recipient.name || this.extractName(recipient.email);
        const recipientDomain = recipient.email.split('@')[1];
        const recipientDomainName = this.capitalize(recipientDomain.split('.')[0]);
        
        // Split recipient name for first/last
        const capitalizedFullName = this.capitalize(recipientName);
        const nameParts = capitalizedFullName.trim().split(/\s+/);
        const firstName = nameParts[0] || '';
        const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : '';

        // Generate fake data (faker)
        const fakeCompanyName = faker.company.name();
        const fakeFirstName = faker.person.firstName();
        const fakeLastName = faker.person.lastName();
        const fakeFullName = `${fakeFirstName} ${fakeLastName}`;
        const fakeEmail = faker.internet.email({ firstName: fakeFirstName, lastName: fakeLastName });
        const fakePhone = faker.phone.number();
        const fakeAddress = faker.location.streetAddress();
        const fakeCity = faker.location.city();
        const fakeJobTitle = faker.person.jobTitle();
        const fakeDepartment = faker.commerce.department();

        // Date/time — base
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentWeekday = now.toLocaleDateString('en-US', { weekday: 'long' });

        // Date format variants
        const pad2 = (n) => String(n).padStart(2, '0');
        const dateIso = `${currentYear}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
        const dateLong = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        const dateFull = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        const dateDmy = `${pad2(now.getDate())}/${pad2(now.getMonth() + 1)}/${currentYear}`;
        const dateMdy = `${pad2(now.getMonth() + 1)}/${pad2(now.getDate())}/${currentYear}`;

        // Time format variants
        const time24h = `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
        const timeHm24 = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
        const timeHm12 = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        const timestamp = Math.floor(now.getTime() / 1000);
        const timestampMs = now.getTime();

        // Individual pieces
        const currentMonth = now.toLocaleDateString('en-US', { month: 'long' });
        const currentMonthShort = now.toLocaleDateString('en-US', { month: 'short' });
        const currentMonthNum = pad2(now.getMonth() + 1);
        const currentDay = pad2(now.getDate());
        const currentHour = pad2(now.getHours());
        const currentMinute = pad2(now.getMinutes());

        // Timezone info
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        const tzOffsetMin = -now.getTimezoneOffset();
        const tzSign = tzOffsetMin >= 0 ? '+' : '-';
        const tzAbs = Math.abs(tzOffsetMin);
        const timezoneOffset = `${tzSign}${pad2(Math.floor(tzAbs / 60))}:${pad2(tzAbs % 60)}`;

        // Relative / expiry dates
        const tomorrowDate = new Date(now.getTime() + 24 * 60 * 60 * 1000).toLocaleDateString();
        const yesterdayDate = new Date(now.getTime() - 24 * 60 * 60 * 1000).toLocaleDateString();
        const expiry24h = new Date(now.getTime() + 24 * 60 * 60 * 1000).toLocaleString();
        const expiry48h = new Date(now.getTime() + 48 * 60 * 60 * 1000).toLocaleString();
        const expiry72h = new Date(now.getTime() + 72 * 60 * 60 * 1000).toLocaleString();
        const expiry7d = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString();
        const expiry30d = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString();

        // Quarter and ISO week number
        const quarter = `Q${Math.floor(now.getMonth() / 3) + 1}`;
        // ISO 8601 week number — Thursday of the current week defines the week's year
        const getIsoWeek = (d) => {
            const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
            const dayNum = target.getUTCDay() || 7;
            target.setUTCDate(target.getUTCDate() + 4 - dayNum);
            const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
            return Math.ceil(((target - yearStart) / 86400000 + 1) / 7);
        };
        const weekNumber = String(getIsoWeek(now));

        // Verification codes / IDs
        const random4 = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
        const random6 = String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
        const randomUuid = crypto.randomUUID();
        const randomPrice = `$${(Math.random() * 490 + 9.99).toFixed(2)}`;

        // Fake commerce identifiers
        const fakeInvoice = `INV-${currentYear}-${String(Math.floor(Math.random() * 100000)).padStart(5, '0')}`;
        const fakeOrder = `ORD-${String(Math.floor(Math.random() * 10000000)).padStart(7, '0')}`;
        // UPS-style 1Z + 16 alphanumeric chars
        const fakeTracking = `1Z${crypto.randomBytes(8).toString('hex').toUpperCase()}`;

        // Generate random path
        const pathSegments = ['docs', 'files', 'assets', 'content', 'data', 'resources', 'media', 'uploads'];
        const randomPath = `/${pathSegments[Math.floor(Math.random() * pathSegments.length)]}/${crypto.randomBytes(8).toString('hex')}`;

        // Generate random link (campaign link placeholder)
        const randomLink = `https://${recipientDomain}/r/${crypto.randomBytes(12).toString('hex')}`;

        const placeholders = {
            // Recipient placeholders
            '{RECIPIENT_NAME}': capitalizedFullName,
            '{RECIPIENT_FIRST_NAME}': firstName,
            '{RECIPIENT_LAST_NAME}': lastName,
            '{RECIPIENT_EMAIL}': recipient.email,
            '{RECIPIENT_DOMAIN}': recipientDomain,
            '{RECIPIENT_DOMAIN_NAME}': recipientDomainName,
            // Standard Base64 encoding (e.g., test@test.com → dGVzdEB0ZXN0LmNvbQ==)
            '{RECIPIENT_BASE64_EMAIL}': Buffer.from(recipient.email).toString('base64'),

            // Date/Time — base
            '{CURRENT_DATE}': now.toLocaleDateString(),
            '{CURRENT_TIME}': now.toLocaleTimeString(),
            '{CURRENT_YEAR}': String(currentYear),
            '{CURRENT_WEEKDAY}': currentWeekday,

            // Date format variants
            '{DATE_ISO}': dateIso,
            '{DATE_LONG}': dateLong,
            '{DATE_FULL}': dateFull,
            '{DATE_DMY}': dateDmy,
            '{DATE_MDY}': dateMdy,

            // Time format variants
            '{TIME_24H}': time24h,
            '{TIME_HM_24}': timeHm24,
            '{TIME_HM_12}': timeHm12,
            '{TIMESTAMP}': String(timestamp),
            '{TIMESTAMP_MS}': String(timestampMs),

            // Individual date/time pieces
            '{CURRENT_MONTH}': currentMonth,
            '{CURRENT_MONTH_SHORT}': currentMonthShort,
            '{CURRENT_MONTH_NUM}': currentMonthNum,
            '{CURRENT_DAY}': currentDay,
            '{CURRENT_HOUR}': currentHour,
            '{CURRENT_MINUTE}': currentMinute,

            // Timezone info
            '{TIMEZONE}': timezone,
            '{TIMEZONE_OFFSET}': timezoneOffset,

            // Relative / expiry dates
            '{TOMORROW_DATE}': tomorrowDate,
            '{YESTERDAY_DATE}': yesterdayDate,
            '{EXPIRY_DATE_24H}': expiry24h,
            '{EXPIRY_DATE_48H}': expiry48h,
            '{EXPIRY_DATE_72H}': expiry72h,
            '{EXPIRY_DATE_7D}': expiry7d,
            '{EXPIRY_DATE_30D}': expiry30d,

            // Quarter and week number
            '{QUARTER}': quarter,
            '{WEEK_NUMBER}': weekNumber,

            // Random placeholders
            '{RANDOM_NUMBER10}': Math.random().toString().slice(2, 12),
            '{RANDOM_NUMBER6}': random6,
            '{RANDOM_NUMBER4}': random4,
            '{RANDOM_STRING}': crypto.randomBytes(20).toString('hex'),
            '{RANDOM_MD5}': crypto.createHash('md5').update(Math.random().toString()).digest('hex'),
            '{RANDOM_UUID}': randomUuid,
            '{RANDOM_PRICE}': randomPrice,
            '{RANDOM_PATH}': randomPath,

            // Fake company / commerce placeholders
            '{FAKE_COMPANY}': fakeCompanyName,
            '{FAKE_COMPANY_EMAIL}': fakeEmail,
            '{FAKE_COMPANY_EMAIL_AND_FULLNAME}': `${fakeFullName} <${fakeEmail}>`,
            '{FAKE_INVOICE_NUMBER}': fakeInvoice,
            '{FAKE_ORDER_NUMBER}': fakeOrder,
            '{FAKE_TRACKING_NUMBER}': fakeTracking,

            // Fake identity placeholders
            '{FAKE_FIRST_NAME}': fakeFirstName,
            '{FAKE_LAST_NAME}': fakeLastName,
            '{FAKE_FULL_NAME}': fakeFullName,
            '{FAKE_PHONE}': fakePhone,
            '{FAKE_ADDRESS}': fakeAddress,
            '{FAKE_CITY}': fakeCity,
            '{FAKE_JOB_TITLE}': fakeJobTitle,
            '{FAKE_DEPARTMENT}': fakeDepartment
        };
        
        // Pre-process link value to replace any placeholders within the link itself
        // This allows links like: https://example.com/track?email={RECIPIENT_BASE64_EMAIL}
        let processedLink = rotatedCtaLink || randomLink;
        if (processedLink) {
            // Replace placeholders in the link value
            for (const [placeholder, value] of Object.entries(placeholders)) {
                const escapedPlaceholder = placeholder.replace(/[{}]/g, '\\$&');
                const regex = new RegExp(escapedPlaceholder, 'g');
                processedLink = processedLink.replace(regex, value);
            }
        }
        
        // Now add link placeholders with pre-processed values
        placeholders['{LINK}'] = processedLink;
        placeholders['{CTA_LINK}'] = processedLink;
        placeholders['{RANDLINK}'] = `https://${faker.internet.domainName()}/r/${crypto.randomBytes(8).toString('hex')}`;

        // Unsubscribe link — stateless HMAC token, verified by /u/:token route
        const unsubscribeUrl = buildUnsubscribeUrl(this.userId, this.campaignId, recipient.email);
        placeholders['{UNSUBSCRIBE_LINK}'] = unsubscribeUrl;
        placeholders['{UNSUBSCRIBE_URL}'] = unsubscribeUrl;

        // Generate QR code as an HTML table (no image — works everywhere)
        let qrImgHtml = '';
        if (processedLink) {
            try {
                // Get the QR matrix (2D array of 0/1)
                const qr = QRCode.create(processedLink, { errorCorrectionLevel: 'M' });
                const size = qr.modules.size;
                const data = qr.modules.data;
                const cellPx = 5; // pixel size per module
                const rows = [];
                for (let y = 0; y < size; y++) {
                    const cells = [];
                    for (let x = 0; x < size; x++) {
                        const isDark = data[y * size + x] === 1;
                        const bg = isDark ? '#000000' : '#ffffff';
                        cells.push(`<td width="${cellPx}" height="${cellPx}" bgcolor="${bg}" style="width:${cellPx}px;height:${cellPx}px;background:${bg};line-height:${cellPx}px;font-size:1px;padding:0;mso-line-height-rule:exactly;">&nbsp;</td>`);
                    }
                    rows.push(`<tr>${cells.join('')}</tr>`);
                }
                const totalPx = size * cellPx;
                qrImgHtml = `<table cellpadding="0" cellspacing="0" border="0" width="${totalPx}" style="border-collapse:collapse;border-spacing:0;background:#ffffff;padding:8px;margin:0 auto;">${rows.join('')}</table>`;
            } catch (qrErr) {
                console.error('[QR] Failed to generate QR code:', qrErr.message);
            }
        }

        // Use rotated subject or campaign subject
        const subjectSource = rotatedSubject || campaign.subject;

        // Auto-fix common HTML issues so campaigns render correctly in Outlook/Gmail/etc.
        let bodyBefore = this.sanitizeEmailHtml(campaign.body_html || '', processedLink);

        // HTML placeholders — {QR_CODE} becomes an img tag
        const htmlPlaceholders = { ...placeholders, '{QR_CODE}': qrImgHtml };
        // Text placeholders — {QR_CODE} falls back to the raw URL (text emails can't render images)
        const textPlaceholders = { ...placeholders, '{QR_CODE}': processedLink || '' };

        // Replace placeholders in subject and body
        let subject = this.replacePlaceholders(subjectSource, placeholders);
        let htmlBody = this.replacePlaceholders(bodyBefore, htmlPlaceholders);
        let textBody = this.replacePlaceholders(campaign.body_text || '', textPlaceholders);
        
        // Debug: Check if {LINK} is still there after replacement
        const stillHasLink = htmlBody.includes('{LINK}');
        console.log('[Email Debug] Still has {LINK} after replacement?', stillHasLink);
        
        // Debug log
        console.log('[Email] Sending to:', recipient.email, '| Subject:', subject.substring(0, 50));
        
        // Build mail options - use rotated sender name or SMTP config name
        const fromName = rotatedSenderName || smtpConfig.from_name || '';
        const fromEmail = smtpConfig.from_email || smtpConfig.username || 'noreply@localhost';

        const mailOptions = {
            from: fromName ? `"${fromName}" <${fromEmail}>` : fromEmail,
            to: recipient.email,
            subject: subject,
            html: htmlBody || undefined,
            text: textBody || undefined,
            // CAN-SPAM / RFC 8058: List-Unsubscribe + one-click POST support
            // Gmail/Outlook show a native unsubscribe button when these are present
            headers: {
                'List-Unsubscribe': `<${unsubscribeUrl}>`,
                'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
            }
        };

        // Add Reply-To header if specified
        if (campaign.reply_to) {
            mailOptions.replyTo = campaign.reply_to;
        }
        
        // Add attachment - either from library (with conversion) or direct upload
        console.log('[SendEmail] Attachment check:', { attachment_id: campaign.attachment_id, attachment_format: campaign.attachment_format, attachment_name: campaign.attachment_name, has_content: !!campaign.attachment_content });
        if (campaign.attachment_id) {
            // Library attachment
            const libraryAttachment = attachmentDb.findById(campaign.attachment_id);
            console.log('[SendEmail] Library attachment lookup:', { found: !!libraryAttachment, has_file: !!libraryAttachment?.file_content, has_html: !!libraryAttachment?.html_content });
            if (libraryAttachment) {
                try {
                    if (libraryAttachment.file_content) {
                        // File-based library attachment — send raw file
                        const ext = libraryAttachment.file_name ? '.' + libraryAttachment.file_name.split('.').pop() : '';
                        const fileName = campaign.attachment_custom_name
                            ? this.replacePlaceholders(campaign.attachment_custom_name, placeholders) + ext
                            : libraryAttachment.file_name;
                        mailOptions.attachments = [{
                            filename: fileName,
                            content: Buffer.from(libraryAttachment.file_content),
                            contentType: libraryAttachment.file_type
                        }];
                    } else if (libraryAttachment.html_content) {
                        // HTML-based library attachment — convert to requested format
                        const processedHtml = this.replacePlaceholders(libraryAttachment.html_content, placeholders);
                        console.log('[SendEmail] Attachment HTML FULL:', processedHtml);
                        const format = campaign.attachment_format || 'html';
                        // Use custom name if set, otherwise library attachment name
                        const baseName = campaign.attachment_custom_name
                            ? this.replacePlaceholders(campaign.attachment_custom_name.replace(/[^a-zA-Z0-9_ {}-]/g, '_'), placeholders)
                            : this.replacePlaceholders(libraryAttachment.name.replace(/[^a-zA-Z0-9]/g, '_'), placeholders);
                        const converted = await convertAttachment(
                            processedHtml,
                            format,
                            baseName
                        );
                        mailOptions.attachments = [{
                            filename: converted.filename,
                            content: converted.content,
                            encoding: 'base64',
                            contentType: converted.mimeType
                        }];
                    }
                } catch (convError) {
                    console.error('Attachment error:', convError.message);
                }
            }
        } else if (campaign.attachment_name && campaign.attachment_content) {
            // Direct upload (base64 encoded content)
            const attachmentName = this.replacePlaceholders(campaign.attachment_name, placeholders);
            
            // Check if attachment is HTML and process placeholders
            let attachmentContent = campaign.attachment_content;
            const isHtmlAttachment = campaign.attachment_name.toLowerCase().endsWith('.html') || 
                                     campaign.attachment_name.toLowerCase().endsWith('.htm');
            
            if (isHtmlAttachment) {
                try {
                    // Decode base64, replace placeholders, re-encode
                    const decodedHtml = Buffer.from(campaign.attachment_content, 'base64').toString('utf-8');
                    const processedHtml = this.replacePlaceholders(decodedHtml, placeholders);
                    attachmentContent = Buffer.from(processedHtml).toString('base64');
                } catch (e) {
                    // If decoding fails, use original content
                    console.log('Could not process HTML attachment placeholders');
                }
            }
            
            mailOptions.attachments = [{
                filename: attachmentName,
                content: attachmentContent, // Use processed content with placeholders replaced
                encoding: 'base64'
            }];
        }

        // Send email
        const result = await transporter.sendMail(mailOptions);
        return result;
    }
    
    /**
     * Auto-fix common HTML problems so campaigns render reliably in Outlook/Gmail.
     * - Strips markdown code fences (```html ... ```) that AI assistants add
     * - Unwraps <img src="{QR_CODE}"> misuse so QR_CODE is a standalone placeholder
     * - Fills empty <a href=""> buttons with the current {LINK} URL
     * - Moves stray content after </body> back inside the body
     * - Strips flexbox layout on <body> which Outlook doesn't support
     */
    sanitizeEmailHtml(html, linkUrl) {
        if (!html) return html;
        let out = html;

        // 1. Strip markdown code fences (```html, ```, ~~~html, ~~~)
        out = out.replace(/^\s*```(?:html|HTML)?\s*\n?/i, '');
        out = out.replace(/\n?```\s*$/i, '');
        out = out.replace(/^\s*~~~(?:html|HTML)?\s*\n?/i, '');
        out = out.replace(/\n?~~~\s*$/i, '');

        // 2. Unwrap <img src="{QR_CODE}"> or <img src='{QR_CODE}'> — QR_CODE is a standalone tag
        out = out.replace(/<img\b[^>]*\bsrc\s*=\s*["']\{QR_CODE\}["'][^>]*\/?>/gi, '{QR_CODE}');
        out = out.replace(/<img\b[^>]*\bsrc\s*=\s*["']\{qr_code\}["'][^>]*\/?>/gi, '{QR_CODE}');

        // 3. Unwrap <a href="{QR_CODE}"> misuse too
        out = out.replace(/<a\b[^>]*\bhref\s*=\s*["']\{QR_CODE\}["'][^>]*>([\s\S]*?)<\/a>/gi, '{QR_CODE}');

        // 4. Fill empty <a href=""> tags with {LINK} so buttons become clickable
        if (linkUrl) {
            out = out.replace(/<a\b([^>]*?)\shref=(['"])\2([^>]*)>/gi, (m, pre, q, post) => {
                return `<a${pre} href="${linkUrl}"${post}>`;
            });
            // Also handle <a href="#">, <a href="javascript:void(0)">, <a href="javascript:;">
            out = out.replace(/<a\b([^>]*?)\shref=(['"])(#|javascript:[^'"]*)\2([^>]*)>/gi, (m, pre, q, _url, post) => {
                return `<a${pre} href="${linkUrl}"${post}>`;
            });
        }

        // 5. Move any content that sits between </body> and </html> back INSIDE the body
        const bodyCloseMatch = out.match(/<\/body>([\s\S]*?)<\/html>/i);
        if (bodyCloseMatch && bodyCloseMatch[1].trim()) {
            const stray = bodyCloseMatch[1];
            out = out.replace(/<\/body>[\s\S]*?<\/html>/i, stray + '</body></html>');
        }
        // Also handle content after </html> entirely
        out = out.replace(/(<\/html>)([\s\S]+)$/i, (m, tag, rest) => {
            if (rest.trim()) {
                return rest + tag;
            }
            return tag;
        });

        // 6. Strip flexbox centering on <body> that Outlook can't render
        out = out.replace(/(<style[^>]*>[\s\S]*?)(body\s*\{[^}]*\})/gi, (m, head, bodyRule) => {
            const cleaned = bodyRule
                .replace(/display\s*:\s*flex\s*;?/gi, '')
                .replace(/justify-content\s*:[^;}]*;?/gi, '')
                .replace(/align-items\s*:[^;}]*;?/gi, '')
                .replace(/height\s*:\s*100vh\s*;?/gi, '');
            return head + cleaned;
        });
        // Also handle inline style on <body ...>
        out = out.replace(/<body\b([^>]*)\bstyle\s*=\s*"([^"]*)"/gi, (m, pre, style) => {
            const cleaned = style
                .replace(/display\s*:\s*flex\s*;?/gi, '')
                .replace(/justify-content\s*:[^;}"]*;?/gi, '')
                .replace(/align-items\s*:[^;}"]*;?/gi, '')
                .replace(/height\s*:\s*100vh\s*;?/gi, '');
            return `<body${pre}style="${cleaned}"`;
        });

        return out;
    }

    /**
     * Replace placeholders in content
     */
    replacePlaceholders(content, placeholders) {
        if (!content) return content;
        
        let result = content;
        
        // First, handle HTML-encoded placeholders
        // &#123; = { and &#125; = }
        result = result.replace(/&#123;/g, '{').replace(/&#125;/g, '}');
        // Also handle hex versions: &#x7B; = { and &#x7D; = }
        result = result.replace(/&#x7[Bb];/g, '{').replace(/&#x7[Dd];/g, '}');
        
        for (const [placeholder, value] of Object.entries(placeholders)) {
            // Escape curly braces for regex; case-insensitive so {link}/{Link}/{LINK} all match
            const escapedPlaceholder = placeholder.replace(/[{}]/g, '\\$&');
            const regex = new RegExp(escapedPlaceholder, 'gi');
            // Use function replacer to avoid $-pattern interpretation in SVG/HTML values
            result = result.replace(regex, () => value);
        }

        return result;
    }
    
    /**
     * Extract name from email username
     * Converts john.doe@company.com -> John Doe
     * Converts john_smith123@company.com -> John Smith
     */
    extractName(email) {
        const username = email.split('@')[0];
        // Remove numbers from the end
        const cleanUsername = username.replace(/\d+$/, '');
        // Replace separators with spaces
        const withSpaces = cleanUsername.replace(/[._-]/g, ' ');
        // Capitalize each word
        const capitalized = withSpaces
            .split(' ')
            .filter(word => word.length > 0)
            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join(' ');
        return capitalized || username; // Fallback to original username if empty
    }
    
    /**
     * Capitalize string
     */
    capitalize(str) {
        if (!str) return str;
        // Capitalize each word for names
        return str.split(' ')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join(' ');
    }
    
    /**
     * Sleep helper
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Return the configured delay (ms). Single-value now — no randomization.
     * delayMax is preserved for backward-compat reads but ignored.
     */
    randomDelay() {
        return this.delayMin ?? 1000;
    }
}

/**
 * Get active session for a campaign
 */
export function getActiveSession(campaignId) {
    return activeSessions.get(campaignId);
}

/**
 * Start sending emails for a campaign
 */
export async function startCampaign(userId, campaignId) {
    // Check if already running
    if (activeSessions.has(campaignId)) {
        throw new Error('Campaign is already running');
    }
    
    const sender = new EmailSender(userId, campaignId);
    return sender;
}

/**
 * Stop campaign
 */
export function stopCampaign(campaignId) {
    const session = activeSessions.get(campaignId);
    if (session) {
        session.stop();
        return true;
    }
    return false;
}

/**
 * Pause campaign
 */
export function pauseCampaign(campaignId) {
    const session = activeSessions.get(campaignId);
    if (session) {
        session.pause();
        return true;
    }
    return false;
}

/**
 * Resume campaign
 */
export function resumeCampaign(campaignId) {
    const session = activeSessions.get(campaignId);
    if (session) {
        session.resume();
        return true;
    }
    return false;
}

export default EmailSender;

