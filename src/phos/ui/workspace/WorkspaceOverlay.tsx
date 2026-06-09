'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PhosCurrentStepLabel, PhosDisplayStatusLabel } from '@/phos/contracts/phos_copy.ja';
import type { ActionPhase } from '@/phos/contracts/phos_contracts';
import type {
  ActionCode,
  ActionReasonInput,
  CardDetailResponse,
  EvidencePendingView,
} from '@/phos/contracts/phos_contracts';
import type { VisitArrivalOutcome, VisitStep } from '@/phos/contracts/phos_contracts';
import { BlockerPanel } from './BlockerPanel';
import type { HandoffCreateInput } from './HandoffPanel';
import { HandoffPanel } from './HandoffPanel';
import { NextActionPanel } from './NextActionPanel';
import { PharmacistBriefPanel } from './PharmacistBriefPanel';
import { SourceDrawerTrigger } from './SourceDrawerTrigger';
import { SupportBriefPanel } from './SupportBriefPanel';
import { WorkspaceTabs } from './WorkspaceTabs';

export type WorkspaceOverlayProps = {
  detail: CardDetailResponse | null;
  open: boolean;
  openedCards?: Array<{ card_id: string; label: string }>;
  activeCardId?: string;
  detailError?: string;
  actionPhase?: ActionPhase;
  actionMessage?: string;
  pendingEvidence?: EvidencePendingView[];
  onOpenChange(open: boolean): void;
  onSelectOpenedCard?(cardId: string): void;
  onExecute(cardId: string, action: ActionCode, reason?: ActionReasonInput): void;
  onCreateHandoff?(cardId: string, input: HandoffCreateInput): void;
  onOpenHandoffReview(handoffId: string): void;
  onResolveHandoff?(handoffId: string, resolvedActionCode: ActionCode): void;
  onReturnHandoff?(handoffId: string, reasonCode: string, note: string): void;
  onVisitArrivalOutcome?(outcome: VisitArrivalOutcome, reason?: string): void;
  onOpenVisitStep?(step: VisitStep): void;
  onSaveVisitDraft?(step: VisitStep): void;
  onCompleteVisit?(): void;
};

export function WorkspaceOverlay({
  detail,
  open,
  openedCards = [],
  activeCardId,
  detailError,
  actionPhase,
  actionMessage,
  pendingEvidence = [],
  onOpenChange,
  onSelectOpenedCard,
  onExecute,
  onCreateHandoff,
  onOpenHandoffReview,
  onResolveHandoff,
  onReturnHandoff,
  onVisitArrivalOutcome,
  onOpenVisitStep,
  onSaveVisitDraft,
  onCompleteVisit,
}: WorkspaceOverlayProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[min(92vh,920px)] max-w-[min(1120px,calc(100vw-1.5rem))] overflow-hidden p-0">
        {detail ? (
          <div className="grid h-full grid-rows-[auto_1fr]">
            <DialogHeader className="space-y-3 border-b border-border/70 px-5 py-4">
              <div className="pr-10">
                <DialogTitle className="text-xl">{detail.card.patient_name}</DialogTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  {detail.card.card_id} / {PhosDisplayStatusLabel[detail.card.display_status]} /{' '}
                  {PhosCurrentStepLabel[detail.card.current_step]}
                </p>
              </div>
              {openedCards.length > 1 ? (
                <div
                  role="group"
                  aria-label="OpenedCardTabs"
                  className="flex gap-2 overflow-x-auto pb-1"
                >
                  {openedCards.map((card) => (
                    <button
                      key={card.card_id}
                      type="button"
                      aria-pressed={card.card_id === activeCardId}
                      className="min-h-11 shrink-0 rounded-md border border-border/70 bg-background px-3 text-sm font-medium text-foreground transition hover:bg-muted/45 focus-visible:ring-3 focus-visible:ring-ring/50 aria-pressed:border-primary aria-pressed:bg-primary/10 aria-pressed:text-primary"
                      onClick={() => onSelectOpenedCard?.(card.card_id)}
                    >
                      {card.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </DialogHeader>

            <div className="grid min-h-0 gap-4 overflow-y-auto p-4 lg:grid-cols-[minmax(0,1fr)_320px]">
              <main>
                <WorkspaceTabs
                  detail={detail}
                  actionPhase={actionPhase}
                  pendingEvidence={pendingEvidence}
                  onVisitArrivalOutcome={onVisitArrivalOutcome}
                  onOpenVisitStep={onOpenVisitStep}
                  onSaveVisitDraft={onSaveVisitDraft}
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
                <PharmacistBriefPanel
                  cardId={detail.card.card_id}
                  brief={detail.pharmacist_brief}
                  actionPhase={actionPhase}
                  onExecute={onExecute}
                />
                <SupportBriefPanel brief={detail.support_brief} />
                <HandoffPanel
                  handoffs={detail.handoffs ?? []}
                  createSources={detail.source_refs}
                  createRequestedActions={[detail.next_action.code]}
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
