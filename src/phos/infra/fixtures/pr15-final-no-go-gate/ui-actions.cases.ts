import { describe, expect, it } from 'vitest';
import { readRelative, expectEvidence, expectMissingFiles } from './test-support';

describe('PH-OS Final No-Go gate', () => {
  it('keeps stale-version and guard-failure behavior non-optimistic in the action hook', () => {
    const hook = readRelative('src/phos/api/usePhosAction.ts');
    const singleLineHook = hook.replace(/\n/g, ' ');

    expect(hook).toMatch(/error\.status === 422/);
    expect(hook).toMatch(/ActionPhase\.GUARD_FAILED/);
    expect(hook).toMatch(/error\.status === 409/);
    expect(hook).toMatch(/ActionPhase\.CONFLICT/);
    expect(singleLineHook).not.toMatch(/setState\(\{\s*phase:\s*ActionPhase\.SUCCEEDED[^}]*catch/);
  });

  it('keeps toast feedback paired with inline errors and duplicate debounce evidence', () => {
    expectEvidence('src/phos/ui/feedback/PhosToastRegion.test.tsx', [
      /debounces duplicate toast messages/,
      /appendPhosToast/,
      /PH-OS toast notifications/,
    ]);
    expectEvidence('src/phos/ui/board/BoardClient.test.tsx', [
      /renders successful action toasts/,
      /renders report delivery reply failures both inline and as a toast/,
      /getAllByText/,
      /PH-OS toast notifications/,
    ]);
  });

  it('keeps reason-required actions executable only with UI-provided reason codes', () => {
    expectEvidence('src/phos/ui/workspace/NextActionPanel.test.tsx', [
      /requires reason_code before executing reason-required actions/,
      /reason_required/,
      /PHOTO_INSUFFICIENT/,
      /getAttribute\('disabled'\)/,
      /getAttribute\('aria-disabled'\)/,
    ]);
    expectEvidence('src/phos/ui/board/BoardClient.test.tsx', [
      /sends workspace reason input for reason-required actions/,
      /reason_code: 'PHOTO_INSUFFICIENT'/,
      /reason_note: '写真が不鮮明です。'/,
    ]);
    expectEvidence('src/phos/ui/workspace/WorkspaceOverlay.test.tsx', [
      /clears stale reason input when the selected card action changes/,
      /カードをキャンセルする（実行不可）/,
    ]);
  });

  it('keeps Workspace deep links, opened card tabs, and focus return covered', () => {
    expectMissingFiles(['src/app/(phos)/board/page.tsx']);
    expectEvidence('src/phos/ui/board/BoardClient.test.tsx', [
      /opens a deep-linked card from the server-provided initial card id/,
      /syncs selected card state when the server-provided card query changes/,
      /opens a deep-linked card from the current URL/,
      /returns focus to the board root when a deep-linked source card is not in the current list/,
      /keeps opened card tabs and switches selected cards/,
      /returns focus to the source tile/,
    ]);
    expectEvidence('src/phos/ui/workspace/WorkspaceOverlay.test.tsx', [
      /OpenedCardTabs/,
      /delegates card switching/,
      /aria-pressed/,
      /closes on Escape/,
    ]);
  });

  it('keeps Source Drawer as a focus-returning sheet with source kind copy', () => {
    expectEvidence('src/phos/ui/workspace/SourceDrawerTrigger.tsx', [
      /SheetContent/,
      /side="right"/,
      /triggerRef\.current\?\.focus/,
    ]);
    expectEvidence('src/phos/ui/source/SourceRefList.tsx', [
      /PhosSourceRefKindLabel/,
      /safeSourceHref/,
      /!normalized\.startsWith\('\/\/'\)/,
      /parsed\.protocol === 'https:'/,
    ]);
    expectEvidence('src/phos/ui/workspace/SourceDrawerTrigger.test.tsx', [
      /keeps focus inside the source drawer/,
      /getByRole\('dialog'/,
      /queryByText\('rx_1'\)/,
      /\/\/evil\.example\/source/,
      /data:text\/html/,
      /fireEvent\.keyDown\(document, \{ key: 'Tab' \}\)/,
      /drawer\.contains\(document\.activeElement\)/,
    ]);
    expectEvidence('src/phos/ui/workspace/HandoffPanel.tsx', [/SourceRefList/]);
    expectEvidence('src/phos/ui/workspace/HandoffPanel.test.tsx', [
      /getAllByText\('処方原文'\)/,
      /queryByText\('PRESCRIPTION'\)/,
      /queryByText\('rx_1'\)/,
    ]);
  });

  it('keeps PharmacistBrief rendering copy-driven, source-backed, and action-safe', () => {
    expectEvidence('src/phos/ui/workspace/PharmacistBriefPanel.tsx', [
      /PhosPharmacistBriefCopy/,
      /PhosClinicalSignalCodeLabel/,
      /PhosDecisionReasonLabel/,
      /PhosCommunicationIntentLabel/,
      /PhosCommunicationTargetTypeLabel/,
      /PhosClaimCandidateStatusLabel/,
      /SourceRefList/,
      /fieldset/,
      /data-enabled/,
      /unavailableAriaField/,
    ]);
    expectEvidence('src/phos/ui/workspace/WorkspaceOverlay.tsx', [
      /PharmacistBriefPanel/,
      /detail\.pharmacist_brief/,
    ]);
    expectEvidence('src/phos/ui/workspace/PharmacistBriefPanel.test.tsx', [
      /without raw enum display/,
      /queryByText\('DOSE_INCREASE'\)/,
      /queryByText\('RESIDUAL_ADJUSTMENT'\)/,
      /queryByText\('ASK_PRESCRIBER'\)/,
      /queryByText\('MISSING_EVIDENCE'\)/,
      /hasAttribute\('disabled'\)/,
      /toHaveBeenCalledWith\('card_1', ActionCode\.CREATE_REPORT_DRAFT\)/,
    ]);
    expectEvidence('src/phos/ui/workspace/WorkspaceOverlay.test.tsx', [
      /pharmacist brief details/,
      /getByRole\('heading', \{ name: '薬剤師判断' \}\)/,
      /queryByText\('ADR_SUSPECT'\)/,
    ]);
  });

  it('keeps queue source ref displays on the shared safe source component', () => {
    expectEvidence('src/phos/ui/handoff/HandoffQueue.tsx', [/SourceRefList/]);
    expectEvidence('src/phos/ui/report/ReportDeliveryQueue.tsx', [/SourceRefList/]);
    expectEvidence('src/phos/ui/handoff/HandoffQueue.test.tsx', [
      /getAllByText\('処方原文'\)/,
      /queryByText\('PRESCRIPTION'\)/,
      /queryByText\('rx_1'\)/,
    ]);
    expectEvidence('src/phos/ui/report/ReportDeliveryQueue.test.tsx', [
      /getAllByText\('写真・証跡'\)/,
      /queryByText\('EVIDENCE_FILE'\)/,
      /queryByText\('report_1'\)/,
    ]);
  });

  it('keeps SupportBrief and returned handoff displays clerk-safe and copy-driven', () => {
    expectEvidence('src/phos/ui/workspace/SupportBriefPanel.tsx', [
      /PhosSupportBriefCopy/,
      /PhosSupportTaskCodeLabel/,
      /PhosDeliveryMethodLabel/,
      /PhosCommunicationTargetTypeLabel/,
      /PhosDecisionReasonLabel/,
      /SourceRefList/,
    ]);
    expectEvidence('src/phos/ui/workspace/WorkspaceOverlay.tsx', [
      /SupportBriefPanel/,
      /detail\.support_brief/,
    ]);
    expectEvidence('src/phos/ui/handoff/ClerkSupportWorkbench.tsx', [
      /PhosHandoffReturnReasonLabel/,
      /RETURNED_DETAIL_PREFIX/,
    ]);
    expectEvidence('src/phos/ui/workspace/SupportBriefPanel.test.tsx', [
      /without raw enum display/,
      /queryByText\('CONTACT_SETUP'\)/,
      /queryByText\('DIFF_REVIEW'\)/,
      /queryByText\('PRESCRIPTION'\)/,
      /queryByText\('rx_1'\)/,
      /queryByText\('phone'\)/,
    ]);
    expectEvidence('src/phos/ui/handoff/ClerkSupportWorkbench.test.tsx', [
      /情報の追加が必要です/,
      /追加すること/,
      /queryByText\('NEED_MORE_INFO'\)/,
    ]);
  });

  it('keeps Handoff composer and return UI structured instead of raw-code free text', () => {
    expectEvidence('src/phos/ui/workspace/HandoffPanel.tsx', [
      /PhosHandoffCreateReasonLabel/,
      /PhosHandoffPanelCopy/,
      /PhosHandoffReturnReasonLabel/,
      /createRequestedActions/,
      /REQUESTED_ACTION_LABEL/,
      /RETURN_REASON_LABEL/,
      /<select/,
    ]);
    expectEvidence('src/phos/ui/workspace/HandoffPanel.test.tsx', [
      /希望対応/,
      /確認のみ/,
      /queryByText\('DIFF_REVIEW'\)/,
      /queryByText\('REPORT_TEXT'\)/,
      /queryByText\('NEED_MORE_INFO'\)/,
    ]);
    expectEvidence('src/phos/ui/board/BoardClient.tsx', [
      /requested_action: input\.requested_action/,
    ]);
  });

  it('keeps standalone pharmacist Handoff Queue actionable after review opens', () => {
    expectEvidence('src/phos/ui/handoff/HandoffQueue.tsx', [
      /HandoffStatus\.IN_REVIEW/,
      /PhosHandoffReturnReasonLabel/,
      /PhosHandoffPanelCopy\.RESOLVE_ARIA/,
      /onResolve/,
      /onReturn/,
    ]);
    expectEvidence('src/phos/ui/handoff/HandoffQueue.test.tsx', [
      /keeps IN_REVIEW handoffs in the pharmacist queue/,
      /returns IN_REVIEW handoffs with structured reason copy/,
      /queryByText\('NEED_MORE_INFO'\)/,
    ]);
    expectEvidence('src/phos/ui/board/BoardClient.test.tsx', [
      /resolves pharmacist queue handoffs after opening review without selected card detail/,
      /client_version: 2/,
    ]);
  });

  it('keeps VisitMode stepper state labels explicit for field use', () => {
    expectEvidence('src/phos/ui/visit/VisitMode.tsx', [
      /PhosVisitStepStateLabel/,
      /stepStateLabel/,
      /last_opened_step/,
      /NOT_STARTED/,
      /IN_PROGRESS/,
    ]);
    expectEvidence('src/phos/ui/visit/VisitMode.test.tsx', [
      /not-started, in-progress, completed, or optional/,
      /入力中/,
      /未入力/,
      /任意/,
    ]);
  });

  it('keeps VisitMode footer navigation and draft-save from completing incomplete steps', () => {
    expectEvidence('src/phos/ui/visit/VisitMode.tsx', [
      /PhosVisitFooterCopy/,
      /PREVIOUS/,
      /SAVE_DRAFT/,
      /NEXT/,
      /canSyncDraft/,
      /activeStepCompleted/,
    ]);
    expectEvidence('src/phos/ui/board/BoardClient.tsx', [
      /handleSaveVisitDraft/,
      /step === VisitStep\.ARRIVAL_CONFIRM/,
      /onSaveVisitDraft/,
    ]);
    expectEvidence('src/phos/ui/board/BoardClient.test.tsx', [
      /does not submit VisitMode draft save for an incomplete current step/,
      /submits VisitMode draft save only for completed non-arrival steps/,
    ]);
  });

  it('keeps Capacity Dashboard chart usage scoped with a table fallback and role gate', () => {
    expectEvidence('src/phos/ui/capacity/CapacityDashboard.tsx', [
      /from 'recharts'/,
      /BarChart/,
      /Capacity Dashboard table fallback/,
      /canView/,
      /管理薬剤師または管理者のみ確認できます/,
    ]);
    expectEvidence('src/phos/ui/capacity/CapacityDashboard.test.tsx', [
      /Recharts charts, and table fallback/,
      /role gate/,
    ]);
    expectEvidence('src/phos/ui/capacity/CapacityDashboardClient.tsx', [
      /getCapacity/,
      /sessionHasCapacityRole/,
      /CapacityScope\.PHARMACY/,
    ]);
    expectMissingFiles(['src/app/(phos)/capacity/page.tsx']);
  });

  it('keeps SEND_REPORT behind an explicit confirmation surface', () => {
    expectEvidence('src/phos/ui/workspace/NextActionPanel.tsx', [
      /requiresSendConfirmation/,
      /ActionCode\.SEND_REPORT/,
      /送付前確認/,
      /送付後は取り消せません/,
      /onExecute\(cardId, nextAction\.code, executeReason\)/,
    ]);
    expectEvidence('src/phos/ui/workspace/NextActionPanel.test.tsx', [
      /requires explicit confirmation before executing SEND_REPORT/,
      /expect\(onExecute\)\.not\.toHaveBeenCalled/,
      /送付する/,
    ]);
  });

  it('keeps Report Composer as a structured recipient, template, source, and approval surface', () => {
    expectEvidence('src/phos/ui/report/ReportComposer.tsx', [
      /PhosReportComposerCopy/,
      /PhosReportComposerTemplateLabel/,
      /role="tablist"/,
      /textarea/,
      /SourceRefList/,
      /APPROVAL_REQUIRED/,
      /data-enabled/,
    ]);
    expectEvidence('src/phos/ui/workspace/WorkspaceTabs.tsx', [
      /ReportComposer/,
      /buildReportComposerView/,
      /detail\.support_brief\?\.delivery_targets/,
      /detail\.pharmacist_brief\?\.communication_recommendations/,
    ]);
    expectEvidence('src/phos/ui/report/ReportComposer.test.tsx', [
      /送付先準備済み/,
      /送付先未設定/,
      /薬剤師承認/,
      /送付前に薬剤師承認が必要です/,
      /queryByText\('PREVIOUS_VISIT'\)/,
      /getAttribute\('disabled'\)/,
    ]);
  });
});
