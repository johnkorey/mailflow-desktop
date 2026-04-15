import React from 'react';
import {AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {colors, fonts} from './tokens';

type Line = {from: number; to: number; text: string};

/**
 * Lower-thirds style subtitle block. One line at a time, fades in/out.
 * Used for voiceover caption overlays.
 */
export const Captions: React.FC<{lines: Line[]}> = ({lines}) => {
    const frame = useCurrentFrame();
    const {fps} = useVideoConfig();
    const active = lines.find((l) => frame >= l.from && frame <= l.to);
    if (!active) return null;

    const lineFrame = frame - active.from;
    const duration = active.to - active.from;
    const fadeIn = interpolate(lineFrame, [0, 10], [0, 1], {extrapolateRight: 'clamp'});
    const fadeOut = interpolate(lineFrame, [duration - 15, duration], [1, 0], {extrapolateLeft: 'clamp'});
    const opacity = Math.min(fadeIn, fadeOut);
    const slide = spring({frame: lineFrame, fps, config: {damping: 14}});

    return (
        <AbsoluteFill style={{justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 40}}>
            <div
                style={{
                    fontFamily: fonts.display,
                    color: colors.text,
                    fontSize: 44,
                    lineHeight: 1.3,
                    fontWeight: 700,
                    maxWidth: 1000,
                    textAlign: 'center',
                    padding: '22px 36px',
                    background: 'rgba(5, 3, 16, 0.88)',
                    border: `1.5px solid ${colors.borderHi}`,
                    borderRadius: 18,
                    backdropFilter: 'blur(8px)',
                    boxShadow: `0 14px 40px ${colors.accentGlow}`,
                    opacity,
                    transform: `translateY(${interpolate(slide, [0, 1], [30, 0])}px)`,
                }}
            >
                {active.text}
            </div>
        </AbsoluteFill>
    );
};
