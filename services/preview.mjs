/**
 * Send preview + spam score service.
 *
 * Renders a campaign as it would appear to a real recipient (with placeholders
 * substituted) WITHOUT actually sending. Also computes a heuristic spam score
 * based on common trigger words and patterns.
 */

import crypto from 'crypto';
import { faker } from '@faker-js/faker';

/**
 * Spam trigger words. Loosely organized — each match adds to the score.
 * Based on commonly-cited Spamhaus / Apache SpamAssassin signal lists.
 */
const SPAM_WORDS = [
    // Money / urgency
    'free', 'guarantee', 'guaranteed', 'urgent', 'act now', 'limited time',
    'offer expires', 'while supplies last', 'risk-free', 'money back',
    'cash', '100% free', 'no cost', 'no fees', 'no obligation',
    // Hype
    'amazing', 'incredible', 'unbelievable', 'shocking', 'congratulations',
    'winner', 'prize', 'won', 'selected', 'special promotion',
    // Aggressive sales
    'buy now', 'order now', 'click here', 'click below', 'apply now',
    'subscribe', 'increase sales', 'extra income', 'work from home',
    // Pharma / scam patterns
    'viagra', 'cialis', 'weight loss', 'lose weight', 'diet', 'enlargement',
    'crypto', 'bitcoin', 'forex', 'investment opportunity',
    // Generic spam
    'meet singles', 'pre-approved', 'credit', 'debt', 'lowest price',
    'best price', 'cheap', 'discount', 'save big', 'save up to'
];

/**
 * Compute a 0-10 spam score for a piece of text.
 * Returns { score, flags: [{ word, count }], reasons: [string] }
 */
export function computeSpamScore(subject, htmlBody, textBody) {
    const subjectLower = (subject || '').toLowerCase();
    const bodyText = stripHtml(htmlBody || '') + ' ' + (textBody || '');
    const bodyLower = bodyText.toLowerCase();
    const flags = [];
    const reasons = [];
    let score = 0;

    // 1. Spam trigger words
    for (const word of SPAM_WORDS) {
        const subjMatches = (subjectLower.match(new RegExp('\\b' + escapeRegex(word) + '\\b', 'g')) || []).length;
        const bodyMatches = (bodyLower.match(new RegExp('\\b' + escapeRegex(word) + '\\b', 'g')) || []).length;
        const total = subjMatches + bodyMatches;
        if (total > 0) {
            // Subject hits weighted heavier
            score += subjMatches * 1.5 + bodyMatches * 0.5;
            flags.push({ word, count: total });
        }
    }

    // 2. ALL CAPS WORDS in subject (5+ chars)
    const capsInSubject = (subject || '').match(/\b[A-Z]{5,}\b/g) || [];
    if (capsInSubject.length > 0) {
        score += capsInSubject.length * 1.5;
        reasons.push(`${capsInSubject.length} all-caps word(s) in subject`);
    }

    // 3. Excessive exclamation marks
    const subjectExclam = ((subject || '').match(/!/g) || []).length;
    if (subjectExclam >= 2) {
        score += subjectExclam;
        reasons.push(`${subjectExclam} exclamation mark(s) in subject`);
    }
    const bodyExclam = ((bodyText || '').match(/!/g) || []).length;
    if (bodyExclam >= 5) {
        score += Math.min(3, bodyExclam / 5);
        reasons.push(`${bodyExclam} exclamation marks in body`);
    }

    // 4. Dollar signs / money symbols in subject
    if (/\$\$|\$\d+/.test(subject || '')) {
        score += 2;
        reasons.push('Money amount in subject');
    }

    // 5. Subject too long
    if ((subject || '').length > 100) {
        score += 1;
        reasons.push('Subject longer than 100 chars');
    }

    // 6. No plain text fallback
    if (!textBody || textBody.trim().length === 0) {
        score += 1;
        reasons.push('No plain-text alternative — multipart MIME recommended');
    }

    // 7. Many links
    const linkCount = (htmlBody || '').match(/<a\s/gi)?.length || 0;
    if (linkCount > 8) {
        score += Math.min(2, (linkCount - 8) / 4);
        reasons.push(`${linkCount} links in body`);
    }

    // 8. Image-only (almost no text)
    if (bodyText.trim().length < 50 && (htmlBody || '').includes('<img')) {
        score += 2;
        reasons.push('Mostly images, very little text');
    }

    // Cap at 10
    score = Math.min(10, Math.round(score * 10) / 10);

    let level = 'good';
    let levelText = 'Looks good';
    if (score >= 7) { level = 'bad'; levelText = 'High spam risk'; }
    else if (score >= 4) { level = 'warn'; levelText = 'Some warnings'; }

    return { score, level, levelText, flags, reasons };
}

function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripHtml(html) {
    return (html || '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Build a simplified placeholder map for preview purposes. Uses sample data
 * for the recipient (so we don't need a real campaign recipient to preview).
 */
function buildPreviewPlaceholders(sampleRecipient) {
    const recipient = sampleRecipient || { email: 'jane.doe@example.com', name: 'Jane Doe' };
    const recipientName = recipient.name || 'Jane Doe';
    const recipientDomain = recipient.email.split('@')[1] || 'example.com';
    const nameParts = recipientName.split(/\s+/);
    const firstName = nameParts[0] || 'Jane';
    const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : 'Doe';
    const now = new Date();
    const pad2 = (n) => String(n).padStart(2, '0');

    // Faker sample data
    const fakeFirstName = faker.person.firstName();
    const fakeLastName = faker.person.lastName();
    const fakeFullName = `${fakeFirstName} ${fakeLastName}`;
    const fakeEmail = faker.internet.email({ firstName: fakeFirstName, lastName: fakeLastName });

    return {
        '{RECIPIENT_NAME}': recipientName,
        '{RECIPIENT_FIRST_NAME}': firstName,
        '{RECIPIENT_LAST_NAME}': lastName,
        '{RECIPIENT_EMAIL}': recipient.email,
        '{RECIPIENT_DOMAIN}': recipientDomain,
        '{RECIPIENT_DOMAIN_NAME}': recipientDomain.split('.')[0].charAt(0).toUpperCase() + recipientDomain.split('.')[0].slice(1),
        '{RECIPIENT_BASE64_EMAIL}': Buffer.from(recipient.email).toString('base64'),
        '{CURRENT_DATE}': now.toLocaleDateString(),
        '{CURRENT_TIME}': now.toLocaleTimeString(),
        '{CURRENT_YEAR}': String(now.getFullYear()),
        '{CURRENT_WEEKDAY}': now.toLocaleDateString('en-US', { weekday: 'long' }),
        '{CURRENT_MONTH}': now.toLocaleDateString('en-US', { month: 'long' }),
        '{CURRENT_DAY}': pad2(now.getDate()),
        '{DATE_ISO}': `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`,
        '{DATE_LONG}': now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
        '{TIME_24H}': `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`,
        '{TIMESTAMP}': String(Math.floor(now.getTime() / 1000)),
        '{RANDOM_NUMBER4}': '4821',
        '{RANDOM_NUMBER6}': '049281',
        '{RANDOM_NUMBER10}': '8472019384',
        '{RANDOM_STRING}': crypto.randomBytes(20).toString('hex'),
        '{RANDOM_MD5}': crypto.createHash('md5').update('preview').digest('hex'),
        '{RANDOM_UUID}': crypto.randomUUID(),
        '{RANDOM_PRICE}': '$47.05',
        '{FAKE_COMPANY}': 'Acme Corporation',
        '{FAKE_COMPANY_EMAIL}': fakeEmail,
        '{FAKE_FIRST_NAME}': fakeFirstName,
        '{FAKE_LAST_NAME}': fakeLastName,
        '{FAKE_FULL_NAME}': fakeFullName,
        '{FAKE_PHONE}': '(555) 123-4567',
        '{FAKE_ADDRESS}': '123 Main Street',
        '{FAKE_CITY}': 'Springfield',
        '{FAKE_JOB_TITLE}': 'Marketing Director',
        '{FAKE_DEPARTMENT}': 'Customer Success',
        '{FAKE_INVOICE_NUMBER}': `INV-${now.getFullYear()}-04829`,
        '{FAKE_ORDER_NUMBER}': 'ORD-7384921',
        '{FAKE_TRACKING_NUMBER}': '1Z' + crypto.randomBytes(8).toString('hex').toUpperCase(),
        '{LINK}': 'https://example.com/cta',
        '{CTA_LINK}': 'https://example.com/cta',
        '{RANDLINK}': 'https://example.com/r/abc123',
        '{UNSUBSCRIBE_LINK}': 'http://localhost:3000/u/preview-token',
        '{UNSUBSCRIBE_URL}': 'http://localhost:3000/u/preview-token',
        '{QR_CODE}': '[QR code placeholder]'
    };
}

/**
 * Replace placeholders in a string. Case-insensitive matching like the
 * production sender.
 */
function replacePlaceholders(text, placeholders) {
    if (!text) return '';
    let out = text.replace(/&#123;/g, '{').replace(/&#125;/g, '}');
    for (const [key, value] of Object.entries(placeholders)) {
        const escaped = key.replace(/[{}]/g, '\\$&');
        const regex = new RegExp(escaped, 'gi');
        out = out.replace(regex, () => value);
    }
    return out;
}

/**
 * Build a complete preview of a campaign without sending.
 *
 * @param {object} campaign - Campaign row from db
 * @param {object} sampleRecipient - { email, name } for placeholder substitution
 * @returns {{ subject, html, text, score }}
 */
export function buildCampaignPreview(campaign, sampleRecipient) {
    const placeholders = buildPreviewPlaceholders(sampleRecipient);
    const subject = replacePlaceholders(campaign.subject || '', placeholders);
    const html = replacePlaceholders(campaign.body_html || '', placeholders);
    const text = replacePlaceholders(campaign.body_text || '', placeholders);
    const score = computeSpamScore(subject, html, text);
    return { subject, html, text, score };
}
