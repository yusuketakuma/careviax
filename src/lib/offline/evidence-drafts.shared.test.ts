import { describe, expect, it } from 'vitest';
import {
  MAX_EVIDENCE_SYNC_RETRIES,
  mergeVisitRecordAttachmentRefs,
  pickSyncableEvidenceDrafts,
  resolveScheduleVisitRecordId,
} from './evidence-drafts.shared';

describe('resolveScheduleVisitRecordId', () => {
  it('訪問予定詳細の visit_record.id を取り出す', () => {
    expect(resolveScheduleVisitRecordId({ visit_record: { id: 'record-1' } })).toBe('record-1');
  });

  it('記録未作成(null)や不正な形は null を返す', () => {
    expect(resolveScheduleVisitRecordId({ visit_record: null })).toBeNull();
    expect(resolveScheduleVisitRecordId({ visit_record: { id: '' } })).toBeNull();
    expect(resolveScheduleVisitRecordId({ visit_record: { id: 42 } })).toBeNull();
    expect(resolveScheduleVisitRecordId({})).toBeNull();
    expect(resolveScheduleVisitRecordId(null)).toBeNull();
  });
});

describe('mergeVisitRecordAttachmentRefs', () => {
  it('既存添付の file_id を順序維持で残し、新規 file_id を末尾へ追加する', () => {
    expect(
      mergeVisitRecordAttachmentRefs(
        [{ file_id: 'file-1' }, { file_id: 'file-2' }],
        'file-3',
      ),
    ).toEqual([{ file_id: 'file-1' }, { file_id: 'file-2' }, { file_id: 'file-3' }]);
  });

  it('重複・不正エントリを除いてマージする', () => {
    expect(
      mergeVisitRecordAttachmentRefs(
        [{ file_id: 'file-1' }, { file_id: 'file-1' }, { file_id: 7 }, null, 'x'],
        'file-1',
      ),
    ).toEqual([{ file_id: 'file-1' }]);
  });

  it('既存が配列でない場合は新規 file_id のみを返す', () => {
    expect(mergeVisitRecordAttachmentRefs(undefined, 'file-9')).toEqual([{ file_id: 'file-9' }]);
    expect(mergeVisitRecordAttachmentRefs('broken', 'file-9')).toEqual([{ file_id: 'file-9' }]);
  });
});

describe('pickSyncableEvidenceDrafts', () => {
  it('未同期かつリトライ上限内のドラフトだけを残す', () => {
    const drafts = [
      { id: 1, synced: false, retryCount: 0 },
      { id: 2, synced: true, retryCount: 0 },
      { id: 3, synced: false, retryCount: MAX_EVIDENCE_SYNC_RETRIES },
      { id: 4, synced: false, retryCount: MAX_EVIDENCE_SYNC_RETRIES - 1 },
    ];
    expect(pickSyncableEvidenceDrafts(drafts).map((draft) => draft.id)).toEqual([1, 4]);
  });
});
