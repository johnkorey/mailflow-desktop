import React from 'react';
import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {colors, fonts} from '../components/tokens';
import {BackgroundGrid} from '../components/BackgroundGrid';

// SCENE 6 — TRUST & COMPLIANCE (150-180s, 900 frames)
// Big shield/lock centerpiece. Compliance badges appear in a row.
export const Trust: React.FC = () => {
    const frame = useCurrentFrame();
    const {fps} = useVideoConfig();

    const lockIn = spring({frame, fps, config: {damping: 14}});

    // Scene duration = 690 frames. Badges appear paced to match the VO
    // (narrator names encryption, unsubscribe, compliance, signed licenses,
    // auto-updates, local-data in sequence over ~21s).
    const badges = [
        {icon: '🔒', label: 'AES-256-GCM', sub: 'Military-grade encryption', at: 70},
        {icon: '✉️', label: 'RFC 8058', sub: 'One-click unsubscribe', at: 155},
        {icon: '⚖️', label: 'CAN-SPAM + GDPR', sub: 'Fully compliant', at: 240},
        {icon: '🔑', label: 'RSA-Signed', sub: 'Tamper-proof licenses', at: 325},
        {icon: '🔄', label: 'Auto-Updates', sub: 'Always current', at: 410},
        {icon: '🏠', label: '100% Local', sub: 'Your data never leaves your PC', at: 490},
    ];

    return (
        <AbsoluteFill>
            <BackgroundGrid intensity={0.8} />
            {/* Green-tinted ambient glow — safety/trust color */}
            <AbsoluteFill
                style={{
                    background: 'radial-gradient(circle at 50% 40%, rgba(16, 185, 129, 0.12) 0%, transparent 50%)',
                }}
            />

            <div
                style={{
                    position: 'absolute',
                    top: 60,
                    left: 0,
                    right: 0,
                    textAlign: 'center',
                    fontFamily: fonts.display,
                    fontSize: 64,
                    fontWeight: 800,
                    color: colors.text,
                    letterSpacing: '1px',
                    opacity: interpolate(frame, [0, 25], [0, 1], {extrapolateRight: 'clamp'}),
                    padding: '0 40px',
                    lineHeight: 1.15,
                }}
            >
                Built for <span style={{color: colors.accent}}>Trust</span><br />and <span style={{color: colors.green}}>Compliance</span>
            </div>

            {/* Central lock near top */}
            <AbsoluteFill style={{justifyContent: 'flex-start', alignItems: 'center', paddingTop: 180}}>
                <div
                    style={{
                        fontSize: 320,
                        transform: `scale(${interpolate(lockIn, [0, 1], [0.6, 1])})`,
                        opacity: interpolate(frame, [0, 30], [0, 1], {extrapolateRight: 'clamp'}),
                        filter: `drop-shadow(0 0 80px ${colors.green}) drop-shadow(0 0 160px rgba(16,185,129,0.4))`,
                    }}
                >
                    🛡️
                </div>
            </AbsoluteFill>

            {/* Badge column in lower half */}
            <AbsoluteFill style={{justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 120}}>
                <div style={{display: 'flex', flexDirection: 'column', gap: 14, width: 920}}>
                    {badges.map((b, i) => {
                        const local = frame - b.at;
                        if (local < 0) return <div key={i} style={{opacity: 0, height: 96}} />;
                        const bIn = spring({frame: local, fps, config: {damping: 14}});
                        return (
                            <div
                                key={i}
                                style={{
                                    opacity: bIn,
                                    transform: `translateY(${interpolate(bIn, [0, 1], [30, 0])}px)`,
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 20,
                                    padding: '22px 28px',
                                    background: 'linear-gradient(135deg, rgba(139,92,246,0.20), rgba(16,185,129,0.12))',
                                    border: `1.5px solid ${colors.borderHi}`,
                                    borderRadius: 18,
                                    backdropFilter: 'blur(10px)',
                                }}
                            >
                                <span style={{fontSize: 56}}>{b.icon}</span>
                                <div>
                                    <div style={{fontFamily: fonts.display, fontSize: 30, fontWeight: 800, color: colors.text}}>
                                        {b.label}
                                    </div>
                                    <div style={{fontFamily: fonts.display, fontSize: 20, color: colors.text2, marginTop: 3}}>
                                        {b.sub}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </AbsoluteFill>

        </AbsoluteFill>
    );
};
