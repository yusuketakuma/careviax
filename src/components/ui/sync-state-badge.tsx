import type { ReactNode } from 'react';
import { StateBadge } from '@/components/ui/state-badge';
import {
  getOfflineSyncStatusEntry,
  type OfflineSyncStatus,
} from '@/lib/constants/visual-status-registry';

export type SyncStateBadgeProps = {
  /** オフライン同期の行内状態(SSOT 6.6 / 確定表「オフライン同期状態」)。 */
  status: OfflineSyncStatus;
  /** 表示ラベル。省略時は確定表の既定ラベル(端末保存済/送信待ち/送信失敗/同期済み/競合)。 */
  children?: ReactNode;
  className?: string;
};

/**
 * オフライン同期 4 状態(+競合)の行内バッジ(SSOT 6.6)。役割写像は
 * `OFFLINE_SYNC_STATUS_ROLE`(status-labels.ts)を単一ソースとし、画面ローカルの
 * role マップ再実装を禁止する。StateBadge 経由で色+アイコン+文言を常に併記
 * (色だけに依存しない)。送信失敗(blocked)は常時表示から外さない(false-success 防止 2.7)。
 */
export function SyncStateBadge({ status, children, className }: SyncStateBadgeProps) {
  const entry = getOfflineSyncStatusEntry(status);

  return (
    <StateBadge role={entry.role} className={className}>
      {children ?? entry.label}
    </StateBadge>
  );
}
