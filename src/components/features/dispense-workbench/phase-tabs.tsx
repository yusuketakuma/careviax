'use client';

/**
 * 工程タブ（設計プロト 調剤ワークベンチ.dc.html L106-117 の忠実移植）
 *
 * 上部の 4 工程タブ（調剤 / 調剤監査 / セット / セット監査）。現 phase（ルート props）を
 * active 表示し、各タブは next/link の Link で対応ルートへ遷移する。phase は store に
 * 保持せず URL がソースとなるため、タブクリックは store action ではなくページ遷移となる。
 * 右端に工程フロー（flowHint）を表示する。
 *
 * 表示データは view.phases / view.flowHint を参照する（use-workbench-view.ts が提供）。
 * 設計プロトの配色・寸法・余白は module.css の .phaseTabBar / .phaseTab + inline style で再現する。
 */

import Link from 'next/link';

import styles from './dispensing-workbench.module.css';
import type { Phase, WorkbenchView } from './dispensing-workbench.types';

/** phase → ルートパス（/dispense /audit /set /set-audit） */
const PHASE_HREF: Record<Phase, string> = {
  dispense: '/dispense',
  audit: '/audit',
  setp: '/set',
  seta: '/set-audit',
};

interface PhaseTabsProps {
  view: WorkbenchView;
  /** 現 phase（ルート props）。active 表示は view.phases[].active を参照するため本体では未使用だが、契約上 props として受け取る。 */
  phase: Phase;
}

export function PhaseTabs({ view }: PhaseTabsProps) {
  return (
    <div className={styles.phaseTabBar}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, padding: '6px 8px 0 8px' }}>
        {view.phases.map((ph) => (
            <Link
              key={ph.id}
              href={PHASE_HREF[ph.id]}
              aria-current={ph.active ? 'page' : undefined}
              className={styles.phaseTab}
              style={{
                background: ph.bg,
                color: ph.color,
                textDecoration: 'none',
                // active タブは bar 下端の境界線(1px)に重ねて本文白背景と地続きに見せる（設計プロト L110）
                marginBottom: ph.active ? -1 : 0,
              }}
            >
              <span
                aria-hidden="true"
                style={{ width: 7, height: 7, borderRadius: '50%', background: ph.dot }}
              />
              {ph.label}
            </Link>
          ))}
        <div style={{ flex: 1 }} />
        <div
          style={{
            fontSize: 11,
            color: '#5a6878',
            padding: '0 8px 6px 0',
            alignSelf: 'flex-end',
          }}
        >
          工程：
          <span style={{ fontWeight: 700, color: '#1b3a63' }}>{view.flowHint}</span>
        </div>
      </div>
    </div>
  );
}
