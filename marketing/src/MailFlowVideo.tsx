import React from 'react';
import {AbsoluteFill, Audio, Sequence, staticFile} from 'remotion';
import {Hook} from './scenes/Hook';
import {BrandReveal} from './scenes/BrandReveal';
import {CoreSending} from './scenes/CoreSending';
import {Deliverability} from './scenes/Deliverability';
import {Content} from './scenes/Content';
import {Trust} from './scenes/Trust';
import {CallToAction} from './scenes/CallToAction';

// Vertical 1080×1920 composition with scene durations tightly matched
// to each scene's voiceover length. Each scene gets its VO duration
// plus a short buffer so the visuals can breathe after the narrator.
//
// Scene durations (frames @ 30fps):
//   Hook           360   (12s — VO 10.5s + 1.5s buffer)
//   BrandReveal    255   (8.5s — VO 7.0s + 1.5s buffer)
//   CoreSending    750   (25s — VO 23.1s + 2s buffer)
//   Deliverability 1350  (45s — VO 43.3s + 1.7s buffer)
//   Content        1020  (34s — VO 31.7s + 2.3s buffer)
//   Trust          690   (23s — VO 20.9s + 2.1s buffer)
//   CallToAction   500   (16.7s — VO 14.6s + 2.1s buffer)
//   Total:         4925 frames = 164.2s = 2:44
export const MailFlowVideo: React.FC = () => {
    return (
        <AbsoluteFill style={{backgroundColor: '#050508'}}>
            <Sequence from={0} durationInFrames={360}>
                <Audio src={staticFile('audio/scene-1.mp3')} volume={1} />
                <Hook />
            </Sequence>
            <Sequence from={360} durationInFrames={255}>
                <Audio src={staticFile('audio/scene-2.mp3')} volume={1} />
                <BrandReveal />
            </Sequence>
            <Sequence from={615} durationInFrames={750}>
                <Audio src={staticFile('audio/scene-3.mp3')} volume={1} />
                <CoreSending />
            </Sequence>
            <Sequence from={1365} durationInFrames={1350}>
                <Audio src={staticFile('audio/scene-4.mp3')} volume={1} />
                <Deliverability />
            </Sequence>
            <Sequence from={2715} durationInFrames={1020}>
                <Audio src={staticFile('audio/scene-5.mp3')} volume={1} />
                <Content />
            </Sequence>
            <Sequence from={3735} durationInFrames={690}>
                <Audio src={staticFile('audio/scene-6.mp3')} volume={1} />
                <Trust />
            </Sequence>
            <Sequence from={4425} durationInFrames={500}>
                <Audio src={staticFile('audio/scene-7.mp3')} volume={1} />
                <CallToAction />
            </Sequence>
        </AbsoluteFill>
    );
};
