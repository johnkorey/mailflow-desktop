import React from 'react';
import {colors, fonts} from './tokens';

/**
 * Minimal re-creation of MailFlow Desktop's titlebar + panel chrome.
 * Scenes can slot custom content inside to show "what the app looks like."
 */
export const AppWindow: React.FC<{
    title?: string;
    children?: React.ReactNode;
    width?: number | string;
    height?: number | string;
    style?: React.CSSProperties;
}> = ({title = 'MAILFLOW 2.0', children, width = 1200, height = 700, style}) => {
    return (
        <div
            style={{
                width,
                height,
                background: colors.bg1,
                border: `1px solid ${colors.border}`,
                borderRadius: 14,
                overflow: 'hidden',
                fontFamily: fonts.display,
                color: colors.text,
                boxShadow: `0 30px 80px rgba(0,0,0,0.6), 0 0 0 1px ${colors.borderHi}`,
                display: 'flex',
                flexDirection: 'column',
                ...style,
            }}
        >
            {/* Titlebar */}
            <div
                style={{
                    height: 36,
                    background: colors.bg3,
                    borderBottom: `1px solid ${colors.border}`,
                    display: 'flex',
                    alignItems: 'center',
                    padding: '0 16px',
                    gap: 12,
                    fontSize: 12,
                    fontWeight: 700,
                    letterSpacing: '.5px',
                }}
            >
                <div style={{display: 'flex', gap: 6}}>
                    <span style={{width: 10, height: 10, borderRadius: '50%', background: '#5a5a7a'}} />
                    <span style={{width: 10, height: 10, borderRadius: '50%', background: '#5a5a7a'}} />
                    <span style={{width: 10, height: 10, borderRadius: '50%', background: '#5a5a7a'}} />
                </div>
                <span style={{color: colors.accent, fontSize: 13, fontWeight: 800, marginLeft: 8}}>{title}</span>
                <span style={{color: colors.text3, fontSize: 11, marginLeft: 'auto'}}>Send emails that truly deliver.</span>
            </div>
            {/* Body */}
            <div style={{flex: 1, position: 'relative', overflow: 'hidden'}}>{children}</div>
        </div>
    );
};

/**
 * Reusable card — rounded purple-bordered box, used inside AppWindow.
 */
export const Card: React.FC<{title?: string; children?: React.ReactNode; style?: React.CSSProperties}> = ({
    title,
    children,
    style,
}) => {
    return (
        <div
            style={{
                background: colors.bg2,
                border: `1px solid ${colors.border}`,
                borderRadius: 12,
                padding: 20,
                ...style,
            }}
        >
            {title && (
                <div
                    style={{
                        fontSize: 14,
                        fontWeight: 700,
                        color: colors.accent,
                        textTransform: 'uppercase',
                        letterSpacing: '.6px',
                        marginBottom: 12,
                    }}
                >
                    {title}
                </div>
            )}
            {children}
        </div>
    );
};
