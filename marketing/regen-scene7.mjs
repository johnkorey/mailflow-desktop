// One-off: regenerate just scene-7.mp3 with the updated CTA wording.
import {MsEdgeTTS, OUTPUT_FORMAT} from 'msedge-tts';
import fs from 'fs';

const tts = new MsEdgeTTS();
await tts.setMetadata('en-US-GuyNeural', OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
const text = `Stop guessing. Start delivering. MailFlow is available now for Windows, with Mac coming soon. Contact admin on Telegram to get your license. Send emails that truly deliver.`;
const {audioStream} = tts.toStream(text);
const chunks = [];
for await (const chunk of audioStream) chunks.push(chunk);
const buffer = Buffer.concat(chunks);
fs.writeFileSync('public/audio/scene-7.mp3', buffer);
console.log('scene-7.mp3 regenerated: ' + (buffer.length / 1024).toFixed(0) + ' KB');
