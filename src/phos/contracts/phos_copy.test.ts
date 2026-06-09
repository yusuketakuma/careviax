import { describe, expect, it } from 'vitest';
import {
  PhosActionLabel,
  PhosBoardDensityLabel,
  PhosButtonStateCopy,
  PhosClaimCandidateStatusLabel,
  PhosClinicalSignalCodeLabel,
  PhosCommunicationIntentLabel,
  PhosCommunicationTargetTypeLabel,
  PhosDecisionReasonLabel,
  PhosDisabledReason,
  PhosEmptyState,
  PhosHandoffCreateReasonLabel,
  PhosHandoffPanelCopy,
  PhosPharmacistBriefCopy,
  PhosReportComposerCopy,
  PhosReportComposerTemplateLabel,
  PhosRejectReasonLabel,
  PhosShortcutHelpCopy,
  PhosShortcutHelpRows,
  PhosSourceDrawerCopy,
  PhosSourceRefKindLabel,
  PhosDeliveryMethodLabel,
  PhosHandoffReturnReasonLabel,
  PhosSupportBriefCopy,
  PhosSupportTaskCodeLabel,
  PhosVisitFooterCopy,
  PhosVisitModePageCopy,
  PhosVisitStepStateLabel,
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

  it('contains keyboard shortcut help copy', () => {
    expect(PhosShortcutHelpCopy.TITLE).toBe('ショートカット');
    expect(PhosShortcutHelpRows.map((row) => row.keys)).toEqual([
      '/',
      'j / k',
      'Enter',
      'Space',
      'Esc',
      'g then 1..5',
      '[ / ]',
      '?',
    ]);
  });

  it('contains PharmacistBrief display copy without raw enum labels', () => {
    expect(PhosPharmacistBriefCopy.TITLE).toBe('薬剤師判断');
    expect(PhosClinicalSignalCodeLabel.DOSE_INCREASE).toBe('増量');
    expect(PhosDecisionReasonLabel.RESIDUAL_ADJUSTMENT).toBe('残薬調整');
    expect(PhosCommunicationIntentLabel.ASK_PRESCRIBER).toBe('医師確認');
    expect(PhosCommunicationTargetTypeLabel.DOCTOR).toBe('医師');
    expect(PhosClaimCandidateStatusLabel.MISSING_EVIDENCE).toBe('証跡不足');
  });

  it('contains SupportBrief and returned handoff display copy', () => {
    expect(PhosSupportBriefCopy.TITLE).toBe('事務サポート');
    expect(PhosSupportBriefCopy.COUNT_SUFFIX).toBe('件');
    expect(PhosSupportTaskCodeLabel.CONTACT_SETUP).toBe('連絡先の確認');
    expect(PhosDeliveryMethodLabel.HAND_DELIVERY).toBe('手渡し');
    expect(PhosHandoffReturnReasonLabel.NEED_MORE_INFO).toBe('情報の追加が必要です');
    expect(PhosHandoffCreateReasonLabel.DIFF_REVIEW).toBe('処方差分');
    expect(PhosHandoffPanelCopy.REQUESTED_ACTION_LABEL).toBe('希望対応');
    expect(PhosHandoffPanelCopy.REQUESTED_ACTION_REVIEW_ONLY).toBe('確認のみ');
  });

  it('contains Report Composer copy and recipient-specific template labels', () => {
    expect(PhosReportComposerCopy.TITLE).toBe('報告書作成');
    expect(PhosReportComposerCopy.TARGET_TABS_LABEL).toBe('宛先タブ');
    expect(PhosReportComposerCopy.APPROVAL_REQUIRED).toBe('送付前に薬剤師承認が必要です');
    expect(PhosReportComposerTemplateLabel.DOCTOR.ASSESSMENT).toBe('薬学的評価');
    expect(PhosReportComposerTemplateLabel.FAMILY.NEXT_CHECK).toBe('次回までの確認事項');
  });

  it('contains reason labels and no prohibited double-L cancellation copy', () => {
    const prohibitedCanceledSpelling = ['CANCEL', 'LED'].join('');
    const allCopy = [
      ...Object.values(PhosActionLabel),
      ...Object.values(PhosBoardDensityLabel),
      ...Object.values(PhosButtonStateCopy),
      ...Object.values(PhosClaimCandidateStatusLabel),
      ...Object.values(PhosClinicalSignalCodeLabel),
      ...Object.values(PhosCommunicationIntentLabel),
      ...Object.values(PhosCommunicationTargetTypeLabel),
      ...Object.values(PhosDecisionReasonLabel),
      ...Object.values(PhosDeliveryMethodLabel),
      ...Object.values(PhosDisabledReason),
      ...Object.values(PhosEmptyState),
      ...Object.values(PhosHandoffCreateReasonLabel),
      ...Object.values(PhosHandoffPanelCopy),
      ...Object.values(PhosHandoffReturnReasonLabel),
      ...Object.values(PhosPharmacistBriefCopy),
      ...Object.values(PhosReportComposerCopy),
      ...Object.values(PhosReportComposerTemplateLabel).flatMap((labels) => Object.values(labels)),
      ...Object.values(PhosRejectReasonLabel),
      ...Object.values(PhosShortcutHelpCopy),
      ...PhosShortcutHelpRows.flatMap((row) => [row.keys, row.label]),
      ...Object.values(PhosSourceDrawerCopy),
      ...Object.values(PhosSourceRefKindLabel),
      ...Object.values(PhosSupportBriefCopy),
      ...Object.values(PhosSupportTaskCodeLabel),
      ...Object.values(PhosToast),
      ...Object.values(PhosToastMessageByKey),
      ...Object.values(PhosVisitFooterCopy),
      ...Object.values(PhosVisitStepStateLabel),
    ].join('\n');

    expect(PhosRejectReasonLabel.OTHER).toBe('その他');
    expect(PhosVisitFooterCopy.SAVE_DRAFT).toBe('一時保存');
    expect(PhosVisitModePageCopy.LOADING).toBe('訪問モードを読み込み中');
    expect(PhosVisitStepStateLabel.IN_PROGRESS).toBe('入力中');
    expect(allCopy).not.toContain(prohibitedCanceledSpelling);
  });
});
