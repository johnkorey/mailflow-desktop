import React from 'react';
import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {colors, fonts} from '../components/tokens';
import {BackgroundGrid} from '../components/BackgroundGrid';

// SCENE 4 — DELIVERABILITY EDGE (60-110s, 1500 frames)
// Six vignettes, one per feature, each ~250 frames.
export const Deliverability: React.FC = () => {
    const frame = useCurrentFrame();
    const {fps} = useVideoConfig();

    const features = [
        {icon: '✨', title: 'Auto text/plain', desc: 'Every email gets a plain-text alternative that spam filters love.', color: colors.accent},
        {icon: '🔐', title: 'Unique fingerprint', desc: 'Each email carries a distinct hash — ESPs can\'t flag your batch as bulk.', color: '#a78bfa'},
        {icon: '🎯', title: 'Message-ID alignment', desc: 'Message-ID domain matches your From — DKIM & SPF pass cleanly.', color: colors.green},
        {icon: '⏱️', title: 'Human-like delays', desc: 'Randomized timing — no fixed-interval machine patterns for ESPs to detect.', color: colors.yellow},
        {icon: '🌍', title: '30+ encoding options', desc: 'Base64, Quoted-Printable, ISO, Windows, Shift_JIS, Big5 — any charset.', color: colors.blue},
        {icon: '📬', title: 'Inbox Finder', desc: 'Built-in test: sends real emails to Gmail, Outlook, Yahoo — see where you land before you press send.', color: '#ec4899'},
    ];

    // Scene duration = 1350 frames, 6 features.
    // 225 frames per feature puts each vignette in lock-step with the
    // VO pacing (narrator spends ~7.5s on each feature).
    const perFeature = 225;
    const activeIdx = Math.floor(frame / perFeature);
    const f = features[Math.min(activeIdx, features.length - 1)];
    const localFrame = frame - activeIdx * perFeature;
    const enter = spring({frame: localFrame, fps, config: {damping: 14}});
    const exitFrames = 25;
    const exit = interpolate(localFrame, [perFeature - exitFrames, perFeature], [1, 0], {extrapolateLeft: 'clamp'});
    const opacity = Math.min(enter, exit);

    return (
        <AbsoluteFill>
            <BackgroundGrid intensity={0.7} />

            {/* Section label */}
            <div
                style={{
                    position: 'absolute',
                    top: 80,
                    left: 0,
                    right: 0,
                    textAlign: 'center',
                    fontFamily: fonts.display,
                    fontSize: 28,
                    fontWeight: 700,
                    color: colors.accent,
                    letterSpacing: '6px',
                    textTransform: 'uppercase',
                }}
            >
                The Deliverability Edge
            </div>

            {/* Feature icon + title + description, centered */}
            <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center', paddingTop: 40}}>
                <div
                    style={{
                        opacity,
                        transform: `translateY(${interpolate(enter, [0, 1], [40, 0])}px) scale(${interpolate(enter, [0, 1], [0.9, 1])})`,
                        textAlign: 'center',
                        maxWidth: 1400,
                    }}
                >
                    <div
                        style={{
                            fontSize: 320,
                            filter: `drop-shadow(0 0 80px ${f.color}) drop-shadow(0 0 160px ${f.color})`,
                            marginBottom: 30,
                        }}
                    >
                        {f.icon}
                    </div>
                    <div
                        style={{
                            fontFamily: fonts.display,
                            fontSize: 96,
                            fontWeight: 900,
                            color: f.color,
                            marginBottom: 30,
                            letterSpacing: '1px',
                            padding: '0 30px',
                        }}
                    >
                        {f.title}
                    </div>
                    <div
                        style={{
                            fontFamily: fonts.display,
                            fontSize: 42,
                            fontWeight: 500,
                            color: colors.text,
                            lineHeight: 1.4,
                            padding: '0 60px',
                        }}
                    >
                        {f.desc}
                    </div>
                </div>
            </AbsoluteFill>

            {/* Progress dots at bottom */}
            <AbsoluteFill style={{justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 40}}>
                <div style={{display: 'flex', gap: 14}}>
                    {features.map((_, i) => (
                        <div
                            key={i}
                            style={{
                                width: i === activeIdx ? 28 : 10,
                                height: 10,
                                background: i <= activeIdx ? colors.accent : colors.bg4,
                                borderRadius: 10,
                                transition: 'all .3s',
                            }}
                        />
                    ))}
                </div>
            </AbsoluteFill>

        </AbsoluteFill>
    );
};
