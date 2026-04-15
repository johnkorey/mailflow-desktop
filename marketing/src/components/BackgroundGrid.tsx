import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {colors} from './tokens';

/**
 * Subtle animated grid + purple glow — the default MailFlow brand backdrop.
 * Scenes can layer content on top of this.
 */
export const BackgroundGrid: React.FC<{intensity?: number}> = ({intensity = 1}) => {
    const frame = useCurrentFrame();
    const drift = (frame * 0.2) % 60;
    return (
        <AbsoluteFill>
            <AbsoluteFill
                style={{
                    background: `radial-gradient(circle at 30% 20%, ${colors.accentGlow} 0%, transparent 50%), radial-gradient(circle at 70% 80%, rgba(59, 130, 246, 0.08) 0%, transparent 50%), #050508`,
                }}
            />
            <AbsoluteFill
                style={{
                    opacity: 0.22 * intensity,
                    backgroundImage: `linear-gradient(${colors.accent}22 1px, transparent 1px), linear-gradient(90deg, ${colors.accent}22 1px, transparent 1px)`,
                    backgroundSize: '60px 60px',
                    backgroundPosition: `${drift}px ${drift}px`,
                }}
            />
        </AbsoluteFill>
    );
};
