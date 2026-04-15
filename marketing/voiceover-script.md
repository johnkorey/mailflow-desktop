# MailFlow Marketing Video — Voiceover Script

**Total runtime**: 3:30 (210 seconds)
**Format**: 1920×1080, 30fps, MP4 (H.264, CRF 18)
**File**: `output/MailFlow-Marketing-v1.mp4`

Record the VO yourself or paste this into [ElevenLabs](https://elevenlabs.io) / [Play.ht](https://play.ht) for AI narration.
Recommended voice: warm, confident, mid-paced (~155 words/minute).

---

## SCENE 1 — HOOK (0:00 – 0:15)

> You spent hours crafting the perfect email. You wrote it. You sent it.
> And it landed… in spam. Again.

*[beat]*

---

## SCENE 2 — BRAND REVEAL (0:15 – 0:30)

> It's time to fix that. Meet MailFlow. Send emails that truly deliver.

---

## SCENE 3 — CORE SENDING POWER (0:30 – 1:00)

> MailFlow is a professional Windows bulk email sender built for agencies,
> cold-outreach teams, and serious marketers. Import thousands of
> recipients by CSV or drag-and-drop. Rotate through unlimited SMTP
> servers — round-robin or parallel batches. Schedule campaigns for the
> perfect send time. Watch every email go out in real-time.

---

## SCENE 4 — THE DELIVERABILITY EDGE (1:00 – 1:50)

> But MailFlow isn't just a sender. It's a deliverability weapon. Every
> email automatically gets a plain-text alternative that spam filters
> love. Every message carries a unique fingerprint so ISPs can't flag
> your batch as bulk. Your Message-ID domain aligns with your From
> address so DKIM and SPF checks pass cleanly. Send delays are
> randomized to look human, not machine. Choose from thirty-plus
> encoding options — Base64, Quoted-Printable, every ISO and Windows
> charset you need for global campaigns. And the built-in Inbox Finder
> sends actual test emails to Gmail, Outlook, and Yahoo so you know
> where your campaigns land before you press send.

---

## SCENE 5 — CONTENT MASTERY (1:50 – 2:30)

> Personalize every email with fifty-plus dynamic placeholders —
> recipient names, dates, random values, even fake identity generators.
> Rotate subjects, sender names, and CTA links across your batch. Embed
> QR codes per recipient. Attach files from your library — HTML, PDF,
> DOCX, XLSX, images — MailFlow converts formats automatically. Never
> lose a draft again with automatic saving.

---

## SCENE 6 — TRUST & COMPLIANCE (2:30 – 3:00)

> Your credentials are locked down with military-grade AES-256-GCM
> encryption. Every email includes one-click unsubscribe — CAN-SPAM
> and GDPR compliant out of the box. Licenses are cryptographically
> signed. Automatic updates keep you secure. Your data never leaves
> your machine.

---

## SCENE 7 — CALL TO ACTION (3:00 – 3:30)

> Stop guessing. Start delivering. MailFlow is available now for
> Windows — with Mac coming soon. Message the admin who posted this
> video on Telegram to get your license. Send emails that truly deliver.

---

## Post-production tips

- **Music**: Layer a soft electronic/corporate bed at -18 dB under the VO.
  CC0 options: [freepd.com](https://freepd.com), [pixabay.com/music](https://pixabay.com/music).
  Suggested genres: "tech", "corporate", "ambient".
- **Audio mix**: Duck music -6 dB whenever VO plays.
- **Captions**: Already burned in on-screen. If you add your own VO with
  different pacing, you may want to regenerate by tweaking the
  caption timings in each scene component under `src/scenes/`.
- **Platforms**:
  - YouTube: upload as-is.
  - LinkedIn/Twitter: compress to 720p with HandBrake to stay under
    file size limits. `ffmpeg -i MailFlow-Marketing-v1.mp4 -vf scale=1280:720 -c:v libx264 -crf 23 MailFlow-720p.mp4`
  - TikTok/Reels: requires vertical re-cut. Not handled here; either
    rent a video editor or rebuild with 1080×1920 in `remotion.config.ts`.
