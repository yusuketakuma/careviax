interface CheckboxLook {
  bg: string;
  border: string;
  mark: string;
}

/** セクション見出し（左に色付き縦バー）*/
export function RightPaneSectionHeading({ color, label }: { color: string; label: string }) {
  return (
    <div
      style={{
        fontSize: '12px',
        fontWeight: 700,
        color: 'var(--wb-ink-muted)',
        marginBottom: '5px',
        display: 'flex',
        alignItems: 'center',
        gap: '5px',
      }}
    >
      <span
        aria-hidden
        style={{
          width: '4px',
          height: '12px',
          background: color,
          display: 'inline-block',
          borderRadius: '1px',
        }}
      />
      {label}
    </div>
  );
}

/** 角丸チェックボックスの見た目（a11y のためアイコン＋aria で状態を表す）*/
export function RightPaneCheckBox({ look, size = 17 }: { look: CheckboxLook; size?: number }) {
  return (
    <div
      aria-hidden
      style={{
        width: `${size}px`,
        height: `${size}px`,
        flex: 'none',
        borderRadius: '4px',
        border: `1.5px solid ${look.border}`,
        background: look.bg,
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '12px',
        fontWeight: 800,
      }}
    >
      {look.mark}
    </div>
  );
}

export function rightPaneCheckboxLook(checked: boolean, onColor: string): CheckboxLook {
  return checked
    ? { bg: onColor, border: onColor, mark: '✓' }
    : { bg: 'var(--wb-surface)', border: 'var(--wb-line)', mark: '' };
}
