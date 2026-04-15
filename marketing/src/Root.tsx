import React from 'react';
import {Composition} from 'remotion';
import {MailFlowVideo} from './MailFlowVideo';
import {MailFlowShort} from './MailFlowShort';

// Phone-sized vertical: 1080×1920 (9:16). Works on TikTok, Reels,
// YouTube Shorts, Instagram Stories, LinkedIn mobile feed.
export const WIDTH = 1080;
export const HEIGHT = 1920;
export const FPS = 30;

// Full ~2:44 (4925 frames) for YouTube Shorts / Stories.
// Duration matches the combined VO runtime + per-scene buffer.
export const FULL_DURATION = 4925;

// 45-second highlight cut (1350 frames) for TikTok / Reels.
export const SHORT_DURATION = 1350;

export const Root: React.FC = () => {
    return (
        <>
            <Composition
                id="MailFlowMarketing"
                component={MailFlowVideo}
                durationInFrames={FULL_DURATION}
                fps={FPS}
                width={WIDTH}
                height={HEIGHT}
            />
            <Composition
                id="MailFlowShort"
                component={MailFlowShort}
                durationInFrames={SHORT_DURATION}
                fps={FPS}
                width={WIDTH}
                height={HEIGHT}
            />
        </>
    );
};
