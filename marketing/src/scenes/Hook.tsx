import React from 'react';
import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {colors, fonts} from '../components/tokens';
import {BackgroundGrid} from '../components/BackgroundGrid';

// SCENE 1 — HOOK (0-15s) — Vertical 1080×1920
export const Hook: React.FC = () => {
    const frame = useCurrentFrame();
    const {fps} = useVideoConfig();

    const stat = Math.round(
        interpolate(frame, [60, 180], [0, 90], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})
    );

    const envelopeCount = 6;
    const envelopes = Array.from({length: envelopeCount}).map((_, i) => {
        const startAt = 90 + i * 18;
        const local = frame - startAt;
        if (local < 0) return null;
        const fall = spring({frame: local, fps, config: {damping: 8, stiffness: 80}});
        const x = (i - envelopeCount / 2) * 110;
        return (
            <div
                key={i}
                style={{
                    position: 'absolute',
                    left: `calc(50% + ${x}px)`,
                    top: interpolate(fall, [0, 1], [-200, 1000]),
                    transform: `translate(-50%, 0) rotate(${Math.sin(i) * 15}deg)`,
                    opacity: interpolate(fall, [0, 0.3, 0.9, 1], [0, 1, 1, 0.4]),
                    fontSize: 90,
                }}
            >
                ✉️
            </div>
        );
    });

    const pulse = Math.sin(frame / 8) * 0.15 + 0.85;

    return (
        <AbsoluteFill>
            <BackgroundGrid intensity={0.5} />
            <AbsoluteFill
                style={{
                    background: 'radial-gradient(circle at 50% 60%, rgba(239, 68, 68, 0.22) 0%, transparent 55%)',
                }}
            />

            {/* Big stat at top */}
            <AbsoluteFill
                style={{
                    justifyContent: 'flex-start',
                    alignItems: 'center',
                    paddingTop: 140,
                }}
            >
                <div
                    style={{
                        fontFamily: fonts.display,
                        fontSize: 220,
                        fontWeight: 900,
                        background: 'linear-gradient(135deg, #ef4444, #f59e0b)',
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                        opacity: interpolate(frame, [45, 90], [0, 1], {extrapolateRight: 'clamp'}),
                        lineHeight: 1,
                    }}
                >
                    {stat}%
                </div>
                <div
                    style={{
                        fontFamily: fonts.display,
                        fontSize: 38,
                        fontWeight: 600,
                        color: colors.text2,
                        marginTop: 12,
                        opacity: interpolate(frame, [90, 140], [0, 1], {extrapolateRight: 'clamp'}),
                        padding: '0 60px',
                        textAlign: 'center',
                        lineHeight: 1.3,
                    }}
                >
                    of cold emails never reach the inbox
                </div>
            </AbsoluteFill>

            {/* Falling envelopes in middle */}
            <AbsoluteFill>{envelopes}</AbsoluteFill>

            {/* Spam folder near bottom */}
            <AbsoluteFill style={{justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 240}}>
                <div
                    style={{
                        fontSize: 260,
                        transform: `scale(${pulse})`,
                        filter: 'drop-shadow(0 10px 50px rgba(239, 68, 68, 0.8))',
                    }}
                >
                    🗑️
                </div>
                <div
                    style={{
                        fontFamily: fonts.display,
                        fontSize: 54,
                        fontWeight: 800,
                        color: colors.red,
                        marginTop: 16,
                        textTransform: 'uppercase',
                        letterSpacing: '6px',
                        opacity: interpolate(frame, [30, 60], [0, 1], {extrapolateRight: 'clamp'}),
                    }}
                >
                    SPAM
                </div>
            </AbsoluteFill>

        </AbsoluteFill>
    );
};
