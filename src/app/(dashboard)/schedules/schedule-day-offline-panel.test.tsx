// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import type { CachedVisitBriefCard } from '@/lib/visits/visit-brief-cache';
import type { ScheduleDayOfflineStatusViewModel } from './schedule-day-view.helpers';
import {
  ScheduleDayOfflinePanel,
  type ScheduleDayOfflinePanelProps,
  type ScheduleDaySyncConflictItem,
} from './schedule-day-offline-panel';

setupDomTestEnv();

const offlineStatus: ScheduleDayOfflineStatusViewModel = {
  visible: true,
  networkBadgeLabel: 'オンライン',
  networkBadgeClassName: 'border-emerald-200 text-emerald-700',
  pendingSyncLabel: '同期待ち 0 件',
  conflictLabel: '競合 0 件',
  ttlLabel: '保持期限 24h',
  visitBriefCoverageLabel: 'ブリーフ 0/0 件',
  visitBriefCoverageClassName: 'border-emerald-200 text-emerald-700',
  visitBriefStatusLabel: '当日の確定訪問はありません。',
  visitBriefStatusClassName: 'text-muted-foreground',
  lastSyncLabel: '未実施',
  canManualSync: false,
  manualSyncDisabledReason: '同期待ちの下書きはありません',
  showConflictResolutionHint: false,
};

const cachedBrief: CachedVisitBriefCard = {
  scheduleId: 'schedule_1',
  patientId: 'patient_1',
  patientName: '患者A',
  scheduledDate: '2026-04-09',
  timeWindowStart: '2026-04-09T09:00:00.000Z',
  timeWindowEnd: '2026-04-09T10:00:00.000Z',
  priority: 'normal',
  facilityLabel: '居宅',
  siteName: '本店',
  headline: '血圧変動と残薬確認',
  mustCheckToday: ['降圧薬残数', 'ふらつき', '服薬カレンダー', '次回採血予定'],
  sourceRefs: ['latest_visit_record', 'medication_list'],
  generatedAt: '2026-04-09T07:30:00.000Z',
  provider: 'openai',
  isFallback: false,
};

function conflict(
  overrides: Partial<ScheduleDaySyncConflictItem> = {},
): ScheduleDaySyncConflictItem {
  return {
    id: 42,
    scope_id: 'schedule_conflict',
    lastError: 'サーバー側が更新されています',
    conflict: {
      local: {
        outcome_status: 'completed',
        soap_plan: 'ローカル下書きのP',
      },
      server: {
        outcome_status: 'partial',
        soap_plan: 'サーバー版のP',
      },
    },
    ...overrides,
  };
}

function panelProps(
  overrides: Partial<ScheduleDayOfflinePanelProps> = {},
): ScheduleDayOfflinePanelProps {
  return {
    offlineStatus,
    manualSyncPending: false,
    onManualSync: vi.fn(),
    syncConflicts: [],
    overwriteConflictPending: false,
    discardConflictPending: false,
    onOverwriteConflict: vi.fn(),
    onDiscardConflict: vi.fn(),
    cachedVisitBriefs: [],
    ...overrides,
  };
}

describe('ScheduleDayOfflinePanel', () => {
  it('renders nothing when offline status is hidden', () => {
    const { container } = render(
      <ScheduleDayOfflinePanel
        {...panelProps({ offlineStatus: { ...offlineStatus, visible: false } })}
      />,
    );

    expect(container.childElementCount).toBe(0);
  });

  it('announces sync status and explains why manual sync is disabled', () => {
    render(
      <ScheduleDayOfflinePanel
        {...panelProps({
          offlineStatus: {
            ...offlineStatus,
            conflictLabel: '競合 1 件',
            manualSyncDisabledReason: '競合を解決してから同期してください',
          },
        })}
      />,
    );

    const statusText = screen.getByRole('status').textContent ?? '';
    expect(statusText).toContain('オンライン');
    expect(statusText).toContain('同期待ち 0 件');
    expect(statusText).toContain('競合 1 件');
    expect(statusText).toContain('ブリーフ 0/0 件');
    expect(statusText).toContain('当日の確定訪問はありません。');
    expect(statusText).toContain('最終同期 未実施');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '今すぐ同期' }).disabled).toBe(
      true,
    );
    expect(screen.getByText('競合を解決してから同期してください')).toBeTruthy();
  });

  it('shows visit brief coverage and failure status in the sync group', () => {
    render(
      <ScheduleDayOfflinePanel
        {...panelProps({
          offlineStatus: {
            ...offlineStatus,
            visitBriefCoverageLabel: 'ブリーフ 1/3 件',
            visitBriefCoverageClassName: 'border-amber-200 bg-amber-50 text-amber-700',
            visitBriefStatusLabel:
              '軽量 brief を更新できません。患者詳細と処方を確認してください。',
            visitBriefStatusClassName: 'text-amber-700',
          },
        })}
      />,
    );

    expect(screen.getByText('ブリーフ 1/3 件')).toBeTruthy();
    expect(
      screen.getByText('軽量 brief を更新できません。患者詳細と処方を確認してください。'),
    ).toBeTruthy();
    const statusText = screen.getByRole('status').textContent ?? '';
    expect(statusText).toContain('ブリーフ 1/3 件');
    expect(statusText).toContain('軽量 brief を更新できません');
  });

  it('requires confirmation before overwriting or discarding a conflict', () => {
    const onOverwriteConflict = vi.fn();
    const onDiscardConflict = vi.fn();
    render(
      <ScheduleDayOfflinePanel
        {...panelProps({
          syncConflicts: [conflict()],
          onOverwriteConflict,
          onDiscardConflict,
        })}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'schedule schedule_conflict をサーバーへ上書き' }),
    );
    expect(onOverwriteConflict).not.toHaveBeenCalled();
    expect(screen.getByText('ローカル下書きでサーバー版を上書きします')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '上書きを確定' }));
    expect(onOverwriteConflict).toHaveBeenCalledWith(42);
    expect(onOverwriteConflict).toHaveBeenCalledTimes(1);
    expect(onDiscardConflict).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole('button', { name: 'schedule schedule_conflict のローカル下書きを破棄' }),
    );
    expect(onDiscardConflict).not.toHaveBeenCalled();
    expect(screen.getByText('ローカル下書きを破棄してサーバー版を残します')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '破棄を確定' }));
    expect(onDiscardConflict).toHaveBeenCalledWith(42);
    expect(onDiscardConflict).toHaveBeenCalledTimes(1);
  });

  it('disables conflict actions when the conflict id is missing', () => {
    const onOverwriteConflict = vi.fn();
    const onDiscardConflict = vi.fn();
    render(
      <ScheduleDayOfflinePanel
        {...panelProps({
          syncConflicts: [conflict({ id: undefined })],
          onOverwriteConflict,
          onDiscardConflict,
        })}
      />,
    );

    expect(
      screen.getByRole<HTMLButtonElement>('button', {
        name: 'schedule schedule_conflict をサーバーへ上書き',
      }).disabled,
    ).toBe(true);
    expect(
      screen.getByRole<HTMLButtonElement>('button', {
        name: 'schedule schedule_conflict のローカル下書きを破棄',
      }).disabled,
    ).toBe(true);
    expect(
      screen.getByText('競合IDを確認できないため、同期状態を再読み込みしてください。'),
    ).toBeTruthy();
    expect(onOverwriteConflict).not.toHaveBeenCalled();
    expect(onDiscardConflict).not.toHaveBeenCalled();
  });

  it('marks conflict actions and re-edit link unavailable while a mutation is pending', () => {
    render(
      <ScheduleDayOfflinePanel
        {...panelProps({
          syncConflicts: [conflict()],
          overwriteConflictPending: true,
        })}
      />,
    );

    expect(
      screen.getByRole<HTMLButtonElement>('button', {
        name: 'schedule schedule_conflict をサーバーへ上書き',
      }).disabled,
    ).toBe(true);
    expect(
      screen.getByRole<HTMLButtonElement>('button', {
        name: 'schedule schedule_conflict のローカル下書きを破棄',
      }).disabled,
    ).toBe(true);
    expect(
      screen
        .getByRole('link', { name: 'schedule schedule_conflict を再編集' })
        .getAttribute('aria-disabled'),
    ).toBe('true');
  });

  it('renders cached briefs as a labelled list with generated provider labels', () => {
    render(<ScheduleDayOfflinePanel {...panelProps({ cachedVisitBriefs: [cachedBrief] })} />);

    expect(screen.getByRole('list', { name: '軽量訪問ブリーフ' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '患者A' })).toBeTruthy();
    expect(screen.getByText('AI生成')).toBeTruthy();
    expect(screen.getByText('- 降圧薬残数')).toBeTruthy();
    expect(screen.getByText('- ふらつき')).toBeTruthy();
    expect(screen.getByText('- 服薬カレンダー')).toBeTruthy();
    expect(screen.queryByText('- 次回採血予定')).toBeNull();
  });

  it('marks generated cached briefs with no must-check items explicitly', () => {
    render(
      <ScheduleDayOfflinePanel
        {...panelProps({
          cachedVisitBriefs: [{ ...cachedBrief, mustCheckToday: [] }],
        })}
      />,
    );

    expect(screen.getByText('本日重要チェックなし（生成済み）')).toBeTruthy();
  });
});
