import { describe, expect, it } from 'vitest';
import type { SyncQueueItemSummary } from '@/lib/stores/sync-engine';
import {
  buildOfflineSyncConflictView,
  buildOfflineSyncRows,
  collectOfflineSyncScheduleIds,
  getOfflineSyncLocalOverwriteDisabledReason,
  getOfflineSyncRetryAllDisabledReason,
  resolveSyncRowPatientLabel,
} from './offline-sync.shared';

function buildItem(overrides: Partial<SyncQueueItemSummary> = {}): SyncQueueItemSummary {
  return {
    id: 1,
    entityType: 'visit_record',
    scope_id: 'sched_1',
    createdAt: new Date('2026-06-12T09:00:00+09:00'),
    retryCount: 0,
    payload: { schedule_id: 'sched_1', patient_id: 'patient_1' },
    conflict: null,
    ...overrides,
  };
}

const NAMES = new Map([['sched_1', '田中一郎']]);

describe('buildOfflineSyncRows', () => {
  it('maps queued, failed, and conflict states to the p0_34 row labels', () => {
    const rows = buildOfflineSyncRows(
      [
        buildItem({ id: 1, retryCount: 0 }),
        buildItem({ id: 2, retryCount: 3, lastError: 'HTTP 500', scope_id: 'sched_x' }),
        buildItem({
          id: 3,
          retryCount: 3,
          conflict_state: 'server_conflict',
          lastError: 'HTTP 409 conflict',
          scope_id: 'sched_x',
        }),
      ],
      NAMES,
    );

    expect(rows.map((row) => row.statusLabel)).toEqual(['同期待ち', '失敗', '競合']);
    expect(rows.map((row) => row.nextActionLabel)).toEqual(['そのまま', '再試行', '内容を確認']);
    expect(rows.map((row) => row.statusKey)).toEqual(['queued', 'failed', 'conflict']);
  });

  it('labels entity kinds in Japanese', () => {
    const rows = buildOfflineSyncRows(
      [
        buildItem({ id: 1, entityType: 'visit_record' }),
        buildItem({ id: 2, entityType: 'residual_medication' }),
      ],
      NAMES,
    );

    expect(rows.map((row) => row.kindLabel)).toEqual(['訪問メモ', '残薬調整']);
  });
});

describe('resolveSyncRowPatientLabel', () => {
  it('prefers the cached patient name resolved from the schedule id', () => {
    expect(resolveSyncRowPatientLabel(buildItem(), NAMES)).toBe('田中一郎');
  });

  it('falls back to the payload patient id, then the scope id', () => {
    expect(
      resolveSyncRowPatientLabel(
        buildItem({ payload: { patient_id: 'patient_9' }, scope_id: 'sched_unknown' }),
        NAMES,
      ),
    ).toBe('patient_9');
    expect(
      resolveSyncRowPatientLabel(buildItem({ payload: {}, scope_id: 'sched_unknown' }), NAMES),
    ).toBe('sched_unknown');
    expect(resolveSyncRowPatientLabel(buildItem({ payload: {}, scope_id: undefined }), NAMES)).toBe(
      '対象不明',
    );
  });
});

describe('collectOfflineSyncScheduleIds', () => {
  it('collects unique schedule ids needed for patient-name lookup', () => {
    expect(
      collectOfflineSyncScheduleIds([
        buildItem({ payload: { schedule_id: 'sched_1' }, scope_id: 'ignored' }),
        buildItem({ payload: {}, scope_id: 'sched_2' }),
        buildItem({ payload: { schedule_id: 'sched_1' }, scope_id: 'sched_1' }),
        buildItem({ payload: { patient_id: 'patient_1' }, scope_id: undefined }),
      ]),
    ).toEqual(['sched_1', 'sched_2']);
  });
});

describe('buildOfflineSyncConflictView', () => {
  const conflictItem = buildItem({
    id: 7,
    retryCount: 3,
    conflict_state: 'server_conflict',
    conflict: {
      local: {
        schedule_id: 'sched_1',
        outcome_status: 'completed',
        soap_subjective: '夕食後薬は家族声かけで服用。',
      },
      server: {
        id: 'rec_1',
        version: 2,
        patient_id: 'patient_1',
        visit_date: '2026-06-12',
        outcome_status: 'completed',
        soap_subjective: '夕食後薬は家族声かけで服用。便秘あり。',
      },
    },
  });

  it('builds the local/server compare view for p0_35', () => {
    const view = buildOfflineSyncConflictView(conflictItem, NAMES);

    expect(view).not.toBeNull();
    expect(view?.itemId).toBe(7);
    expect(view?.patientLabel).toBe('田中一郎');
    expect(view?.localText).toBe('夕食後薬は家族声かけで服用。');
    expect(view?.serverText).toBe('夕食後薬は家族声かけで服用。便秘あり。');
    expect(view?.serverVisitDate).toBe('2026-06-12');
    expect(view?.canOverwrite).toBe(true);
  });

  it('disables overwrite when the server snapshot is missing', () => {
    const view = buildOfflineSyncConflictView(
      buildItem({
        id: 8,
        conflict_state: 'server_conflict',
        conflict: { local: { soap_plan: 'メモ' }, server: null },
      }),
      NAMES,
    );

    expect(view?.canOverwrite).toBe(false);
    expect(view?.serverText).toBe('サーバー側の記録を取得できませんでした。');
  });

  it('returns null without a conflict snapshot or id', () => {
    expect(buildOfflineSyncConflictView(buildItem({ conflict: null }), NAMES)).toBeNull();
    expect(
      buildOfflineSyncConflictView(
        buildItem({ id: undefined, conflict: { local: {}, server: null } }),
        NAMES,
      ),
    ).toBeNull();
  });
});

describe('offline sync disabled reasons', () => {
  it('keeps retry and conflict disabled reasons fixed and value-free', () => {
    expect(getOfflineSyncRetryAllDisabledReason({ isPending: false, rowCount: 0 })).toBe(
      '未同期のデータはありません。',
    );
    expect(getOfflineSyncRetryAllDisabledReason({ isPending: false, rowCount: 1 })).toBeNull();
    expect(getOfflineSyncRetryAllDisabledReason({ isPending: true, rowCount: 0 })).toBeNull();
    expect(
      getOfflineSyncLocalOverwriteDisabledReason({ canOverwrite: false, isPending: false }),
    ).toBe('サーバー側の記録を取得できないため上書きできません。');
    expect(
      getOfflineSyncLocalOverwriteDisabledReason({ canOverwrite: true, isPending: false }),
    ).toBeNull();
    expect(
      getOfflineSyncLocalOverwriteDisabledReason({ canOverwrite: false, isPending: true }),
    ).toBeNull();

    const allReasons = [
      getOfflineSyncRetryAllDisabledReason({ isPending: false, rowCount: 0 }),
      getOfflineSyncLocalOverwriteDisabledReason({ canOverwrite: false, isPending: false }),
    ].join(' ');
    expect(allReasons).not.toMatch(/patient_|sched_|田中|一郎|rec_/);
  });
});
