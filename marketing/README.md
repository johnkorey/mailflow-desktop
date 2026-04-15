# MailFlow Marketing Video

Programmatic video generator for MailFlow Desktop marketing. Built with
[Remotion](https://www.remotion.dev) — React components rendered frame-
by-frame into an MP4.

## Output

`output/MailFlow-Marketing-v1.mp4` — 3:30, 1920×1080, 30fps, ~41 MB.

Burns captions into the video (silent version). Add your voiceover +
background music in any editor (Premiere, DaVinci Resolve, CapCut,
Shotcut). The full voiceover script is in `voiceover-script.md`.

## Regenerating the video

```bash
cd marketing
npm install         # first time only — installs Remotion + Chrome headless (~300 MB)
npm run build       # renders the full 3:30 (~15-25 min on a typical machine)
npm run preview     # renders just the first 5 seconds for quick iteration
npm start           # opens Remotion Studio — live-edit scenes with hot reload
```

## Structure

```
marketing/
├── package.json
├── remotion.config.ts
├── tsconfig.json
├── voiceover-script.md          ← VO script ready for recording
├── public/
│   └── logo.png                 ← copied from ../public/img/
├── src/
│   ├── index.ts                 ← registerRoot entry
│   ├── Root.tsx                 ← composition registry
│   ├── MailFlowVideo.tsx        ← main composition, sequences all 7 scenes
│   ├── scenes/
│   │   ├── Hook.tsx             (0-15s)    Problem statement + spam stat
│   │   ├── BrandReveal.tsx      (15-30s)   Logo + tagline
│   │   ├── CoreSending.tsx      (30-60s)   SMTP rotation, recipient import, monitor
│   │   ├── Deliverability.tsx   (60-110s)  6 deliverability features (flagship scene)
│   │   ├── Content.tsx          (110-150s) Placeholders, rotation, attachments
│   │   ├── Trust.tsx            (150-180s) Encryption, compliance, security
│   │   └── CallToAction.tsx     (180-210s) Telegram CTA, platform availability
│   └── components/
│       ├── tokens.ts            ← colors + fonts matching MailFlow UI
│       ├── BackgroundGrid.tsx   ← animated purple backdrop
│       ├── Captions.tsx         ← burned-in subtitle overlay
│       ├── FeatureCallout.tsx   ← pill-style feature badges
│       └── UIMockup.tsx         ← AppWindow + Card primitives (re-creates MailFlow UI)
└── output/
    ├── MailFlow-Marketing-v1.mp4  ← final deliverable
    └── preview.mp4                ← 5-second sanity preview
```

## Customizing

**Changing copy**: on-screen captions live in each scene's `<Captions lines={[...]} />`
call. Edit the text, re-render.

**Changing scene length**: adjust `durationInFrames` in `MailFlowVideo.tsx`
for that `<Sequence>`. Total must equal `DURATION_IN_FRAMES` in `Root.tsx`.

**Changing brand colors**: `src/components/tokens.ts` — all scenes pull from here.

**Swapping the Telegram CTA for a URL**: edit `src/scenes/CallToAction.tsx`,
replace the "Message us on Telegram..." block.

## Notes

- This folder is intentionally separate from the desktop app and should
  not be bundled into the NSIS installer — it's a dev-only tool.
- Add `marketing/node_modules/` and `marketing/output/` to `.gitignore`
  if you want to keep them out of git (the source `.tsx` files are fine
  to commit).
- If you want a vertical (TikTok/Reels) version, change `WIDTH` and
  `HEIGHT` in `Root.tsx` to 1080×1920. Most scenes will need layout
  tweaks — not a free reflow.
