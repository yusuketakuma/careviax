import { describe, expect, it } from 'vitest';
import {
  PhosActionLabel,
  PhosBoardDensityLabel,
  PhosButtonStateCopy,
  PhosDisabledReason,
  PhosEmptyState,
  PhosRejectReasonLabel,
  PhosSourceDrawerCopy,
  PhosSourceRefKindLabel,
  PhosToast,
  PhosToastMessageByKey,
} from './phos_copy.ja';
import { BoardDensity, ButtonState, SourceRefKind } from './phos_contracts';

describe('PH-OS Japanese copy contract', () => {
  it('contains required toast keys', () => {
    expect(Object.keys(PhosToast).sort()).toEqual([
      'CLAIM_CANDIDATE_EXCLUDED_OK',
      'HANDOFF_CREATED_OK',
      'NET_ERROR_RETRY',
      'PHOTO_QUEUED',
      'REPORT_SENT_OK',
      'SYNC_CONFLICT_FOUND',
      'SYNC_DONE',
    ]);
  });

  it('contains the toast message keys emitted by PH-OS runtime flows', () => {
    expect(PhosToastMessageByKey).toMatchObject({
      'toast.handoff.created': PhosToast.HANDOFF_CREATED_OK,
      'toast.claim_candidate_excluded': PhosToast.CLAIM_CANDIDATE_EXCLUDED_OK,
      'toast.action.error': PhosToast.NET_ERROR_RETRY,
    });
  });

  it('contains required empty states', () => {
    expect(PhosEmptyState.EMPTY_TODAY_NONE).toBe('本日対応予定のカードはありません。');
    expect(PhosEmptyState.EMPTY_HANDOFF).toBe('確認依頼はありません。');
    expect(PhosEmptyState.EMPTY_WAITING_REPLY).toBe('返信待ちはありません。');
  });

  it('contains Board density and ButtonState display copy', () => {
    expect(Object.keys(PhosBoardDensityLabel).sort()).toEqual(Object.values(BoardDensity).sort());
    expect(Object.keys(PhosButtonStateCopy).sort()).toEqual(Object.values(ButtonState).sort());
    expect(PhosBoardDensityLabel.COMPACT).toBe('コンパクト');
    expect(PhosButtonStateCopy.NO_PERMISSION).toBe('この操作は薬剤師確認が必要です。');
  });

  it('contains source ref kind labels for Source Drawer display', () => {
    expect(Object.keys(PhosSourceRefKindLabel).sort()).toEqual(Object.values(SourceRefKind).sort());
    expect(PhosSourceRefKindLabel.PRESCRIPTION).toBe('処方原文');
    expect(PhosSourceRefKindLabel.EVIDENCE_FILE).toBe('写真・証跡');
    expect(PhosSourceDrawerCopy.OPEN).toBe('参照情報を開く');
    expect(PhosSourceDrawerCopy.EMPTY).toBe('参照情報はありません。');
    expect(PhosSourceDrawerCopy.COUNT_SUFFIX).toBe('件');
    expect(PhosSourceDrawerCopy.WORKSPACE_SECTION_HEADING).toBe('参照情報');
  });

  it('contains reason labels and no prohibited double-L cancellation copy', () => {
    const prohibitedCanceledSpelling = ['CANCEL', 'LED'].join('');
    const allCopy = [
      ...Object.values(PhosActionLabel),
      ...Object.values(PhosBoardDensityLabel),
      ...Object.values(PhosButtonStateCopy),
      ...Object.values(PhosDisabledReason),
      ...Object.values(PhosEmptyState),
      ...Object.values(PhosRejectReasonLabel),
      ...Object.values(PhosSourceDrawerCopy),
      ...Object.values(PhosSourceRefKindLabel),
      ...Object.values(PhosToast),
      ...Object.values(PhosToastMessageByKey),
    ].join('\n');

    expect(PhosRejectReasonLabel.OTHER).toBe('その他');
    expect(allCopy).not.toContain(prohibitedCanceledSpelling);
  });
});
