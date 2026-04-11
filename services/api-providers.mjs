/**
 * API-based email provider transports.
 * Each provider implements sendMail(mailOptions) matching Nodemailer's interface,
 * so they can be used as drop-in replacements in the email sender.
 */

import { decrypt } from './encryption.mjs';

// ============================================================
// Base class for API transports
// ============================================================
class ApiTransport {
    constructor(config) {
        this.config = config;
        this.apiKey = config.api_key_encrypted ? decrypt(config.api_key_encrypted) : null;
        this.fromEmail = config.from_email || config.username;
        this.fromName = config.from_name || '';
    }

    async sendMail(mailOptions) {
        throw new Error('sendMail() must be implemented by provider');
    }

    /**
     * Parse attachments from Nodemailer format to base64 buffers
     */
    parseAttachments(attachments) {
        if (!attachments || attachments.length === 0) return [];
        return attachments.map(att => {
            let content;
            if (att.encoding === 'base64' && typeof att.content === 'string') {
                content = att.content;
            } else if (Buffer.isBuffer(att.content)) {
                content = att.content.toString('base64');
            } else if (typeof att.content === 'string') {
                content = Buffer.from(att.content).toString('base64');
            } else {
                content = '';
            }
            return {
                filename: att.filename || 'attachment',
                content,
                contentType: att.contentType || 'application/octet-stream'
            };
        });
    }

    /**
     * Parse "Name <email>" format
     */
    parseFrom(from) {
        if (!from) return { name: this.fromName, email: this.fromEmail };
        const match = from.match(/^"?([^"<]*)"?\s*<([^>]+)>$/);
        if (match) return { name: match[1].trim(), email: match[2].trim() };
        return { name: '', email: from.trim() };
    }
}

// ============================================================
// SendGrid  —  POST https://api.sendgrid.com/v3/mail/send
// ============================================================
class SendGridTransport extends ApiTransport {
    async sendMail(mailOptions) {
        const from = this.parseFrom(mailOptions.from);
        const payload = {
            personalizations: [{
                to: [{ email: mailOptions.to }]
            }],
            from: { email: from.email, name: from.name || undefined },
            subject: mailOptions.subject,
            content: []
        };

        if (mailOptions.text) {
            payload.content.push({ type: 'text/plain', value: mailOptions.text });
        }
        if (mailOptions.html) {
            payload.content.push({ type: 'text/html', value: mailOptions.html });
        }
        if (payload.content.length === 0) {
            payload.content.push({ type: 'text/plain', value: ' ' });
        }

        if (mailOptions.replyTo) {
            payload.reply_to = { email: mailOptions.replyTo };
        }

        const attachments = this.parseAttachments(mailOptions.attachments);
        if (attachments.length > 0) {
            payload.attachments = attachments.map(a => ({
                content: a.content,
                filename: a.filename,
                type: a.contentType,
                disposition: 'attachment'
            }));
        }

        const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            const body = await res.text();
            throw new Error(`SendGrid API error (${res.status}): ${body}`);
        }

        return { messageId: res.headers.get('x-message-id') || 'sendgrid-ok' };
    }

    async verify() {
        // Quick validation — hit the scopes endpoint
        const res = await fetch('https://api.sendgrid.com/v3/scopes', {
            headers: { 'Authorization': `Bearer ${this.apiKey}` }
        });
        if (!res.ok) {
            const body = await res.text();
            throw new Error(`SendGrid auth failed (${res.status}): ${body}`);
        }
        return true;
    }
}

// ============================================================
// Mailgun  —  POST https://api.mailgun.net/v3/{domain}/messages
// ============================================================
class MailgunTransport extends ApiTransport {
    constructor(config) {
        super(config);
        this.domain = config.api_domain;
        this.region = config.api_region || 'us'; // 'us' or 'eu'
        this.baseUrl = this.region === 'eu'
            ? 'https://api.eu.mailgun.net/v3'
            : 'https://api.mailgun.net/v3';
    }

    async sendMail(mailOptions) {
        const from = this.parseFrom(mailOptions.from);
        const fromStr = from.name ? `${from.name} <${from.email}>` : from.email;

        const formData = new FormData();
        formData.append('from', fromStr);
        formData.append('to', mailOptions.to);
        formData.append('subject', mailOptions.subject || '');

        if (mailOptions.html) formData.append('html', mailOptions.html);
        if (mailOptions.text) formData.append('text', mailOptions.text);
        if (mailOptions.replyTo) formData.append('h:Reply-To', mailOptions.replyTo);

        const attachments = this.parseAttachments(mailOptions.attachments);
        for (const att of attachments) {
            const buf = Buffer.from(att.content, 'base64');
            const blob = new Blob([buf], { type: att.contentType });
            formData.append('attachment', blob, att.filename);
        }

        const authHeader = 'Basic ' + Buffer.from(`api:${this.apiKey}`).toString('base64');
        const res = await fetch(`${this.baseUrl}/${this.domain}/messages`, {
            method: 'POST',
            headers: { 'Authorization': authHeader },
            body: formData
        });

        if (!res.ok) {
            const body = await res.text();
            throw new Error(`Mailgun API error (${res.status}): ${body}`);
        }

        const json = await res.json();
        return { messageId: json.id || 'mailgun-ok' };
    }

    async verify() {
        const authHeader = 'Basic ' + Buffer.from(`api:${this.apiKey}`).toString('base64');
        const res = await fetch(`${this.baseUrl}/${this.domain}`, {
            headers: { 'Authorization': authHeader }
        });
        if (!res.ok) {
            const body = await res.text();
            throw new Error(`Mailgun auth failed (${res.status}): ${body}`);
        }
        return true;
    }
}

// ============================================================
// Amazon SES  —  Uses SMTP relay (no AWS SDK needed)
// Pre-fills host/port for the selected region.
// ============================================================
class AmazonSESTransport extends ApiTransport {
    /**
     * SES uses standard SMTP via Nodemailer, but this helper returns the
     * correct SMTP settings for a given region so the UI can auto-fill.
     */
    static getSmtpSettings(region) {
        region = region || 'us-east-1';
        return {
            host: `email-smtp.${region}.amazonaws.com`,
            port: 587,
            secure: false,
            auth_type: 'login'
        };
    }

    // SES API v2 via HTTP — POST /v2/email/outbound-emails
    async sendMail(mailOptions) {
        const region = this.config.api_region || 'us-east-1';
        const from = this.parseFrom(mailOptions.from);
        const fromStr = from.name ? `${from.name} <${from.email}>` : from.email;

        const payload = {
            Content: {
                Simple: {
                    Subject: { Data: mailOptions.subject || '', Charset: 'UTF-8' },
                    Body: {}
                }
            },
            Destination: { ToAddresses: [mailOptions.to] },
            FromEmailAddress: fromStr
        };

        if (mailOptions.html) {
            payload.Content.Simple.Body.Html = { Data: mailOptions.html, Charset: 'UTF-8' };
        }
        if (mailOptions.text) {
            payload.Content.Simple.Body.Text = { Data: mailOptions.text, Charset: 'UTF-8' };
        }
        if (mailOptions.replyTo) {
            payload.ReplyToAddresses = [mailOptions.replyTo];
        }

        // SES v2 SendEmail via REST needs AWS Signature V4 which is complex.
        // For simplicity, SES should use SMTP mode. If someone picks 'amazon_ses' provider
        // we fall back to Nodemailer SMTP with auto-configured host.
        // This class exists mainly for the verify() and auto-config helpers.
        throw new Error('Amazon SES uses SMTP transport. Configure it with SMTP mode or use the auto-fill settings.');
    }

    async verify() {
        // SES verification goes through SMTP — Nodemailer handles this
        return true;
    }
}

// ============================================================
// Postmark  —  POST https://api.postmarkapp.com/email
// ============================================================
class PostmarkTransport extends ApiTransport {
    async sendMail(mailOptions) {
        const from = this.parseFrom(mailOptions.from);
        const fromStr = from.name ? `${from.name} <${from.email}>` : from.email;

        const payload = {
            From: fromStr,
            To: mailOptions.to,
            Subject: mailOptions.subject || '',
            HtmlBody: mailOptions.html || undefined,
            TextBody: mailOptions.text || undefined,
            ReplyTo: mailOptions.replyTo || undefined,
            MessageStream: 'outbound'
        };

        const attachments = this.parseAttachments(mailOptions.attachments);
        if (attachments.length > 0) {
            payload.Attachments = attachments.map(a => ({
                Name: a.filename,
                Content: a.content,
                ContentType: a.contentType
            }));
        }

        const res = await fetch('https://api.postmarkapp.com/email', {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'X-Postmark-Server-Token': this.apiKey
            },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            const body = await res.text();
            throw new Error(`Postmark API error (${res.status}): ${body}`);
        }

        const json = await res.json();
        return { messageId: json.MessageID || 'postmark-ok' };
    }

    async verify() {
        const res = await fetch('https://api.postmarkapp.com/server', {
            headers: {
                'Accept': 'application/json',
                'X-Postmark-Server-Token': this.apiKey
            }
        });
        if (!res.ok) {
            const body = await res.text();
            throw new Error(`Postmark auth failed (${res.status}): ${body}`);
        }
        return true;
    }
}

// ============================================================
// SparkPost  —  POST https://api.sparkpost.com/api/v1/transmissions
// ============================================================
class SparkPostTransport extends ApiTransport {
    async sendMail(mailOptions) {
        const from = this.parseFrom(mailOptions.from);

        const payload = {
            recipients: [{ address: { email: mailOptions.to } }],
            content: {
                from: { name: from.name || undefined, email: from.email },
                subject: mailOptions.subject || '',
                html: mailOptions.html || undefined,
                text: mailOptions.text || undefined,
                reply_to: mailOptions.replyTo || undefined
            }
        };

        const attachments = this.parseAttachments(mailOptions.attachments);
        if (attachments.length > 0) {
            payload.content.attachments = attachments.map(a => ({
                name: a.filename,
                type: a.contentType,
                data: a.content
            }));
        }

        const baseUrl = (this.config.api_region === 'eu')
            ? 'https://api.eu.sparkpost.com'
            : 'https://api.sparkpost.com';

        const res = await fetch(`${baseUrl}/api/v1/transmissions`, {
            method: 'POST',
            headers: {
                'Authorization': this.apiKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            const body = await res.text();
            throw new Error(`SparkPost API error (${res.status}): ${body}`);
        }

        const json = await res.json();
        return { messageId: json.results?.id || 'sparkpost-ok' };
    }

    async verify() {
        const baseUrl = (this.config.api_region === 'eu')
            ? 'https://api.eu.sparkpost.com'
            : 'https://api.sparkpost.com';

        const res = await fetch(`${baseUrl}/api/v1/account`, {
            headers: { 'Authorization': this.apiKey }
        });
        if (!res.ok) {
            const body = await res.text();
            throw new Error(`SparkPost auth failed (${res.status}): ${body}`);
        }
        return true;
    }
}

// ============================================================
// Factory — create the right transport based on provider name
// ============================================================

const PROVIDER_MAP = {
    sendgrid: SendGridTransport,
    mailgun: MailgunTransport,
    amazon_ses: AmazonSESTransport,
    postmark: PostmarkTransport,
    sparkpost: SparkPostTransport
};

/**
 * List of supported API providers (for UI dropdowns)
 */
export const SUPPORTED_PROVIDERS = [
    { id: 'smtp',       name: 'SMTP (Generic)',     fields: ['host', 'port', 'secure', 'auth_type', 'username', 'password'] },
    { id: 'sendgrid',   name: 'SendGrid',           fields: ['api_key', 'from_email', 'from_name'] },
    { id: 'mailgun',    name: 'Mailgun',             fields: ['api_key', 'api_domain', 'api_region', 'from_email', 'from_name'] },
    { id: 'amazon_ses', name: 'Amazon SES (SMTP)',   fields: ['api_region', 'username', 'password', 'from_email', 'from_name'] },
    { id: 'postmark',   name: 'Postmark',            fields: ['api_key', 'from_email', 'from_name'] },
    { id: 'sparkpost',  name: 'SparkPost',           fields: ['api_key', 'api_region', 'from_email', 'from_name'] },
    { id: 'gsuite',     name: 'Google Workspace / Gmail', fields: ['username', 'password', 'from_email', 'from_name'] }
];

/**
 * Create an API transport for the given provider config.
 * Returns an object with sendMail() and verify() methods.
 * Returns null for SMTP / GSuite / SES (they use Nodemailer).
 */
export function createApiTransport(smtpConfig) {
    const provider = smtpConfig.provider || 'smtp';

    // These providers use Nodemailer SMTP transport
    if (provider === 'smtp' || provider === 'gsuite' || provider === 'amazon_ses') {
        return null;
    }

    const TransportClass = PROVIDER_MAP[provider];
    if (!TransportClass) return null;

    return new TransportClass(smtpConfig);
}

/**
 * Test/verify an API provider connection.
 * For SMTP-based providers, returns null (caller should use Nodemailer verify).
 */
export async function verifyApiProvider(provider, config) {
    if (provider === 'smtp' || provider === 'gsuite' || provider === 'amazon_ses') {
        return null; // Use Nodemailer verify
    }

    const TransportClass = PROVIDER_MAP[provider];
    if (!TransportClass) {
        throw new Error(`Unknown provider: ${provider}`);
    }

    const transport = new TransportClass(config);
    await transport.verify();
    return true;
}

/**
 * Get auto-fill SMTP settings for providers that use Nodemailer.
 */
export function getProviderSmtpDefaults(provider, region) {
    switch (provider) {
        case 'gsuite':
            return { host: 'smtp.gmail.com', port: 465, secure: true, auth_type: 'login' };
        case 'amazon_ses':
            return AmazonSESTransport.getSmtpSettings(region);
        case 'sendgrid':
            // SendGrid also supports SMTP as fallback
            return { host: 'smtp.sendgrid.net', port: 587, secure: false, auth_type: 'login' };
        case 'mailgun':
            return { host: 'smtp.mailgun.org', port: 587, secure: false, auth_type: 'login' };
        case 'postmark':
            return { host: 'smtp.postmarkapp.com', port: 587, secure: false, auth_type: 'login' };
        case 'sparkpost':
            return { host: 'smtp.sparkpostmail.com', port: 587, secure: false, auth_type: 'login' };
        default:
            return null;
    }
}
