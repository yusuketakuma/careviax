'use client';

import { useMemo, useState } from 'react';
import { CheckCircle2, FileText, Send, TriangleAlert } from 'lucide-react';
import {
  PhosCommunicationIntentLabel,
  PhosCommunicationTargetTypeLabel,
  PhosDeliveryMethodLabel,
  PhosReportComposerCopy,
  PhosReportComposerTemplateLabel,
} from '@/phos/contracts/phos_copy.ja';
import type {
  CommunicationRecommendation,
  DeliveryTargetView,
  ReportComposerSectionView,
  ReportComposerView,
} from '@/phos/contracts/phos_contracts';
import { SourceRefList } from '@/phos/ui/source/SourceRefList';

export type ReportComposerProps = {
  composer: ReportComposerView;
  onBodyChange?(body: string): void;
};

const TARGET_ORDER = [
  'DOCTOR',
  'CARE_MANAGER',
  'VISITING_NURSE',
  'FACILITY',
  'FAMILY',
] as const satisfies readonly CommunicationRecommendation['target_type'][];

function sortTargets(targets: DeliveryTargetView[]): DeliveryTargetView[] {
  return [...targets].sort(
    (left, right) =>
      TARGET_ORDER.indexOf(left.target_type) - TARGET_ORDER.indexOf(right.target_type),
  );
}

function targetTemplateSections(
  targetType: CommunicationRecommendation['target_type'],
): ReportComposerSectionView[] {
  return Object.entries(PhosReportComposerTemplateLabel[targetType]).map(([sectionKey, label]) => ({
    section_key: `${targetType}:${sectionKey}`,
    label,
    body: '',
  }));
}

function recommendationSections(
  recommendations: CommunicationRecommendation[],
  targetType: CommunicationRecommendation['target_type'],
): ReportComposerSectionView[] {
  return recommendations
    .filter((recommendation) => recommendation.target_type === targetType)
    .map((recommendation) => ({
      section_key: recommendation.draft_seed_key,
      label: `${PhosCommunicationIntentLabel[recommendation.intent]}`,
      body: recommendation.rationale,
    }));
}

function appendSectionBody(currentBody: string, section: ReportComposerSectionView): string {
  const nextSection = [section.label, section.body].filter(Boolean).join('\n');
  if (!currentBody.trim()) return nextSection;
  return `${currentBody.trimEnd()}\n\n${nextSection}`;
}

export function ReportComposer({ composer, onBodyChange }: ReportComposerProps) {
  const sortedTargets = useMemo(() => sortTargets(composer.delivery_targets), [composer]);
  const [activeTargetId, setActiveTargetId] = useState<string | undefined>(
    sortedTargets[0]?.target_id,
  );
  const [body, setBody] = useState(composer.body);
  const activeTarget =
    sortedTargets.find((target) => target.target_id === activeTargetId) ?? sortedTargets[0];
  const activeTargetType = activeTarget?.target_type ?? TARGET_ORDER[0];
  const sections = [
    ...recommendationSections(composer.communication_recommendations, activeTargetType),
    ...(composer.template_sections.length > 0
      ? composer.template_sections
      : targetTemplateSections(activeTargetType)),
  ];

  function updateBody(nextBody: string) {
    setBody(nextBody);
    onBodyChange?.(nextBody);
  }

  function appendTemplateSection(section: ReportComposerSectionView) {
    updateBody(appendSectionBody(body, section));
  }

  return (
    <section className="space-y-4 rounded-lg border border-border/70 bg-card p-4">
      <div className="flex flex-col gap-3 border-b border-border/70 pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
            <FileText className="size-4" aria-hidden="true" />
            {PhosReportComposerCopy.TITLE}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {composer.patient_name} / {composer.card_id}
          </p>
        </div>
        {activeTarget ? (
          <div className="rounded-md border border-border/70 bg-background px-3 py-2 text-sm">
            <span className="font-medium text-foreground">
              {PhosDeliveryMethodLabel[activeTarget.delivery_method]}
            </span>
            <span className="ml-2 text-muted-foreground">
              {activeTarget.ready
                ? PhosReportComposerCopy.TARGET_READY
                : PhosReportComposerCopy.TARGET_NOT_READY}
            </span>
          </div>
        ) : null}
      </div>

      {sortedTargets.length > 0 ? (
        <div
          role="tablist"
          aria-label={PhosReportComposerCopy.TARGET_TABS_LABEL}
          className="flex flex-wrap gap-2"
        >
          {sortedTargets.map((target) => (
            <button
              key={target.target_id}
              type="button"
              role="tab"
              aria-selected={activeTarget?.target_id === target.target_id}
              className="min-h-11 rounded-md border border-border/70 bg-background px-3 text-sm font-medium text-foreground transition hover:bg-muted/45 focus-visible:ring-3 focus-visible:ring-ring/50 aria-selected:border-primary aria-selected:bg-primary/10 aria-selected:text-primary"
              onClick={() => setActiveTargetId(target.target_id)}
            >
              {PhosCommunicationTargetTypeLabel[target.target_type]}
            </button>
          ))}
        </div>
      ) : (
        <p className="rounded-md border border-border/70 bg-background px-3 py-3 text-sm text-muted-foreground">
          {PhosReportComposerCopy.EMPTY_TARGETS}
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="phos-report-body" className="text-sm font-semibold text-foreground">
              {PhosReportComposerCopy.BODY_LABEL}
            </label>
            <textarea
              id="phos-report-body"
              className="min-h-44 w-full rounded-md border border-border/70 bg-background p-3 text-sm text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              value={body}
              onChange={(event) => updateBody(event.currentTarget.value)}
            />
          </div>

          <section className="space-y-2 rounded-md border border-border/70 bg-background p-3">
            <h4 className="text-sm font-semibold text-foreground">
              {PhosReportComposerCopy.TEMPLATE_SECTIONS}
            </h4>
            <div className="grid gap-2 sm:grid-cols-2">
              {sections.map((section) => (
                <button
                  key={section.section_key}
                  type="button"
                  data-enabled="true"
                  className="min-h-11 rounded-md border border-border/70 bg-card px-3 py-2 text-left text-sm font-medium text-foreground transition hover:bg-muted/45 focus-visible:ring-3 focus-visible:ring-ring/50"
                  onClick={() => appendTemplateSection(section)}
                >
                  {section.label}
                </button>
              ))}
            </div>
          </section>

          <section className="space-y-2 rounded-md border border-border/70 bg-background p-3">
            <h4 className="text-sm font-semibold text-foreground">
              {PhosReportComposerCopy.SOURCE_CHIPS}
            </h4>
            <SourceRefList
              sources={composer.source_refs}
              emptyText={PhosReportComposerCopy.EMPTY_SOURCES}
            />
          </section>
        </div>

        <aside className="space-y-3">
          <section className="rounded-md border border-border/70 bg-background p-3">
            <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Send className="size-4" aria-hidden="true" />
              {PhosReportComposerCopy.APPROVAL_PANEL}
            </h4>
            <p className="mt-2 text-sm text-muted-foreground">
              {PhosReportComposerCopy.APPROVAL_REQUIRED}
            </p>
          </section>

          <section className="rounded-md border border-border/70 bg-background p-3">
            <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              {activeTarget?.ready ? (
                <CheckCircle2 className="size-4" aria-hidden="true" />
              ) : (
                <TriangleAlert className="size-4" aria-hidden="true" />
              )}
              {PhosReportComposerCopy.MISSING_TARGET_PANEL}
            </h4>
            <dl className="mt-2 space-y-2 text-sm">
              <div>
                <dt className="text-muted-foreground">
                  {PhosReportComposerCopy.TARGET_TABS_LABEL}
                </dt>
                <dd className="font-medium text-foreground">
                  {activeTarget
                    ? `${PhosCommunicationTargetTypeLabel[activeTarget.target_type]} / ${activeTarget.label}`
                    : PhosReportComposerCopy.EMPTY_TARGETS}
                </dd>
              </div>
              {activeTarget ? (
                <div>
                  <dt className="text-muted-foreground">
                    {PhosReportComposerCopy.DELIVERY_METHOD}
                  </dt>
                  <dd className="font-medium text-foreground">
                    {PhosDeliveryMethodLabel[activeTarget.delivery_method]}
                  </dd>
                </div>
              ) : null}
            </dl>
          </section>

          <section className="rounded-md border border-border/70 bg-background p-3">
            <h4 className="text-sm font-semibold text-foreground">
              {PhosReportComposerCopy.DELIVERY_HISTORY}
            </h4>
            <p className="mt-2 text-sm text-muted-foreground">
              {PhosReportComposerCopy.NO_DELIVERY_HISTORY}
            </p>
          </section>
        </aside>
      </div>
    </section>
  );
}
