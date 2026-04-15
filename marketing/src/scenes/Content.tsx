import React from 'react';
import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {colors, fonts} from '../components/tokens';
import {BackgroundGrid} from '../components/BackgroundGrid';
import {AppWindow, Card} from '../components/UIMockup';

// SCENE 5 — CONTENT (110-150s) — Vertical 1080×1920
export const Content: React.FC = () => {
    const frame = useCurrentFrame();
    const {fps} = useVideoConfig();

    const names = ['Sarah Chen', 'Marcus Rodriguez', 'Priya Kapoor', 'Kaito Tanaka', 'Ana Silva'];
    const activeName = names[Math.floor(frame / 60) % names.length];

    const subjects = [
        'Your Q4 strategy — exclusive preview',
        'Hey Sarah, thought you\'d love this',
        '48-hour offer for {Company}',
        'Can we chat this week?',
    ];
    const activeSubject = subjects[Math.floor(frame / 90) % subjects.length];

    const windowIn = spring({frame, fps, config: {damping: 14}});

    return (
        <AbsoluteFill>
            <BackgroundGrid intensity={0.7} />

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
                    lineHeight: 1.15,
                }}
            >
                Personalize <span style={{color: colors.accent}}>Every Email</span>
            </div>

            <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center', paddingTop: 80, paddingBottom: 220}}>
                <div style={{transform: `scale(${interpolate(windowIn, [0, 1], [0.92, 1])})`, opacity: windowIn}}>
                    <AppWindow width={960} height={1320} title="MAILFLOW 2.0 — CAMPAIGN EDITOR">
                        <div style={{display: 'flex', flexDirection: 'column', gap: 18, padding: 24, height: '100%'}}>
                            {/* Email preview */}
                            <Card title="Email Preview">
                                <div style={{fontSize: 16, color: colors.text2, marginBottom: 8}}>Subject:</div>
                                <div
                                    style={{
                                        fontFamily: fonts.display,
                                        fontSize: 22,
                                        fontWeight: 700,
                                        color: colors.text,
                                        padding: '12px 16px',
                                        background: colors.bg3,
                                        border: `1px solid ${colors.borderHi}`,
                                        borderRadius: 8,
                                        marginBottom: 14,
                                        minHeight: 50,
                                    }}
                                >
                                    {activeSubject}
                                </div>

                                <div
                                    style={{
                                        fontFamily: fonts.display,
                                        fontSize: 20,
                                        lineHeight: 1.6,
                                        padding: 18,
                                        background: '#ffffff',
                                        color: '#1f2937',
                                        borderRadius: 8,
                                    }}
                                >
                                    <div style={{fontSize: 28, fontWeight: 700, marginBottom: 10, color: colors.accent}}>
                                        Hello {activeName},
                                    </div>
                                    <p>Noticed your recent work and wanted to send a proposal tailored to your needs.</p>
                                </div>
                            </Card>

                            {/* Placeholders */}
                            <Card title="Placeholders (50+)">
                                <div style={{display: 'flex', flexWrap: 'wrap', gap: 8}}>
                                    {['{RECIPIENT_FIRST_NAME}', '{DATE}', '{RANDOM_UUID}', '{FAKE_COMPANY}', '{LINK}', '{QR_CODE}'].map((p, i) => {
                                        const showAt = 10 + i * 14;
                                        const op = interpolate(frame, [showAt, showAt + 12], [0, 1], {
                                            extrapolateRight: 'clamp',
                                        });
                                        return (
                                            <span
                                                key={i}
                                                style={{
                                                    fontFamily: fonts.mono,
                                                    fontSize: 16,
                                                    padding: '8px 14px',
                                                    background: colors.accentGlow,
                                                    color: colors.accent,
                                                    border: `1px solid ${colors.accent}`,
                                                    borderRadius: 100,
                                                    opacity: op,
                                                }}
                                            >
                                                {p}
                                            </span>
                                        );
                                    })}
                                </div>
                            </Card>

                            {/* Rotation */}
                            <Card title="Rotation Lists — Subject Cycling">
                                {subjects.slice(0, 3).map((s, i) => {
                                    const cycle = Math.floor(frame / 90) % subjects.length;
                                    const active = i === cycle % 3;
                                    return (
                                        <div
                                            key={i}
                                            style={{
                                                padding: '10px 16px',
                                                fontSize: 18,
                                                color: active ? colors.text : colors.text3,
                                                borderLeft: `4px solid ${active ? colors.accent : 'transparent'}`,
                                                marginBottom: 4,
                                            }}
                                        >
                                            {s}
                                        </div>
                                    );
                                })}
                            </Card>

                            {/* Attachment formats */}
                            <Card title="Attachment Library — Auto-Convert">
                                <div style={{display: 'flex', gap: 8, flexWrap: 'wrap'}}>
                                    {['HTML', 'PDF', 'DOCX', 'XLSX', 'JPG', 'PNG', 'SVG'].map((fmt, i) => {
                                        const active = Math.floor(frame / 40) % 7 === i;
                                        return (
                                            <span
                                                key={i}
                                                style={{
                                                    fontFamily: fonts.mono,
                                                    fontSize: 16,
                                                    padding: '8px 18px',
                                                    background: active ? colors.accent : colors.bg3,
                                                    color: active ? '#fff' : colors.text2,
                                                    border: `1.5px solid ${active ? colors.accent : colors.border}`,
                                                    borderRadius: 100,
                                                    fontWeight: 700,
                                                }}
                                            >
                                                {fmt}
                                            </span>
                                        );
                                    })}
                                </div>
                            </Card>
                        </div>
                    </AppWindow>
                </div>
            </AbsoluteFill>

        </AbsoluteFill>
    );
};
