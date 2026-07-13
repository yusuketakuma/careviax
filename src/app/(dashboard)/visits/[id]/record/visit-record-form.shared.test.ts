import { describe, expect, it } from 'vitest';
import type { SyncQueueItemSummary } from '@/lib/stores/sync-engine';
import {
  buildReflectPatientIntake,
  getVisitReceiptReadiness,
  normalizeVisitReceiptPayload,
  resolveVisitRecordSavePresentation,
} from './visit-record-form.shared';

function buildQueueItem(overrides: Partial<SyncQueueItemSummary> = {}): SyncQueueItemSummary {
  return {
    id: 1,
    entityType: 'visit_record',
    payload: { schedule_id: 'schedule-current' },
    scope_id: 'schedule-current',
    createdAt: new Date('2026-07-13T00:00:00.000Z'),
    retryCount: 0,
    conflict: null,
    ...overrides,
  };
}

function resolveSavePresentation(
  overrides: Partial<Parameters<typeof resolveVisitRecordSavePresentation>[0]> = {},
) {
  return resolveVisitRecordSavePresentation({
    scheduleId: 'schedule-current',
    queueItems: [],
    unsyncedEvidenceCount: 0,
    draftHydrated: true,
    hasLocalDraft: false,
    draftSaveStatus: 'idle',
    serverSavePending: false,
    serverSaved: false,
    medicationStockStatus: 'idle',
    ...overrides,
  });
}

describe('resolveVisitRecordSavePresentation', () => {
  it('keeps a fresh record unsaved even when another schedule is queued or conflicted', () => {
    expect(
      resolveSavePresentation({
        queueItems: [
          buildQueueItem({ scope_id: 'schedule-other' }),
          buildQueueItem({
            id: 2,
            scope_id: 'schedule-conflict',
            conflict_state: 'server_conflict',
          }),
        ],
      }),
    ).toEqual({ state: 'unsaved', pendingCount: 0 });
  });

  it('uses only the current schedule queue and preserves conflict and failed states', () => {
    expect(
      resolveSavePresentation({
        queueItems: [buildQueueItem()],
      }),
    ).toEqual({ state: 'queued', pendingCount: 1 });

    expect(
      resolveSavePresentation({
        queueItems: [buildQueueItem({ conflict_state: 'server_conflict' })],
      }),
    ).toEqual({ state: 'conflict', pendingCount: 1 });

    expect(
      resolveSavePresentation({
        queueItems: [buildQueueItem({ retryCount: 1, lastError: 'HTTP 503' })],
      }),
    ).toEqual({ state: 'failed', pendingCount: 1 });
  });

  it('falls back to the payload schedule id only for legacy queue items without scope_id', () => {
    expect(
      resolveSavePresentation({
        queueItems: [buildQueueItem({ scope_id: undefined })],
      }),
    ).toEqual({ state: 'queued', pendingCount: 1 });

    expect(
      resolveSavePresentation({
        queueItems: [
          buildQueueItem({
            scope_id: 'schedule-other',
            payload: { schedule_id: 'schedule-current' },
          }),
        ],
      }),
    ).toEqual({ state: 'unsaved', pendingCount: 0 });
  });

  it('separates hydration, local save, server save, and partial submission failure', () => {
    expect(resolveSavePresentation({ draftHydrated: false })).toEqual({
      state: 'checking',
      pendingCount: 0,
    });
    expect(resolveSavePresentation({ hasLocalDraft: true })).toEqual({
      state: 'saved_locally',
      pendingCount: 0,
    });
    expect(resolveSavePresentation({ serverSaved: true })).toEqual({
      state: 'synced',
      pendingCount: 0,
    });
    expect(resolveSavePresentation({ serverSaved: true, medicationStockStatus: 'error' })).toEqual({
      state: 'failed',
      pendingCount: 0,
    });
  });

  it('counts only current-record queue entries plus current-record evidence', () => {
    expect(
      resolveSavePresentation({
        queueItems: [buildQueueItem(), buildQueueItem({ id: 2, scope_id: 'schedule-other' })],
        unsyncedEvidenceCount: 2,
      }),
    ).toEqual({ state: 'queued', pendingCount: 3 });
  });

  it('normalizes invalid evidence counts without corrupting the save state', () => {
    expect(resolveSavePresentation({ unsyncedEvidenceCount: Number.NaN })).toEqual({
      state: 'unsaved',
      pendingCount: 0,
    });
    expect(resolveSavePresentation({ unsyncedEvidenceCount: -2.8 })).toEqual({
      state: 'unsaved',
      pendingCount: 0,
    });
  });
});

describe('getVisitReceiptReadiness', () => {
  it('treats an untouched receipt block as optional and incomplete', () => {
    expect(
      getVisitReceiptReadiness({
        receipt_person_name: '',
        receipt_person_relation: '',
        receipt_at: '2026-06-15T00:00',
      }),
    ).toEqual({
      hasIdentityInput: false,
      hasCompleteIdentity: false,
      missingLabels: [],
    });
  });

  it('requires name, relation, and timestamp once receipt identity is started', () => {
    expect(
      getVisitReceiptReadiness({
        receipt_person_name: '山田 花子',
        receipt_person_relation: '',
        receipt_at: '2026-06-15T14:30',
      }),
    ).toEqual({
      hasIdentityInput: true,
      hasCompleteIdentity: false,
      missingLabels: ['続柄'],
    });

    expect(
      getVisitReceiptReadiness({
        receipt_person_name: '',
        receipt_person_relation: 'child',
        receipt_at: '',
      }),
    ).toEqual({
      hasIdentityInput: true,
      hasCompleteIdentity: false,
      missingLabels: ['受領者名', '受領日時'],
    });
  });

  it('marks receipt evidence complete only when all identity fields are present', () => {
    expect(
      getVisitReceiptReadiness({
        receipt_person_name: '山田 花子',
        receipt_person_relation: 'child',
        receipt_at: '2026-06-15T14:30',
      }),
    ).toEqual({
      hasIdentityInput: true,
      hasCompleteIdentity: true,
      missingLabels: [],
    });
  });
});

describe('normalizeVisitReceiptPayload', () => {
  it('drops the default receipt timestamp when no receiver identity was entered', () => {
    expect(
      normalizeVisitReceiptPayload({
        receipt_person_name: '',
        receipt_person_relation: '',
        receipt_at: '2026-06-15T00:00',
        soap_plan: '次回確認',
      }),
    ).toEqual({
      receipt_person_name: undefined,
      receipt_person_relation: undefined,
      receipt_at: undefined,
      soap_plan: '次回確認',
    });
  });

  it('trims started receipt identity fields before submission', () => {
    expect(
      normalizeVisitReceiptPayload({
        receipt_person_name: ' 山田 花子 ',
        receipt_person_relation: ' child ',
        receipt_at: ' 2026-06-15T14:30 ',
      }),
    ).toEqual({
      receipt_person_name: '山田 花子',
      receipt_person_relation: 'child',
      receipt_at: '2026-06-15T14:30',
    });
  });
});

describe('buildReflectPatientIntake', () => {
  it('入力された項目だけを intake に含め、前後空白を除去する', () => {
    expect(
      buildReflectPatientIntake({ careLevel: ' 要介護2 ', medicationManager: 'family' }),
    ).toEqual({ care_level: '要介護2', medication_manager: 'family' });
  });

  it('空欄・空白のみの項目は送らない(既存値を変更しないため)', () => {
    expect(buildReflectPatientIntake({ careLevel: '要支援1', medicationManager: '   ' })).toEqual({
      care_level: '要支援1',
    });
  });

  it('全項目が空なら null を返す', () => {
    expect(buildReflectPatientIntake({ careLevel: '', medicationManager: '' })).toBeNull();
    expect(buildReflectPatientIntake({})).toBeNull();
  });
});
