'use client';

/**
 * 調剤ワークベンチ 左ペイン（患者リスト）— 設計プロト L74-102 の忠実移植。
 *
 * 役割: ヘッダ（処方登録患者 N名）／並び替え（服用開始・登録日）／患者行（アバター・氏名・
 * 開始/登録ラベル・年齢・状態バッジ）／フッタ凡例。表示は view（{@link WorkbenchView}）から、
 * 状態更新は store の setPatient/setSort を直接呼ぶ（コンポーネント間連携規約）。
 *
 * phase は連携規約に従い props で受けるが、本パネルの表示には影響しない（patients/sortButtons は
 * use-workbench-view 側で phase 非依存に算出される）。
 */

import { useWorkbenchStore } from './dispensing-workbench.store';
import styles from './dispensing-workbench.module.css';
import type { Phase, WorkbenchView } from './dispensing-workbench.types';

interface PatientListPanelProps {
  view: WorkbenchView;
  /** ルートから注入される工程。連携規約に従い受け取る（本パネルの表示には不使用）。 */
  phase: Phase;
}

/**
 * フッタ凡例（設計プロト L100 の静的スウォッチ色を厳守）。
 * 注: 患者行の view.statusColor とは独立した静的値（設計プロトでも静的）。
 * view 側の状態色を変更する場合はここも併せて見直すこと。
 */
const LEGEND: { label: string; color: string }[] = [
  { label: '監査済', color: 'var(--wb-state-done)' },
  { label: '作業中', color: 'var(--wb-state-confirm)' },
  { label: '未着手', color: 'var(--wb-state-readonly)' },
];

export function PatientListPanel({ view }: PatientListPanelProps) {
  const setPatient = useWorkbenchStore((s) => s.setPatient);
  const setSort = useWorkbenchStore((s) => s.setSort);

  return (
    <div className={styles.leftPane}>
      {/* ヘッダ（24px・青グラデ）*/}
      <div className={styles.paneHeader}>
        <span>処方登録患者</span>
        <span style={{ fontSize: '10.5px', opacity: 0.85, fontWeight: 400 }}>
          {view.patientCount}名
        </span>
      </div>

      {/* 並び替え */}
      <div
        style={{
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          padding: '5px 8px',
          borderBottom: '1px solid var(--wb-line)',
          background: 'var(--wb-surface-muted)',
        }}
      >
        <span style={{ fontSize: '10.5px', color: 'var(--wb-ink-muted)', fontWeight: 700 }}>
          並び替え
        </span>
        {view.sortButtons.map((sb) => (
          <button
            key={sb.key}
            type="button"
            onClick={() => setSort(sb.key)}
            aria-pressed={sb.active}
            style={{
              cursor: 'pointer',
              fontSize: '10.5px',
              fontWeight: 700,
              color: sb.color,
              background: sb.bg,
              border: `1px solid ${sb.border}`,
              borderRadius: '4px',
              padding: '2px 8px',
            }}
          >
            {sb.label}
          </button>
        ))}
      </div>

      {/* 患者行リスト */}
      <div className={styles.patientList}>
        {view.patients.map((p) => (
          <button
            key={p.id}
            type="button"
            data-testid="dispense-queue-row"
            onClick={() => setPatient(p.id)}
            aria-current={p.selected ? 'true' : undefined}
            className={styles.patientRow}
            style={{
              width: '100%',
              textAlign: 'left',
              font: 'inherit',
              borderLeft: `3px solid ${p.barColor}`,
              background: p.bg,
            }}
          >
            <div className={styles.patientAvatar} style={{ background: p.avatarBg }}>
              {p.initial}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: '13px',
                  fontWeight: 700,
                  color: 'var(--wb-ink)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {p.name}
              </div>
              <div
                style={{
                  fontSize: '10px',
                  color: 'var(--wb-ink-muted)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                開始 {p.startLabel} ・ 登録 {p.registLabel}
              </div>
            </div>
            <div style={{ flex: 'none', textAlign: 'right' }}>
              <div style={{ fontSize: '11px', color: 'var(--wb-ink-muted)', fontWeight: 700 }}>
                {p.age}
              </div>
              <div
                style={{
                  display: 'inline-block',
                  fontSize: '9px',
                  fontWeight: 700,
                  color: '#fff',
                  background: p.statusColor,
                  borderRadius: '3px',
                  padding: '1px 4px',
                  marginTop: '1px',
                }}
              >
                {p.statusLabel}
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* フッタ凡例 */}
      <div
        style={{
          flex: 'none',
          padding: '6px 8px',
          borderTop: '1px solid var(--wb-line)',
          background: 'var(--wb-surface-alt)',
          fontSize: '10px',
          color: 'var(--wb-ink-muted)',
          lineHeight: 1.5,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
          {LEGEND.map((l) => (
            <span
              key={l.label}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: '9px',
                  height: '9px',
                  borderRadius: '2px',
                  background: l.color,
                  display: 'inline-block',
                }}
              />
              {l.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
