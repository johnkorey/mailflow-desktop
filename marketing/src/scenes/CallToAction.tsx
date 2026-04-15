import React from 'react';
import {AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {colors, fonts} from '../components/tokens';
import {BackgroundGrid} from '../components/BackgroundGrid';

// SCENE 7 — CALL TO ACTION (180-210s, 900 frames)
// Logo center, tagline, platforms, Telegram CTA.
export const CallToAction: React.FC = () => {
    const frame = useCurrentFrame();
    const {fps} = useVideoConfig();

    const logoIn = spring({frame, fps, config: {damping: 14, stiffness: 100}});
    const logoScale = interpolate(logoIn, [0, 1], [0.5, 1]);
    const taglineOp = interpolate(frame, [60, 110], [0, 1], {extrapolateRight: 'clamp'});
    const platformsOp = interpolate(frame, [180, 240], [0, 1], {extrapolateRight: 'clamp'});
    const ctaOp = interpolate(frame, [320, 400], [0, 1], {extrapolateRight: 'clamp'});

    // Subtle pulse on CTA button
    const pulse = Math.sin(frame / 10) * 0.05 + 1;

    return (
        <AbsoluteFill>
            <BackgroundGrid intensity={1.5} />
            <AbsoluteFill
                style={{
                    background: `radial-gradient(circle at 50% 50%, ${colors.accentGlow} 0%, transparent 55%)`,
                }}
            />

            <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center'}}>
                {/* Logo */}
                <div
                    style={{
                        width: 320,
                        height: 320,
                        transform: `scale(${logoScale})`,
                        opacity: logoIn,
                        filter: `drop-shadow(0 0 80px ${colors.accent}) drop-shadow(0 0 160px ${colors.accentGlow})`,
                        marginBottom: 28,
                    }}
                >
                    <Img src={staticFile('logo.png')} style={{width: '100%', height: '100%', objectFit: 'contain', borderRadius: 32}} />
                </div>

                {/* Brand name */}
                <div
                    style={{
                        fontFamily: fonts.display,
                        fontSize: 110,
                        fontWeight: 900,
                        letterSpacing: '5px',
                        color: colors.text,
                        opacity: interpolate(frame, [20, 60], [0, 1], {extrapolateRight: 'clamp'}),
                    }}
                >
                    MAILFLOW
                </div>

                {/* Tagline */}
                <div
                    style={{
                        fontFamily: fonts.display,
                        fontSize: 40,
                        fontWeight: 400,
                        fontStyle: 'italic',
                        color: colors.accent,
                        opacity: taglineOp,
                        marginTop: 14,
                        textAlign: 'center',
                        padding: '0 40px',
                        textShadow: `0 0 30px ${colors.accentGlow}`,
                    }}
                >
                    Send emails that truly deliver.
                </div>

                {/* Platforms — stacked vertical */}
                <div
                    style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 16,
                        marginTop: 40,
                        opacity: platformsOp,
                        transform: `translateY(${interpolate(platformsOp, [0, 1], [20, 0])}px)`,
                        alignItems: 'center',
                    }}
                >
                    <div style={{display: 'flex', alignItems: 'center', gap: 14, fontSize: 34, color: colors.text, fontWeight: 700}}>
                        <span style={{fontSize: 46}}>🪟</span> Windows — Available Now
                    </div>
                    <div style={{display: 'flex', alignItems: 'center', gap: 14, fontSize: 34, color: colors.text3, fontWeight: 700}}>
                        <span style={{fontSize: 46}}>🍎</span> Mac — Coming Soon
                    </div>
                </div>

                {/* CTA — Telegram */}
                <div
                    style={{
                        marginTop: 60,
                        opacity: ctaOp,
                        transform: `scale(${pulse})`,
                        padding: '30px 40px',
                        background: 'linear-gradient(135deg, #0088cc, #006699)',
                        borderRadius: 24,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 12,
                        fontFamily: fonts.display,
                        fontWeight: 800,
                        color: '#fff',
                        boxShadow: '0 24px 80px rgba(0, 136, 204, 0.55), 0 0 0 3px rgba(255,255,255,0.12)',
                        maxWidth: 900,
                        textAlign: 'center',
                    }}
                >
                    <div style={{display: 'flex', alignItems: 'center', gap: 18, fontSize: 44}}>
                        <span style={{fontSize: 60}}>📱</span>
                        Contact admin on Telegram
                    </div>
                    <div style={{fontSize: 26, fontWeight: 600, opacity: 0.9}}>
                        to get your license
                    </div>
                </div>
            </AbsoluteFill>

        </AbsoluteFill>
    );
};
