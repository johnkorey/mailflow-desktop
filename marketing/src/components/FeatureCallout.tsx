import React from 'react';
import {interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {colors, fonts} from './tokens';

/**
 * Pill-style feature badge with icon + label. Springs in from bottom,
 * holds, then fades out. Used across feature-list scenes.
 */
export const FeatureCallout: React.FC<{
    icon: string;
    label: string;
    startFrame: number;
    durationFrames: number;
    x?: number | string;
    y?: number | string;
    accent?: string;
}> = ({icon, label, startFrame, durationFrames, x = '50%', y = '50%', accent = colors.accent}) => {
    const frame = useCurrentFrame();
    const {fps} = useVideoConfig();
    const local = frame - startFrame;
    if (local < 0 || local > durationFrames) return null;

    const enter = spring({frame: local, fps, config: {damping: 12, stiffness: 110}});
    const exit = interpolate(local, [durationFrames - 15, durationFrames], [1, 0], {extrapolateLeft: 'clamp'});
    const opacity = Math.min(enter, exit);
    const scale = interpolate(enter, [0, 1], [0.7, 1]);

    return (
        <div
            style={{
                position: 'absolute',
                left: x,
                top: y,
                transform: `translate(-50%, -50%) scale(${scale})`,
                opacity,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 14,
                padding: '16px 28px',
                fontFamily: fonts.display,
                fontSize: 30,
                fontWeight: 600,
                color: colors.text,
                background: 'linear-gradient(135deg, rgba(139,92,246,0.18), rgba(139,92,246,0.06))',
                border: `1.5px solid ${accent}`,
                borderRadius: 100,
                boxShadow: `0 10px 40px ${colors.accentGlow}`,
                backdropFilter: 'blur(8px)',
                whiteSpace: 'nowrap',
            }}
        >
            <span style={{fontSize: 34}}>{icon}</span>
            <span>{label}</span>
        </div>
    );
};
