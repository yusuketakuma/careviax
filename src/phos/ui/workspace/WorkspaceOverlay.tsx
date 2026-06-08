'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PhosCurrentStepLabel, PhosDisplayStatusLabel } from '@/phos/contracts/phos_copy.ja';
import type { ActionPhase } from '@/phos/contracts/phos_contracts';
import type {
  ActionCode,
  ActionReasonInput,
  CardDetailResponse,
} from '@/phos/contracts/phos_contracts';
import type { VisitArrivalOutcome, VisitStep } from '@/phos/contracts/phos_contracts';
import { BlockerPanel } from './BlockerPanel';
import type { HandoffCreateInput } from './HandoffPanel';
import { HandoffPanel } from './HandoffPanel';
import { NextActionPanel } from './NextActionPanel';
import { SourceDrawerTrigger } from './SourceDrawerTrigger';
import { WorkspaceTabs } from './WorkspaceTabs';

export type WorkspaceOverlayProps = {
  detail: CardDetailResponse | null;
  open: boolean;
  detailError?: string;
  actionPhase?: ActionPhase;
  actionMessage?: string;
  onOpenChange(open: boolean): void;
  onExecute(cardId: string, action: ActionCode, reason?: ActionReasonInput): void;
  onCreateHandoff?(cardId: string, input: HandoffCreateInput): void;
  onOpenHandoffReview(handoffId: string): void;
  onResolveHandoff?(handoffId: string, resolvedActionCode: ActionCode): void;
  onReturnHandoff?(handoffId: string, reasonCode: string, note: string): void;
  onVisitArrivalOutcome?(outcome: VisitArrivalOutcome, reason?: string): void;
  onOpenVisitStep?(step: VisitStep): void;
  onCompleteVisit?(): void;
};

export function WorkspaceOverlay({
  detail,
  open,
  detailError,
  actionPhase,
  actionMessage,
  onOpenChange,
  onExecute,
  onCreateHandoff,
  onOpenHandoffReview,
  onResolveHandoff,
  onReturnHandoff,
  onVisitArrivalOutcome,
  onOpenVisitStep,
  onCompleteVisit,
}: WorkspaceOverlayProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[min(92vh,920px)] max-w-[min(1120px,calc(100vw-1.5rem))] overflow-hidden p-0">
        {detail ? (
          <div className="grid h-full grid-rows-[auto_1fr]">
            <DialogHeader className="border-b border-border/70 px-5 py-4">
              <div className="pr-10">
                <DialogTitle className="text-xl">{detail.card.patient_name}</DialogTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  {detail.card.card_id} / {PhosDisplayStatusLabel[detail.card.display_status]} /{' '}
                  {PhosCurrentStepLabel[detail.card.current_step]}
                </p>
              </div>
            </DialogHeader>

            <div className="grid min-h-0 gap-4 overflow-y-auto p-4 lg:grid-cols-[minmax(0,1fr)_320px]">
              <main>
                <WorkspaceTabs
                  detail={detail}
                  actionPhase={actionPhase}
                  onVisitArrivalOutcome={onVisitArrivalOutcome}
                  onOpenVisitStep={onOpenVisitStep}
                  onCompleteVisit={onCompleteVisit}
                />
              </main>

              <div className="space-y-4">
                <NextActionPanel
                  key={`${detail.card.card_id}:${detail.next_action.code}`}
                  cardId={detail.card.card_id}
                  nextAction={detail.next_action}
                  blockers={detail.blockers}
                  actionPhase={actionPhase}
                  actionMessage={actionMessage}
                  onExecute={onExecute}
                />
                <BlockerPanel blockers={detail.blockers} />
                <HandoffPanel
                  handoffs={detail.handoffs ?? []}
                  createSources={detail.source_refs}
                  onCreate={
                    onCreateHandoff
                      ? (input) => onCreateHandoff(detail.card.card_id, input)
                      : undefined
                  }
                  onOpenReview={onOpenHandoffReview}
                  onResolve={
                    onResolveHandoff ??
                    (() => {
                      throw new Error('Handoff resolve handler is not configured');
                    })
                  }
                  onReturn={
                    onReturnHandoff ??
                    (() => {
                      throw new Error('Handoff return handler is not configured');
                    })
                  }
                />
                <SourceDrawerTrigger sources={detail.source_refs} />
              </div>
            </div>
          </div>
        ) : (
          <div className="p-6 text-sm text-muted-foreground">
            {detailError ?? 'カード詳細を読み込み中'}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
