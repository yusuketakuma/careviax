import { describe, it } from 'vitest';
import { expectEvidence, expectMissingFiles } from './test-support';

describe('PH-OS Final No-Go gate', () => {
  it('keeps the current /reports workspace without a competing PH-OS route group page', () => {
    expectEvidence('src/app/(dashboard)/reports/page.tsx', [
      /ReportShareWorkspace/,
      /PageScaffold/,
    ]);
    expectEvidence('src/phos/ui/report/ReportsPageClient.tsx', [
      /getReportDeliveries\(\{ status: ReportDeliveryStatus\.WAITING_REPLY \}\)/,
      /getReportDeliveries\(\{ status: ReportDeliveryStatus\.ACTION_REQUIRED \}\)/,
      /router\.push\(`\/board\?card=\$\{encodeURIComponent\(cardId\)\}`\)/,
      /registerReportReply/,
      /markReportActionDone/,
    ]);
    expectEvidence('src/phos/ui/report/ReportsPageClient.test.tsx', [
      /loads waiting and action-required PH-OS report deliveries/,
      /existing \/reports route back to the Board deep link/,
      /server version and idempotency/,
      /without adding a competing \/reports route/,
    ]);
    expectMissingFiles(['src/app/(phos)/reports/page.tsx']);
  });

  it('keeps Board keyboard navigation and Space primary-action behavior covered', () => {
    expectEvidence('src/phos/ui/board/CardTile.tsx', [
      /handleCardBodyKeyDown/,
      /event\.key !== ' '/,
      /onPrimaryAction\(input\.cardId, input\.nextAction\.code\)/,
      /data-phos-card-body="true"/,
    ]);
    expectEvidence('src/phos/ui/board/CardBoard.tsx', [
      /handleBoardKeyDown/,
      /event\.key !== 'j' && event\.key !== 'k'/,
      /isTextEntryTarget/,
      /focusCardBody/,
    ]);
    expectEvidence('src/phos/ui/board/CardTile.test.tsx', [
      /Space on the card body/,
      /expect\(onOpen\)\.not\.toHaveBeenCalled/,
      /does not run the Space shortcut/,
    ]);
    expectEvidence('src/phos/ui/board/CardBoard.test.tsx', [
      /moves card focus with j and k/,
      /does not hijack j or k/,
    ]);
  });

  it('keeps Workspace tab and opened-card keyboard shortcuts covered', () => {
    expectEvidence('src/phos/ui/workspace/WorkspaceTabs.tsx', [
      /tabChordOpen/,
      /event\.key === 'g'/,
      /\^\[1-9\]\$/,
      /isTextEntryTarget/,
    ]);
    expectEvidence('src/phos/ui/workspace/WorkspaceOverlay.tsx', [
      /selectAdjacentOpenedCard/,
      /event\.key !== '\[' && event\.key !== '\]'/,
      /onSelectOpenedCard\(input\.openedCards\[nextIndex\]\?\.card_id/,
      /isTextEntryTarget/,
    ]);
    expectEvidence('src/phos/ui/workspace/WorkspaceTabs.test.tsx', [
      /g then number keyboard chord/,
      /does not hijack the g then number keyboard chord/,
      /out-of-range g then number/,
    ]);
    expectEvidence('src/phos/ui/workspace/WorkspaceOverlay.test.tsx', [
      /bracket keyboard shortcuts/,
      /does not switch opened cards while typing/,
    ]);
  });

  it('keeps shortcut help available from question mark without hijacking text entry', () => {
    expectEvidence('src/phos/ui/a11y/ShortcutHelpDialog.tsx', [
      /PhosShortcutHelpCopy/,
      /PhosShortcutHelpRows/,
      /DialogContent/,
      /Keyboard/,
    ]);
    expectEvidence('src/phos/ui/board/BoardClient.tsx', [
      /ShortcutHelpDialog/,
      /event\.key !== '\?'/,
      /isTextEntryTarget/,
      /setShortcutHelpOpen\(true\)/,
    ]);
    expectEvidence('src/phos/ui/board/BoardClient.test.tsx', [
      /opens shortcut help with question mark/,
      /does not open shortcut help with question mark while typing/,
    ]);
    expectEvidence('src/phos/ui/a11y/ShortcutHelpDialog.test.tsx', [
      /keyboard shortcut help from copy rows/,
      /delegates close through the dialog primitive/,
    ]);
  });

  it('keeps Cmd/Ctrl+Enter wired to PH-OS form save and confirmation paths', () => {
    expectEvidence('src/phos/ui/workspace/NextActionPanel.tsx', [
      /isConfirmShortcut/,
      /event\.metaKey \|\| event\.ctrlKey/,
      /executePrimary/,
      /confirmSend/,
    ]);
    expectEvidence('src/phos/ui/report/ReportDeliveryQueue.tsx', [
      /isConfirmShortcut/,
      /registerReply\(delivery\)/,
      /markActionDone\(delivery\)/,
    ]);
    expectEvidence('src/phos/ui/workspace/HandoffPanel.tsx', [
      /isConfirmShortcut/,
      /submitCreate/,
      /submitReturn\(handoff\.handoff_id\)/,
    ]);
    expectEvidence('src/phos/ui/handoff/HandoffQueue.tsx', [
      /isConfirmShortcut/,
      /submitReturn\(handoff\.handoff_id\)/,
    ]);
    expectEvidence('src/phos/ui/visit/VisitMode.tsx', [
      /isConfirmShortcut/,
      /saveDraft/,
      /submitCancelReason/,
    ]);
    expectEvidence('src/phos/ui/workspace/NextActionPanel.test.tsx', [
      /Cmd\/Ctrl\+Enter/,
      /without skipping confirmation/,
    ]);
    expectEvidence('src/phos/ui/report/ReportDeliveryQueue.test.tsx', [
      /Cmd\/Ctrl\+Enter/,
      /only after required fields are filled/,
    ]);
    expectEvidence('src/phos/ui/workspace/HandoffPanel.test.tsx', [
      /Cmd\/Ctrl\+Enter/,
      /only after reason and note are filled/,
    ]);
    expectEvidence('src/phos/ui/handoff/HandoffQueue.test.tsx', [
      /Cmd\/Ctrl\+Enter/,
      /after the note is filled/,
    ]);
    expectEvidence('src/phos/ui/visit/VisitMode.test.tsx', [
      /Cmd\/Ctrl\+Enter/,
      /same draft gate/,
      /only when a reason is present/,
    ]);
  });

  it('keeps VisitMode photo evidence capture connected to the offline queue', () => {
    expectEvidence('src/phos/ui/visit/VisitMode.tsx', [
      /accept="image\/\*"/,
      /capture="environment"/,
      /offlineOpClass === 'BLOCKING'/,
      /onCaptureEvidence/,
    ]);
    expectEvidence('src/phos/ui/board/BoardClient.tsx', [
      /enqueueEvidence/,
      /sha256Hex/,
      /retryUploads\(\{ client: apiClient \}\)/,
      /setPendingEvidenceByPacket/,
    ]);
    expectEvidence('src/phos/ui/board/BoardClient.test.tsx', [
      /queues captured VisitMode photo evidence/,
      /file: requiredFile/,
      /必須未同期 1件/,
    ]);
    expectEvidence('src/phos/ui/visit/VisitMode.test.tsx', [
      /captures required and optional photo evidence/,
      /does not show photo capture outside the evidence upload step/,
    ]);
  });

  it('keeps the PH-OS Handoff Queue route wired to API Gateway state', () => {
    expectMissingFiles(['src/app/(phos)/handoffs/page.tsx']);
    expectEvidence('src/phos/ui/handoff/HandoffsPageClient.tsx', [
      /getHandoffs\(\{ status: HandoffStatus\.OPEN, assignee: 'ME' \}\)/,
      /getHandoffs\(\{ status: HandoffStatus\.IN_REVIEW, assignee: 'ME' \}\)/,
      /router\.push\(`\/board\?card=\$\{encodeURIComponent\(cardId\)\}`\)/,
      /openHandoff/,
      /resolveHandoff/,
      /returnHandoff/,
    ]);
    expectEvidence('src/phos/ui/handoff/HandoffsPageClient.test.tsx', [
      /loads OPEN and IN_REVIEW pharmacist handoffs/,
      /opens cards back on the PH-OS Board deep link/,
      /resolves IN_REVIEW handoffs/,
      /inline configuration errors/,
    ]);
  });

  it('keeps the PH-OS direct VisitMode route wired to packet API state', () => {
    expectMissingFiles(['src/app/(phos)/visit/[packetId]/page.tsx']);
    expectEvidence('src/phos/ui/visit/VisitModePageClient.tsx', [
      /getVisitMode\(packetId\)/,
      /updateVisitStep\(visit\.packet_id, step/,
      /retryUploads\(\{ client: apiClient \}\)/,
      /onCaptureEvidence=\{visit\.card_id \? handleCaptureEvidence : undefined\}/,
    ]);
    expectEvidence('src/phos/ui/visit/VisitModePageClient.test.tsx', [
      /loads VisitMode by packet id/,
      /updates arrival outcomes/,
      /queues photo evidence only when/,
      /hides photo capture/,
    ]);
  });

  it('keeps browser-level Board to Workspace accessibility flow covered in the final E2E spec', () => {
    expectEvidence('src/phos/infra/phos-final-e2e.test.tsx', [
      /E2E-11 preserves the browser UI flow/,
      /Board to Workspace, SourceDrawer, focus return, and Space primary action/,
      /fireEvent\.click\(sourceCard\)/,
      /getByRole\('dialog', \{ name: \/患者 山田太郎\/ \}\)/,
      /getByRole\('dialog', \{ name: '参照情報' \}\)/,
      /document\.activeElement/,
      /fireEvent\.keyDown\(sourceCard, \{ key: ' ' \}\)/,
      /executeCardAction/,
    ]);
  });
});
