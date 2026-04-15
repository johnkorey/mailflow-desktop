import React from 'react';
import {AbsoluteFill, Audio, Sequence, staticFile} from 'remotion';
import {Hook} from './scenes/Hook';
import {BrandReveal} from './scenes/BrandReveal';
import {Deliverability} from './scenes/Deliverability';
import {CallToAction} from './scenes/CallToAction';

// 45-second highlight cut for TikTok / Reels / LinkedIn mobile feeds.
// Compresses the most impactful beats: hook, brand, top deliverability
// features, and CTA. Timing tuned for short-form attention spans.
//
//   0-10s  Hook (300 frames)
//   10-15s Brand reveal (150 frames)
//   15-35s Deliverability highlights (600 frames)
//   35-45s CTA (300 frames)
//   Total: 1350 frames = 45s
export const MailFlowShort: React.FC = () => {
    return (
        <AbsoluteFill style={{backgroundColor: '#050508'}}>
            <Sequence from={0} durationInFrames={300}>
                <Audio src={staticFile('audio/scene-1.mp3')} volume={1} />
                <Hook />
            </Sequence>
            <Sequence from={300} durationInFrames={150}>
                <Audio src={staticFile('audio/scene-2.mp3')} volume={1} />
                <BrandReveal />
            </Sequence>
            <Sequence from={450} durationInFrames={600}>
                <Audio src={staticFile('audio/scene-4.mp3')} volume={0.85} />
                <Deliverability />
            </Sequence>
            <Sequence from={1050} durationInFrames={300}>
                <Audio src={staticFile('audio/scene-7.mp3')} volume={1} />
                <CallToAction />
            </Sequence>
        </AbsoluteFill>
    );
};
