'use client';

/**
 * 工程ヘッダ（静的・現工程のみ）
 *
 * 作業部上部に現在の工程（調剤 / 調剤監査 / セット / セット監査）のみを表示する静的ヘッダ。
 * 4 工程は分離された独立画面（/dispense /audit /set /set-audit）であり、工程切替は
 * アプリ標準の左メニュー（navigation-config.ts）で行う。そのため本ヘッダは
 * 他工程への遷移リンク（クリック可能なタブ）を一切持たない。
 *
 * 旧 PhaseTabs（clickable Link バー）を置換。`.phaseTabBar` の枠・高さは据え置き、
 * 内部レイアウト（左一覧 / グリッド / 右ペイン）の縦位置を不変に保つ。
 * 現工程ラベルは view.phaseLabel、右端の工程フローは view.flowHint を参照する。
 */

import styles from './dispensing-workbench.module.css';
import type { Phase, WorkbenchView } from './dispensing-workbench.types';

/** phase → 現工程ドット色（use-workbench-view.ts の pdDefs と同一トークン）。 */
const PHASE_DOT: Record<Phase, string> = {
  dispense: 'var(--wb-phase-disp)',
  audit: 'var(--wb-phase-audit)',
  setp: 'var(--wb-phase-setp)',
  seta: 'var(--wb-phase-seta)',
};

interface PhaseHeaderProps {
  view: WorkbenchView;
  /** 現 phase（ルート props）。現工程ドット色の決定に用いる。 */
  phase: Phase;
}

export function PhaseHeader({ view, phase }: PhaseHeaderProps) {
  return (
    <nav className={styles.phaseTabBar} aria-label="現在の工程">
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, padding: '6px 8px 0 8px' }}>
        <span
          className={styles.phaseTab}
          aria-current="page"
          style={{
            background: 'var(--wb-surface)',
            color: 'var(--wb-ink)',
            // 現工程ヘッダは bar 下端の境界線(1px)に重ねて本文白背景と地続きに見せる（設計プロト L110）。
            marginBottom: -1,
          }}
        >
          <span
            aria-hidden="true"
            style={{ width: 7, height: 7, borderRadius: '50%', background: PHASE_DOT[phase] }}
          />
          {view.phaseLabel}
        </span>
        <div style={{ flex: 1 }} />
        <div
          style={{
            fontSize: 11,
            color: 'var(--wb-ink-muted)',
            padding: '0 8px 6px 0',
            alignSelf: 'flex-end',
          }}
        >
          工程：
          <span style={{ fontWeight: 700, color: 'var(--wb-ink)' }}>{view.flowHint}</span>
        </div>
      </div>
    </nav>
  );
}
