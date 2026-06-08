import { describe, expect, it } from 'vitest';
import {
  PhosActionLabel,
  PhosDisabledReason,
  PhosEmptyState,
  PhosRejectReasonLabel,
  PhosToast,
} from './phos_copy.ja';

describe('PH-OS Japanese copy contract', () => {
  it('contains required toast keys', () => {
    expect(Object.keys(PhosToast).sort()).toEqual([
      'HANDOFF_CREATED_OK',
      'NET_ERROR_RETRY',
      'PHOTO_QUEUED',
      'REPORT_SENT_OK',
      'SYNC_CONFLICT_FOUND',
      'SYNC_DONE',
    ]);
  });

  it('contains required empty states', () => {
    expect(PhosEmptyState.EMPTY_TODAY_NONE).toBe('本日対応予定のカードはありません。');
    expect(PhosEmptyState.EMPTY_HANDOFF).toBe('確認依頼はありません。');
    expect(PhosEmptyState.EMPTY_WAITING_REPLY).toBe('返信待ちはありません。');
  });

  it('contains reason labels and no prohibited double-L cancellation copy', () => {
    const prohibitedCanceledSpelling = ['CANCEL', 'LED'].join('');
    const allCopy = [
      ...Object.values(PhosActionLabel),
      ...Object.values(PhosDisabledReason),
      ...Object.values(PhosEmptyState),
      ...Object.values(PhosRejectReasonLabel),
      ...Object.values(PhosToast),
    ].join('\n');

    expect(PhosRejectReasonLabel.OTHER).toBe('その他');
    expect(allCopy).not.toContain(prohibitedCanceledSpelling);
  });
});
