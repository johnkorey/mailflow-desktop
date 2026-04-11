/**
 * Attachment Converter Service
 * Converts HTML content to various formats for email attachments
 * Uses Puppeteer for real PDF/JPG/PNG generation
 */

import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

let browserInstance = null;

function findChrome() {
    // Check puppeteer cache first
    const cacheDir = path.join(process.env.USERPROFILE || process.env.HOME || '', '.cache', 'puppeteer', 'chrome');
    if (fs.existsSync(cacheDir)) {
        const versions = fs.readdirSync(cacheDir).filter(d => d.startsWith('win'));
        for (const ver of versions) {
            const exe = path.join(cacheDir, ver, 'chrome-win64', 'chrome.exe');
            if (fs.existsSync(exe)) return exe;
            // Flat layout
            const exeFlat = path.join(cacheDir, ver, 'chrome.exe');
            if (fs.existsSync(exeFlat)) return exeFlat;
        }
    }
    // Common Chrome install paths
    const paths = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe')
    ].filter(Boolean);
    for (const p of paths) {
        if (fs.existsSync(p)) return p;
    }
    return null;
}

async function getBrowser() {
    if (!browserInstance || !browserInstance.isConnected()) {
        const executablePath = findChrome();
        if (!executablePath) {
            throw new Error('Chrome not found. Install Google Chrome for PDF/image attachment conversion.');
        }
        console.log('[Converter] Using Chrome at:', executablePath);
        browserInstance = await puppeteer.launch({
            headless: 'new',
            executablePath,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
        });
    }
    return browserInstance;
}

function wrapHtml(htmlContent, filename) {
    if (htmlContent.toLowerCase().includes('<!doctype') || htmlContent.toLowerCase().includes('<html')) {
        return htmlContent;
    }
    return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
body { font-family: Arial, sans-serif; margin: 20px; }
table { border-collapse: collapse; width: 100%; }
th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
th { background-color: #f4f4f4; }
img { max-width: 100%; }
</style>
<title>${filename}</title></head>
<body>${htmlContent}</body></html>`;
}

/**
 * After loading HTML into a Puppeteer page, remove all @media print rules
 * and force all elements to be visible. This ensures buttons/CTAs appear in PDFs.
 */
async function neutralizePrintStyles(page) {
    // 1. Remove all @media print CSS rules from every stylesheet
    await page.evaluate(() => {
        for (const sheet of document.styleSheets) {
            try {
                const rules = sheet.cssRules || sheet.rules;
                for (let i = rules.length - 1; i >= 0; i--) {
                    if (rules[i].type === CSSRule.MEDIA_RULE &&
                        rules[i].conditionText &&
                        rules[i].conditionText.includes('print')) {
                        sheet.deleteRule(i);
                    }
                }
            } catch (e) { /* cross-origin sheets, ignore */ }
        }
    });
    // 2. Force visibility and background printing
    await page.addStyleTag({
        content: `
            * {
                visibility: visible !important;
                opacity: 1 !important;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
            }
            button, a, .button, .btn, .cta, [role="button"] {
                display: inline-block !important;
            }
        `
    });
    await new Promise(r => setTimeout(r, 200));
}

/**
 * For image formats (JPG/PNG/SVG), images can't have clickable links.
 * This exposes the link URL as visible text beneath each button/link
 * so the recipient can see where the CTA points.
 */
async function exposeLinksAsText(page) {
    await page.evaluate(() => {
        // Find all anchor tags inside or wrapping buttons
        const links = document.querySelectorAll('a[href]');
        for (const link of links) {
            const href = link.getAttribute('href');
            if (!href || href.startsWith('#') || href.startsWith('javascript')) continue;
            // Add visible URL below the link
            const urlLabel = document.createElement('div');
            urlLabel.textContent = href;
            urlLabel.style.cssText = 'font-size:11px;color:#007BFF;margin-top:5px;word-break:break-all;text-align:center;';
            link.parentNode.insertBefore(urlLabel, link.nextSibling);
        }
        // Also handle buttons with onclick that aren't wrapped in <a>
        const buttons = document.querySelectorAll('button');
        for (const btn of buttons) {
            const parentLink = btn.closest('a[href]');
            if (parentLink) continue; // already handled above
            const childLink = btn.querySelector('a[href]');
            if (childLink) {
                const href = childLink.getAttribute('href');
                const urlLabel = document.createElement('div');
                urlLabel.textContent = href;
                urlLabel.style.cssText = 'font-size:11px;color:#007BFF;margin-top:5px;word-break:break-all;text-align:center;';
                btn.parentNode.insertBefore(urlLabel, btn.nextSibling);
            }
        }
    });
    await new Promise(r => setTimeout(r, 100));
}

/**
 * Keep as HTML attachment
 */
export function htmlToHtml(htmlContent, filename = 'document') {
    return {
        content: Buffer.from(wrapHtml(htmlContent, filename)).toString('base64'),
        filename: `${filename}.html`,
        mimeType: 'text/html'
    };
}

/**
 * Convert HTML to real PDF using Puppeteer
 */
export async function htmlToPdf(htmlContent, filename = 'document') {
    const browser = await getBrowser();
    const page = await browser.newPage();
    try {
        await page.emulateMediaType('screen');
        await page.setContent(wrapHtml(htmlContent, filename), { waitUntil: 'networkidle0', timeout: 15000 });
        await neutralizePrintStyles(page);
        const pdfBuffer = await page.pdf({
            format: 'A4',
            margin: { top: '2cm', right: '2cm', bottom: '2cm', left: '2cm' },
            printBackground: true
        });
        return {
            content: Buffer.from(pdfBuffer).toString('base64'),
            filename: `${filename}.pdf`,
            mimeType: 'application/pdf'
        };
    } finally {
        await page.close();
    }
}

/**
 * Convert HTML to JPG using Puppeteer
 * Exposes link URLs as visible text since images can't be clickable
 */
export async function htmlToJpg(htmlContent, filename = 'document') {
    const browser = await getBrowser();
    const page = await browser.newPage();
    try {
        await page.setViewport({ width: 800, height: 600 });
        await page.emulateMediaType('screen');
        await page.setContent(wrapHtml(htmlContent, filename), { waitUntil: 'networkidle0', timeout: 15000 });
        await neutralizePrintStyles(page);
        await exposeLinksAsText(page);
        const screenshot = await page.screenshot({ type: 'jpeg', quality: 90, fullPage: true });
        return {
            content: Buffer.from(screenshot).toString('base64'),
            filename: `${filename}.jpg`,
            mimeType: 'image/jpeg'
        };
    } finally {
        await page.close();
    }
}

/**
 * Convert HTML to PNG using Puppeteer
 * Exposes link URLs as visible text since images can't be clickable
 */
export async function htmlToPng(htmlContent, filename = 'document') {
    const browser = await getBrowser();
    const page = await browser.newPage();
    try {
        await page.setViewport({ width: 800, height: 600 });
        await page.emulateMediaType('screen');
        await page.setContent(wrapHtml(htmlContent, filename), { waitUntil: 'networkidle0', timeout: 15000 });
        await neutralizePrintStyles(page);
        await exposeLinksAsText(page);
        const screenshot = await page.screenshot({ type: 'png', fullPage: true });
        return {
            content: Buffer.from(screenshot).toString('base64'),
            filename: `${filename}.png`,
            mimeType: 'image/png'
        };
    } finally {
        await page.close();
    }
}

/**
 * Convert HTML to SVG using Puppeteer (renders as PNG embedded in SVG)
 * foreignObject is unreliable in email clients, so we embed a real image
 */
export async function htmlToSvg(htmlContent, filename = 'document') {
    const browser = await getBrowser();
    const page = await browser.newPage();
    try {
        await page.setViewport({ width: 800, height: 600 });
        await page.emulateMediaType('screen');
        await page.setContent(wrapHtml(htmlContent, filename), { waitUntil: 'networkidle0', timeout: 15000 });
        await neutralizePrintStyles(page);
        await exposeLinksAsText(page);
        const screenshot = await page.screenshot({ type: 'png', fullPage: true });
        const pngBase64 = Buffer.from(screenshot).toString('base64');
        // Get actual dimensions
        const dimensions = await page.evaluate(() => ({
            w: document.body.scrollWidth,
            h: document.body.scrollHeight
        }));
        const svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${dimensions.w}" height="${dimensions.h}" viewBox="0 0 ${dimensions.w} ${dimensions.h}">
    <image width="${dimensions.w}" height="${dimensions.h}" xlink:href="data:image/png;base64,${pngBase64}"/>
</svg>`;
        return {
            content: Buffer.from(svgContent).toString('base64'),
            filename: `${filename}.svg`,
            mimeType: 'image/svg+xml'
        };
    } finally {
        await page.close();
    }
}

/**
 * Convert HTML to DOC (Microsoft Word format)
 * Uses Puppeteer to render a clean screenshot, then embeds it in a Word-compatible HTML doc
 * This ensures consistent display regardless of the source HTML complexity
 */
export async function htmlToDoc(htmlContent, filename = 'document') {
    const browser = await getBrowser();
    const page = await browser.newPage();
    try {
        await page.setViewport({ width: 800, height: 600 });
        await page.emulateMediaType('screen');
        await page.setContent(wrapHtml(htmlContent, filename), { waitUntil: 'networkidle0', timeout: 15000 });
        await neutralizePrintStyles(page);
        // Extract clean text + links for Word
        const extracted = await page.evaluate(() => {
            const result = [];
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
            let node;
            while (node = walker.nextNode()) {
                const tag = node.tagName;
                const style = getComputedStyle(node);
                if (style.display === 'none' || style.visibility === 'hidden') continue;
                if (['H1','H2','H3','H4','H5','H6'].includes(tag)) {
                    result.push({ type: 'heading', level: parseInt(tag[1]), text: node.innerText.trim() });
                } else if (tag === 'P') {
                    const text = node.innerText.trim();
                    if (text) result.push({ type: 'paragraph', text, html: node.innerHTML });
                } else if (tag === 'A' && node.href) {
                    const text = node.innerText.trim();
                    if (text && !node.closest('button')) {
                        result.push({ type: 'link', text, href: node.href });
                    }
                } else if (tag === 'BUTTON') {
                    const link = node.querySelector('a[href]');
                    const text = node.innerText.trim();
                    if (text) {
                        result.push({ type: 'button', text, href: link ? link.href : '' });
                    }
                }
            }
            return result;
        });
        // Build Word-compatible HTML from extracted content
        let wordBody = '';
        for (const item of extracted) {
            if (item.type === 'heading') {
                wordBody += `<h${item.level}>${item.text}</h${item.level}>\n`;
            } else if (item.type === 'paragraph') {
                wordBody += `<p>${item.html}</p>\n`;
            } else if (item.type === 'link') {
                wordBody += `<p><a href="${item.href}">${item.text}</a></p>\n`;
            } else if (item.type === 'button') {
                const linkHtml = item.href
                    ? `<a href="${item.href}" style="background:#007BFF;color:white;padding:10px 20px;text-decoration:none;border-radius:4px;display:inline-block;">${item.text}</a>`
                    : `<span style="background:#007BFF;color:white;padding:10px 20px;border-radius:4px;display:inline-block;">${item.text}</span>`;
                wordBody += `<p style="text-align:center;margin:20px 0;">${linkHtml}</p>\n`;
            }
        }
        // If extraction got nothing useful, fall back to raw HTML
        if (!wordBody.trim()) wordBody = htmlContent;

        const wordHtml = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
    <meta charset="UTF-8">
    <!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
    <style>
        @page { size: A4; margin: 2cm; }
        body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; line-height: 1.6; }
        h1 { font-size: 22pt; color: #222; text-align: center; }
        h2 { font-size: 16pt; color: #333; }
        p { margin: 0 0 12px 0; }
        a { color: #007BFF; }
        table { border-collapse: collapse; width: 100%; margin: 10px 0; }
        th, td { border: 1px solid #000; padding: 8px; }
        th { background-color: #f0f0f0; font-weight: bold; }
    </style>
    <title>${filename}</title>
</head>
<body>${wordBody}</body></html>`;
        return {
            content: Buffer.from(wordHtml).toString('base64'),
            filename: `${filename}.doc`,
            mimeType: 'application/msword'
        };
    } finally {
        await page.close();
    }
}

/**
 * Convert HTML to Excel format
 * Extracts visible text content into a clean table format
 */
export async function htmlToExcel(htmlContent, filename = 'document') {
    const browser = await getBrowser();
    const page = await browser.newPage();
    try {
        await page.setViewport({ width: 800, height: 600 });
        await page.setContent(wrapHtml(htmlContent, filename), { waitUntil: 'networkidle0', timeout: 15000 });
        await neutralizePrintStyles(page);
        // Extract text content into rows
        const rows = await page.evaluate(() => {
            const result = [];
            const elements = document.body.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,td,th,button,a,div,span');
            const seen = new Set();
            for (const el of elements) {
                const text = el.innerText?.trim();
                if (!text || seen.has(text)) continue;
                // Skip if parent already captured this text
                if (el.parentElement && elements.length > 0) {
                    const parentText = el.parentElement.innerText?.trim();
                    if (parentText === text && seen.has(parentText)) continue;
                }
                seen.add(text);
                const tag = el.tagName;
                let type = 'Content';
                if (['H1','H2','H3','H4','H5','H6'].includes(tag)) type = 'Heading';
                else if (tag === 'BUTTON') type = 'Button';
                else if (tag === 'A' && el.href) type = 'Link';
                else if (['TH'].includes(tag)) type = 'Table Header';
                else if (['TD'].includes(tag)) type = 'Table Data';

                const href = el.href || el.querySelector?.('a[href]')?.href || '';
                result.push({ type, text, link: href });
            }
            return result;
        });

        // Build a proper Excel HTML table
        let tableRows = '<tr><th>Type</th><th>Content</th><th>Link</th></tr>\n';
        for (const row of rows) {
            const escapedText = row.text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
            const escapedLink = row.link.replace(/&/g, '&amp;').replace(/</g, '&lt;');
            tableRows += `<tr><td>${row.type}</td><td>${escapedText}</td><td>${escapedLink}</td></tr>\n`;
        }

        const excelHtml = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="UTF-8">
<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>${filename}</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
<style>
    table { border-collapse: collapse; width: 100%; }
    td, th { border: 1px solid #000; padding: 8px; font-family: Calibri, sans-serif; font-size: 11pt; vertical-align: top; }
    th { background-color: #4472C4; color: white; font-weight: bold; }
    tr:nth-child(even) td { background-color: #D9E2F3; }
</style>
</head>
<body><table>${tableRows}</table></body></html>`;
        return {
            content: Buffer.from(excelHtml).toString('base64'),
            filename: `${filename}.xls`,
            mimeType: 'application/vnd.ms-excel'
        };
    } finally {
        await page.close();
    }
}

/**
 * Convert HTML to specified format
 */
export async function convertAttachment(htmlContent, format, filename = 'document') {
    switch (format.toLowerCase()) {
        case 'pdf':
            return await htmlToPdf(htmlContent, filename);
        case 'jpg':
        case 'jpeg':
            return await htmlToJpg(htmlContent, filename);
        case 'png':
            return await htmlToPng(htmlContent, filename);
        case 'svg':
            return await htmlToSvg(htmlContent, filename);
        case 'doc':
        case 'docx':
        case 'word':
            return await htmlToDoc(htmlContent, filename);
        case 'excel':
        case 'xls':
        case 'xlsx':
            return await htmlToExcel(htmlContent, filename);
        case 'html':
        default:
            return htmlToHtml(htmlContent, filename);
    }
}

// Cleanup browser on process exit
process.on('exit', () => { browserInstance?.close(); });
process.on('SIGINT', () => { browserInstance?.close(); process.exit(); });

export default {
    htmlToPdf, htmlToSvg, htmlToHtml, htmlToDoc, htmlToExcel, htmlToJpg, htmlToPng, convertAttachment
};
