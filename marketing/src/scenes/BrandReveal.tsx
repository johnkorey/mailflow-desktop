import React from 'react';
import {AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {colors, fonts} from '../components/tokens';
import {BackgroundGrid} from '../components/BackgroundGrid';

// SCENE 2 — BRAND REVEAL (15-30s) — Vertical 1080×1920
export const BrandReveal: React.FC = () => {
    const frame = useCurrentFrame();
    const {fps} = useVideoConfig();

    const logoIn = spring({frame, fps, config: {damping: 12, stiffness: 100}});
    const logoScale = interpolate(logoIn, [0, 1], [0.3, 1]);
    const logoOpacity = interpolate(frame, [0, 25], [0, 1], {extrapolateRight: 'clamp'});

    const brandName = 'MAILFLOW';
    const brandShown = Math.min(brandName.length, Math.floor((frame - 60) / 3));

    const tagline = 'Send emails that truly deliver.';
    const taglineShown = Math.min(tagline.length, Math.floor((frame - 150) / 1.8));

    const glowPulse = Math.sin(frame / 12) * 0.2 + 0.8;

    return (
        <AbsoluteFill>
            <BackgroundGrid intensity={1.2} />
            <AbsoluteFill
                style={{
                    background: `radial-gradient(circle at 50% 45%, ${colors.accentGlow} 0%, transparent 45%)`,
                    opacity: glowPulse,
                }}
            />

            <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center', padding: 60}}>
                <div
                    style={{
                        width: 420,
                        height: 420,
                        transform: `scale(${logoScale})`,
                        opacity: logoOpacity,
                        filter: `drop-shadow(0 0 80px ${colors.accent}) drop-shadow(0 0 160px ${colors.accentGlow})`,
                        marginBottom: 48,
                    }}
                >
                    <Img
                        src={staticFile('logo.png')}
                        style={{width: '100%', height: '100%', objectFit: 'contain', borderRadius: 60}}
                    />
                </div>

                <div
                    style={{
                        fontFamily: fonts.display,
                        fontSize: 120,
                        fontWeight: 900,
                        letterSpacing: '6px',
                        color: colors.text,
                        minHeight: 130,
                        textAlign: 'center',
                    }}
                >
                    {brandName.substring(0, brandShown).split('').map((c, i) => (
                        <span key={i} style={{display: 'inline-block'}}>
                            {c === ' ' ? '\u00A0' : c}
                        </span>
                    ))}
                    {brandShown < brandName.length && brandShown > 0 && (
                        <span
                            style={{
                                display: 'inline-block',
                                width: 6,
                                height: 100,
                                background: colors.accent,
                                verticalAlign: 'middle',
                                marginLeft: 8,
                                opacity: Math.floor(frame / 8) % 2,
                            }}
                        />
                    )}
                </div>

                <div
                    style={{
                        fontFamily: fonts.display,
                        fontSize: 46,
                        fontWeight: 400,
                        fontStyle: 'italic',
                        color: colors.accent,
                        marginTop: 32,
                        minHeight: 70,
                        textAlign: 'center',
                        padding: '0 40px',
                        textShadow: `0 0 30px ${colors.accentGlow}`,
                    }}
                >
                    {tagline.substring(0, taglineShown)}
                </div>
            </AbsoluteFill>
        </AbsoluteFill>
    );
};
