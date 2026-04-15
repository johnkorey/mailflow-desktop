import React from 'react';
import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {colors, fonts} from '../components/tokens';
import {BackgroundGrid} from '../components/BackgroundGrid';
import {AppWindow, Card} from '../components/UIMockup';

// SCENE 3 — CORE SENDING (30-60s) — Vertical 1080×1920
// Single stacked column: title, recipients card, SMTP card, progress card.
// Feature pills float in at bottom.
export const CoreSending: React.FC = () => {
    const frame = useCurrentFrame();
    const {fps} = useVideoConfig();

    // Scene duration = 750 frames. Internal clock rescaled from original
    // 900-frame design so pill callouts align with the 23-second VO.
    const sentCount = Math.round(
        interpolate(frame, [0, 750], [142, 4832], {extrapolateRight: 'clamp'})
    );
    const smtpActive = Math.floor(frame / 40) % 3;
    const windowIn = spring({frame, fps, config: {damping: 14}});

    const pills = [
        {icon: '📂', label: 'CSV + drag-drop', at: 100},
        {icon: '🔄', label: 'Multi-SMTP rotation', at: 230},
        {icon: '⏰', label: 'Campaign scheduler', at: 370},
        {icon: '📊', label: 'Real-time monitor', at: 500},
        {icon: '🛡️', label: 'Proxy support', at: 620},
    ];

    return (
        <AbsoluteFill>
            <BackgroundGrid intensity={0.6} />

            <div
                style={{
                    position: 'absolute',
                    top: 80,
                    left: 0,
                    right: 0,
                    textAlign: 'center',
                    fontFamily: fonts.display,
                    fontSize: 58,
                    fontWeight: 800,
                    color: colors.text,
                    letterSpacing: '1px',
                    opacity: interpolate(frame, [0, 30], [0, 1], {extrapolateRight: 'clamp'}),
                    padding: '0 40px',
                    lineHeight: 1.1,
                }}
            >
                Bulk Sending,<br />
                <span style={{color: colors.accent}}>Professionally Engineered</span>
            </div>

            <AbsoluteFill
                style={{
                    justifyContent: 'center',
                    alignItems: 'center',
                    paddingTop: 100,
                    paddingBottom: 250,
                }}
            >
                <div
                    style={{
                        transform: `scale(${interpolate(windowIn, [0, 1], [0.92, 1])})`,
                        opacity: windowIn,
                    }}
                >
                    <AppWindow width={960} height={1280} title="MAILFLOW 2.0 — CAMPAIGNS">
                        <div
                            style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 20,
                                padding: 28,
                                height: '100%',
                            }}
                        >
                            {/* RECIPIENTS */}
                            <Card title="Recipients">
                                <div style={{fontSize: 18, color: colors.text2, marginBottom: 14}}>
                                    Import via CSV, TXT, or drag-drop
                                </div>
                                {Array.from({length: 5}).map((_, i) => {
                                    const showAt = 20 + i * 25;
                                    const lOp = interpolate(frame, [showAt, showAt + 15], [0, 1], {
                                        extrapolateRight: 'clamp',
                                    });
                                    return (
                                        <div
                                            key={i}
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 12,
                                                padding: '12px 16px',
                                                background: colors.bg3,
                                                borderRadius: 10,
                                                marginBottom: 8,
                                                fontSize: 18,
                                                color: colors.text,
                                                opacity: lOp,
                                            }}
                                        >
                                            <span style={{color: colors.accent, fontSize: 20}}>●</span>
                                            <span>
                                                {[
                                                    'sarah.chen@acme.co',
                                                    'marcus@startup.io',
                                                    'priya.k@techcorp.com',
                                                    'j.rodriguez@mail.de',
                                                    'kaito@example.jp',
                                                ][i]}
                                            </span>
                                        </div>
                                    );
                                })}
                                <div style={{color: colors.text3, fontSize: 16, marginTop: 12}}>+ 4,827 more…</div>
                            </Card>

                            {/* SMTP ROTATION */}
                            <Card title="Multi-SMTP Rotation">
                                <div style={{fontSize: 18, color: colors.text2, marginBottom: 16}}>
                                    Round-robin across servers
                                </div>
                                {['smtp.gsuite.com', 'mailgun.yourbiz.com', 'email-smtp.us-east-1.ses'].map((srv, i) => {
                                    const active = i === smtpActive;
                                    return (
                                        <div
                                            key={i}
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 14,
                                                padding: '16px 18px',
                                                background: active ? colors.accentGlow : colors.bg3,
                                                border: `1.5px solid ${active ? colors.accent : colors.border}`,
                                                borderRadius: 12,
                                                marginBottom: 12,
                                            }}
                                        >
                                            <span
                                                style={{
                                                    width: 12,
                                                    height: 12,
                                                    borderRadius: '50%',
                                                    background: active ? colors.green : colors.text3,
                                                    boxShadow: active ? `0 0 14px ${colors.green}` : 'none',
                                                }}
                                            />
                                            <span style={{fontFamily: fonts.mono, fontSize: 17, color: colors.text}}>{srv}</span>
                                            {active && (
                                                <span
                                                    style={{
                                                        marginLeft: 'auto',
                                                        fontSize: 14,
                                                        color: colors.green,
                                                        fontWeight: 700,
                                                    }}
                                                >
                                                    SENDING
                                                </span>
                                            )}
                                        </div>
                                    );
                                })}
                            </Card>

                            {/* PROGRESS */}
                            <Card title="Live Progress">
                                <div
                                    style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        marginBottom: 10,
                                        fontSize: 18,
                                        color: colors.text2,
                                    }}
                                >
                                    <span>Campaign</span>
                                    <span style={{color: colors.accent, fontWeight: 700}}>
                                        {sentCount.toLocaleString()} / 5,000
                                    </span>
                                </div>
                                <div style={{height: 16, background: colors.bg3, borderRadius: 16, overflow: 'hidden'}}>
                                    <div
                                        style={{
                                            width: `${(sentCount / 5000) * 100}%`,
                                            height: '100%',
                                            background: `linear-gradient(90deg, ${colors.accent}, ${colors.accentHover})`,
                                        }}
                                    />
                                </div>
                            </Card>
                        </div>
                    </AppWindow>
                </div>
            </AbsoluteFill>

            {/* Feature pills floating at bottom */}
            {pills.map((p, i) => {
                const local = frame - p.at;
                if (local < 0 || local > 120) return null;
                const pIn = spring({frame: local, fps, config: {damping: 14}});
                const pOut = interpolate(local, [100, 120], [1, 0], {extrapolateLeft: 'clamp'});
                const opacity = Math.min(pIn, pOut);
                return (
                    <div
                        key={i}
                        style={{
                            position: 'absolute',
                            left: '50%',
                            bottom: 140,
                            transform: `translateX(-50%) translateY(${interpolate(pIn, [0, 1], [30, 0])}px)`,
                            opacity,
                            padding: '18px 36px',
                            background: 'linear-gradient(135deg, rgba(139,92,246,0.28), rgba(139,92,246,0.10))',
                            border: `1.5px solid ${colors.accent}`,
                            borderRadius: 100,
                            fontFamily: fonts.display,
                            fontSize: 32,
                            fontWeight: 700,
                            color: colors.text,
                            backdropFilter: 'blur(8px)',
                            boxShadow: `0 12px 40px ${colors.accentGlow}`,
                            whiteSpace: 'nowrap',
                        }}
                    >
                        <span style={{fontSize: 36, marginRight: 12}}>{p.icon}</span>
                        {p.label}
                    </div>
                );
            })}

        </AbsoluteFill>
    );
};
