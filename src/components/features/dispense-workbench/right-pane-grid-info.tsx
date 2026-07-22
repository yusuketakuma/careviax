import styles from './dispensing-workbench.module.css';
import type { WorkbenchView } from './dispensing-workbench.types';
import { RightPaneSectionHeading } from './right-pane-primitives';

export function RightPaneGridInfo({ view }: { view: WorkbenchView }) {
  const { cur, infoItems } = view;
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {/* アバター + 氏名 + フリガナ */}
      <div
        style={{
          flex: 'none',
          padding: '9px 11px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          borderBottom: '1px solid var(--wb-line)',
          background: 'var(--wb-surface)',
        }}
      >
        <div
          aria-hidden
          style={{
            width: '42px',
            height: '42px',
            borderRadius: '7px',
            background: cur.avatarBg,
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '18px',
            fontWeight: 700,
          }}
        >
          {cur.initial}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: '15px',
              fontWeight: 700,
              color: 'var(--wb-ink)',
              overflowWrap: 'anywhere',
            }}
          >
            {cur.name}
          </div>
          <div
            style={{
              fontSize: '12px',
              color: 'var(--wb-ink-muted)',
              overflowWrap: 'anywhere',
            }}
          >
            {cur.kana}
          </div>
        </div>
      </div>

      {/* 患者情報行 */}
      <div style={{ flex: 'none', padding: '6px 11px', borderBottom: '1px solid var(--wb-line)' }}>
        {infoItems.map((it) => (
          <div
            key={it.label}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              padding: '3px 0',
              borderBottom: '1px dotted var(--wb-line)',
            }}
          >
            <span
              style={{
                width: '96px',
                flex: 'none',
                fontSize: '12px',
                color: 'var(--wb-ink-muted)',
              }}
            >
              {it.label}
            </span>
            <span
              style={{
                flex: 1,
                fontSize: '14px',
                fontWeight: 700,
                color: 'var(--wb-ink)',
                lineHeight: 1.6,
              }}
            >
              {it.value}
            </span>
          </div>
        ))}
      </div>

      {/* 属性チップ */}
      <div
        style={{
          flex: 'none',
          padding: '8px 11px',
          borderBottom: '1px solid var(--wb-line)',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '5px',
        }}
      >
        {cur.chips.map((chip, index) => (
          <span
            key={`${chip.label}-${index}`}
            style={{
              fontSize: '12px',
              fontWeight: 700,
              color: chip.color,
              background: chip.bg,
              border: `1px solid ${chip.border}`,
              borderRadius: '11px',
              padding: '2px 9px',
            }}
          >
            {chip.label}
          </span>
        ))}
      </div>

      {/* 備考・申し送り */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          padding: '8px 11px',
        }}
      >
        <RightPaneSectionHeading color="var(--wb-state-confirm)" label="備考・申し送り" />
        <div
          data-testid="calendar-outside-meds-confirmation"
          className={styles.scrollRegion}
          role="region"
          aria-label="患者の備考・申し送り"
          tabIndex={0}
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            background: 'var(--wb-confirm-bg-pale)',
            border: '1px solid var(--wb-confirm-border)',
            borderRadius: '5px',
            padding: '9px 11px',
          }}
        >
          {cur.biko.map((note, index) => (
            <div
              key={`${note}-${index}`}
              style={{
                display: 'flex',
                gap: '6px',
                marginBottom: '5px',
                fontSize: '14px',
                lineHeight: 1.6,
                color: 'var(--wb-state-confirm)',
              }}
            >
              <span aria-hidden style={{ color: 'var(--wb-state-confirm)', fontWeight: 700 }}>
                ●
              </span>
              <span style={{ flex: 1 }}>{note}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
