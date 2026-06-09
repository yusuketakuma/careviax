'use client';

import { useMemo, useState } from 'react';
import {
  PhosCurrentStepLabel,
  PhosDisplayStatusLabel,
  PhosSourceDrawerCopy,
} from '@/phos/contracts/phos_copy.ja';
import {
  SourceRefKind,
  type ActionPhase,
  type CardDetailResponse,
  type EvidencePendingView,
  type ReportComposerView,
  type SourceRef,
  type TabKey,
  type VisitArrivalOutcome,
  type VisitStep,
} from '@/phos/contracts/phos_contracts';
import { ReportComposer } from '@/phos/ui/report/ReportComposer';
import { SourceRefList } from '@/phos/ui/source/SourceRefList';
import { VisitMode } from '@/phos/ui/visit/VisitMode';

export type WorkspaceTabsProps = {
  detail: CardDetailResponse;
  actionPhase?: ActionPhase;
  pendingEvidence?: EvidencePendingView[];
  onVisitArrivalOutcome?(outcome: VisitArrivalOutcome, reason?: string): void;
  onOpenVisitStep?(step: VisitStep): void;
  onSaveVisitDraft?(step: VisitStep): void;
  onCompleteVisit?(): void;
};

const TAB_LABELS = {
  OVERVIEW: '概要',
  PRESCRIPTION: '処方',
  SET: 'セット',
  VISIT_REPORT: '訪問・報告',
  CLAIM_HISTORY: '算定',
} as const satisfies Record<TabKey, string>;

const SOURCE_KIND_BY_TAB = {
  OVERVIEW: undefined,
  PRESCRIPTION: new Set<SourceRef['kind']>([
    SourceRefKind.PRESCRIPTION,
    SourceRefKind.MEDICATION_HISTORY,
  ]),
  SET: new Set<SourceRef['kind']>([
    SourceRefKind.PRESCRIPTION,
    SourceRefKind.PREVIOUS_VISIT,
    SourceRefKind.EVIDENCE_FILE,
  ]),
  VISIT_REPORT: new Set<SourceRef['kind']>([
    SourceRefKind.PREVIOUS_VISIT,
    SourceRefKind.CARE_PLAN,
    SourceRefKind.EVIDENCE_FILE,
  ]),
  CLAIM_HISTORY: new Set<SourceRef['kind']>([
    SourceRefKind.RULE_DOCUMENT,
    SourceRefKind.EVIDENCE_FILE,
  ]),
} as const satisfies Record<TabKey, ReadonlySet<SourceRef['kind']> | undefined>;

function selectSources(detail: CardDetailResponse, tab: TabKey): SourceRef[] {
  const sourceKinds = SOURCE_KIND_BY_TAB[tab];
  if (!sourceKinds) return detail.source_refs;
  return detail.source_refs.filter((source) => sourceKinds.has(source.kind));
}

function buildReportComposerView(detail: CardDetailResponse): ReportComposerView {
  return {
    card_id: detail.card.card_id,
    patient_name: detail.card.patient_name,
    delivery_targets: detail.support_brief?.delivery_targets ?? [],
    communication_recommendations: detail.pharmacist_brief?.communication_recommendations ?? [],
    template_sections: [],
    body: '',
    source_refs: detail.source_refs,
  };
}

export function WorkspaceTabs({
  detail,
  actionPhase,
  pendingEvidence = [],
  onVisitArrivalOutcome,
  onOpenVisitStep,
  onSaveVisitDraft,
  onCompleteVisit,
}: WorkspaceTabsProps) {
  const visibleTabs = detail.visible_tabs;
  const [activeTab, setActiveTab] = useState<TabKey | undefined>(visibleTabs[0]);
  const effectiveActiveTab =
    activeTab && visibleTabs.includes(activeTab) ? activeTab : visibleTabs[0];

  const activeSources = useMemo(
    () => (effectiveActiveTab ? selectSources(detail, effectiveActiveTab) : []),
    [effectiveActiveTab, detail],
  );

  if (!effectiveActiveTab) {
    return (
      <section className="rounded-lg border border-border/70 bg-card p-4">
        <p className="text-sm text-muted-foreground">表示可能なタブはありません。</p>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div role="tablist" aria-label="WorkspaceTabs" className="flex flex-wrap gap-2">
        {visibleTabs.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={effectiveActiveTab === tab}
            className="min-h-11 rounded-md border border-border/70 bg-background px-3 text-sm font-medium text-foreground transition hover:bg-muted/45 focus-visible:ring-3 focus-visible:ring-ring/50 aria-selected:border-primary aria-selected:bg-primary/10 aria-selected:text-primary"
            onClick={() => setActiveTab(tab)}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      {effectiveActiveTab === 'VISIT_REPORT' && detail.visit_mode ? (
        <VisitMode
          visit={detail.visit_mode}
          actionPhase={actionPhase}
          pendingEvidence={pendingEvidence}
          onArrivalOutcome={
            onVisitArrivalOutcome ??
            (() => {
              throw new Error('Visit arrival handler is not configured');
            })
          }
          onOpenStep={
            onOpenVisitStep ??
            (() => {
              throw new Error('Visit step handler is not configured');
            })
          }
          onSaveDraft={onSaveVisitDraft}
          onCompleteVisit={
            onCompleteVisit ??
            (() => {
              throw new Error('Visit complete handler is not configured');
            })
          }
        />
      ) : null}

      <div role="tabpanel" className="space-y-4 rounded-lg border border-border/70 bg-card p-4">
        <div>
          <h3 className="text-base font-semibold text-foreground">
            {TAB_LABELS[effectiveActiveTab]}
          </h3>
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">現在工程</dt>
              <dd className="font-medium">{PhosCurrentStepLabel[detail.card.current_step]}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">状態</dt>
              <dd className="font-medium">{PhosDisplayStatusLabel[detail.card.display_status]}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">カード</dt>
              <dd className="font-medium">{detail.card.card_id}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">バージョン</dt>
              <dd className="font-medium">{detail.server_version}</dd>
            </div>
          </dl>
        </div>

        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-foreground">
            {PhosSourceDrawerCopy.WORKSPACE_SECTION_HEADING}
          </h4>
          <SourceRefList sources={activeSources} />
        </div>

        {effectiveActiveTab === 'VISIT_REPORT' ? (
          <ReportComposer composer={buildReportComposerView(detail)} />
        ) : null}
      </div>
    </section>
  );
}
