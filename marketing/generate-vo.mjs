/**
 * Generates the voiceover audio files for each scene using Microsoft Edge's
 * neural TTS. Uses the same voices Azure Cognitive Services sells —
 * free via Edge's read-aloud endpoint, no API key needed.
 *
 * Usage:   node generate-vo.js
 * Output:  public/audio/scene-{1..7}.mp3
 */
import {MsEdgeTTS, OUTPUT_FORMAT} from 'msedge-tts';
import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUDIO_DIR = path.join(__dirname, 'public', 'audio');
fs.mkdirSync(AUDIO_DIR, {recursive: true});

// Voice: en-US-GuyNeural — warm, confident, conversational male. This is
// one of the top-rated free neural voices available via Edge TTS.
const VOICE = 'en-US-GuyNeural';

const scenes = [
    {id: 1, name: 'Hook', text: `You spent hours crafting the perfect email. You wrote it. You sent it. And it landed in spam. Again.`},
    {id: 2, name: 'BrandReveal', text: `It's time to fix that. Meet MailFlow. Send emails that truly deliver.`},
    {id: 3, name: 'CoreSending', text: `MailFlow is a professional Windows bulk email sender built for agencies, cold-outreach teams, and serious marketers. Import thousands of recipients by CSV or drag and drop. Rotate through unlimited SMTP servers, round-robin or parallel batches. Schedule campaigns for the perfect send time. Watch every email go out in real time.`},
    {id: 4, name: 'Deliverability', text: `But MailFlow isn't just a sender. It's a deliverability weapon. Every email automatically gets a plain text alternative that spam filters love. Every message carries a unique fingerprint so ISPs can't flag your batch as bulk. Your Message-ID domain aligns with your From address so DKIM and SPF checks pass cleanly. Send delays are randomized to look human, not machine. Choose from thirty plus encoding options. Base 64, Quoted Printable, every ISO and Windows charset you need for global campaigns. And the built-in Inbox Finder sends actual test emails to Gmail, Outlook, and Yahoo so you know where your campaigns land before you press send.`},
    {id: 5, name: 'Content', text: `Personalize every email with fifty plus dynamic placeholders. Recipient names, dates, random values, even fake identity generators. Rotate subjects, sender names, and CTA links across your batch. Embed QR codes per recipient. Attach files from your library. HTML, PDF, DOCX, XLSX, images. MailFlow converts formats automatically. Never lose a draft again with automatic saving.`},
    {id: 6, name: 'Trust', text: `Your credentials are locked down with military grade AES 256 GCM encryption. Every email includes one click unsubscribe, CAN-SPAM and GDPR compliant out of the box. Licenses are cryptographically signed. Automatic updates keep you secure. Your data never leaves your machine.`},
    {id: 7, name: 'CallToAction', text: `Stop guessing. Start delivering. MailFlow is available now for Windows, with Mac coming soon. Contact admin on Telegram to get your license. Send emails that truly deliver.`},
];

async function synthOne(tts, scene) {
    const outFile = path.join(AUDIO_DIR, `scene-${scene.id}.mp3`);
    const {audioStream} = tts.toStream(scene.text);
    const chunks = [];
    for await (const chunk of audioStream) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);
    fs.writeFileSync(outFile, buffer);
    return {outFile, size: buffer.length};
}

async function generate() {
    const tts = new MsEdgeTTS();
    await tts.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);

    for (const scene of scenes) {
        process.stdout.write(`  scene ${scene.id} (${scene.name})…`);
        try {
            const {size} = await synthOne(tts, scene);
            process.stdout.write(` ${(size / 1024).toFixed(0)} KB\n`);
        } catch (e) {
            process.stdout.write(` FAILED: ${e.message}\n`);
            throw e;
        }
    }

    console.log('\nAll 7 voiceover files written to public/audio/');
}

generate().catch((err) => {
    console.error('TTS generation failed:', err);
    process.exit(1);
});
