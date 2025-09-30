import * as React from 'react';
import type { LogViewMode } from './utils';

type LogViewToggleProps = {
  mode: LogViewMode;
  onChange: (mode: LogViewMode) => void;
  disabled?: boolean;
};

function ListIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

function GroupIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />
    </svg>
  );
}

export function LogViewToggle({ mode, onChange, disabled }: LogViewToggleProps) {
  const baseStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 10px',
    borderRadius: 8,
    border: '1px solid rgba(148,163,184,0.4)',
    background: 'rgba(15,23,42,0.45)',
    color: '#e2e8f0',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: 13,
    lineHeight: 1.2
  };

  const activeStyle: React.CSSProperties = {
    background: 'rgba(59,130,246,0.18)',
    borderColor: 'rgba(59,130,246,0.45)',
    color: '#e0f2fe'
  };

  const buttonProps = (targetMode: LogViewMode) => ({
    type: 'button' as const,
    onClick: () => !disabled && onChange(targetMode),
    'aria-pressed': mode === targetMode,
    style: mode === targetMode ? { ...baseStyle, ...activeStyle } : baseStyle,
    disabled
  });

  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <button {...buttonProps('list')}>
        <ListIcon style={{ width: 16, height: 16 }} />
        <span>List</span>
      </button>
      <button {...buttonProps('grouped')}>
        <GroupIcon style={{ width: 16, height: 16 }} />
        <span>Grouped</span>
      </button>
    </div>
  );
}

export default LogViewToggle;
