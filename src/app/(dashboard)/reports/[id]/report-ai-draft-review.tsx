'use client';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type {
  CareManagerReportContent,
  PhysicianReportContent,
  AudienceReportContent,
} from '@/types/care-report-content';

/** p1_04 の宛先別下書きコンテンツ（医師/ケアマネ/訪問看護/施設）。 */
export type AiDraftContent =
  | PhysicianReportContent
  | CareManagerReportContent
  | AudienceReportContent;

/**
 * p1_04「報告書の下書き」: AI 下書き(自動生成された報告内容)を
 * 5つの見出し(今日の要点/服薬状況/残薬/薬剤師の評価/お願いしたいこと)で
 * 見返し、宛先別プレビューを切り替えて「薬剤師確認済みにする」で確定する。
 */

export type AiDraftSection = {
  key: string;
  title: string;
  body: string;
};

const EMPTY_BODY = '未入力です。「編集」から追記できます。';

function joinNonEmpty(parts: Array<string | null | undefined>, separator = ' / '): string {
  const filled = parts.map((part) => part?.trim()).filter((part): part is string => !!part);
  return filled.join(separator);
}

/** content(医師向け/ケアマネ向け/訪問看護向け/施設向け)を p1_04 の5見出しへ射影する。 */
export function buildAiDraftSections(content: AiDraftContent | null): AiDraftSection[] {
  // 訪問看護向け・施設向け: 既に5見出しへ射影済みのコンテンツをそのまま採用する。
  const audience = content && 'report_audience' in content ? content : null;
  if (audience) {
    return [
      { key: 'summary', title: '今日の要点', body: audience.summary.trim() || EMPTY_BODY },
      { key: 'medication', title: '服薬状況', body: audience.medication.trim() || EMPTY_BODY },
      { key: 'residual', title: '残薬', body: audience.residual.trim() || EMPTY_BODY },
      { key: 'evaluation', title: '薬剤師の評価', body: audience.evaluation.trim() || EMPTY_BODY },
      { key: 'requests', title: 'お願いしたいこと', body: audience.requests.trim() || EMPTY_BODY },
    ];
  }

  const physician = content && 'medication_management' in content ? content : null;
  const careManager = content && 'medication_management_summary' in content ? content : null;

  const summary = physician?.assessment ?? careManager?.residual_status?.summary ?? '';
  const medication =
    physician?.medication_management?.compliance_summary ??
    careManager?.medication_management_summary?.compliance_summary ??
    '';
  const residual = physician
    ? joinNonEmpty(
        physician.residual_medications.map(
          (item) => `${item.drug_name} 残${item.remaining_qty}(超過${item.excess_days}日)`,
        ),
      )
    : joinNonEmpty([
        careManager?.residual_status?.summary,
        ...(careManager?.residual_status?.reduction_proposals ?? []),
      ]);
  const evaluation = physician?.plan ?? careManager?.care_service_coordination?.other_items ?? '';
  const requests = physician
    ? physician.physician_communication
    : joinNonEmpty([
        careManager?.care_service_coordination?.medication_assistance,
        ...(careManager?.next_visit_plan?.followup_items ?? []),
      ]);

  return [
    { key: 'summary', title: '今日の要点', body: summary.trim() || EMPTY_BODY },
    { key: 'medication', title: '服薬状況', body: medication.trim() || EMPTY_BODY },
    { key: 'residual', title: '残薬', body: residual.trim() || EMPTY_BODY },
    { key: 'evaluation', title: '薬剤師の評価', body: evaluation.trim() || EMPTY_BODY },
    { key: 'requests', title: 'お願いしたいこと', body: requests.trim() || EMPTY_BODY },
  ];
}

// key は CareReport.report_type(Prisma enum ReportType)に対応させ、
// 読み込んだ報告書の report_type と一致したタブをアクティブ表示する。
export const AI_DRAFT_AUDIENCES = [
  { key: 'physician_report', label: '医師向け' },
  { key: 'care_manager_report', label: 'ケアマネ向け' },
  { key: 'nurse_share', label: '訪問看護向け' },
  { key: 'facility_handoff', label: '施設向け' },
] as const;

type ReportAiDraftReviewProps = {
  content: AiDraftContent | null;
  reportType: string;
  confirmPending: boolean;
  onConfirm: () => void;
};

export function ReportAiDraftReview({
  content,
  reportType,
  confirmPending,
  onConfirm,
}: ReportAiDraftReviewProps) {
  const sections = buildAiDraftSections(content);

  return (
    <div
      data-testid="report-ai-draft-review"
      className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]"
    >
      <section
        aria-labelledby="ai-draft-heading"
        className="rounded-lg border border-border/70 bg-card p-4"
      >
        <h2 id="ai-draft-heading" className="text-base font-bold text-foreground">
          AI下書き(薬剤師が確認して確定)
        </h2>
        <div className="mt-3 space-y-3">
          {sections.map((section) => (
            <article
              key={section.key}
              data-testid="ai-draft-section"
              className="rounded-lg border border-border/70 bg-background px-4 py-3"
            >
              <h3 className="text-sm font-bold text-foreground">{section.title}</h3>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">{section.body}</p>
            </article>
          ))}
        </div>
      </section>

      <aside
        aria-label="宛先別プレビュー"
        className="h-fit rounded-lg border border-border/70 bg-card p-4"
      >
        <h2 className="text-base font-bold text-foreground">宛先別プレビュー</h2>
        <ul className="mt-3 space-y-2.5" role="list">
          {AI_DRAFT_AUDIENCES.map((audience) => {
            const active = audience.key === reportType;
            return (
              <li
                key={audience.key}
                data-testid="ai-draft-audience"
                data-active={active}
                className={cn(
                  'rounded-lg border px-4 py-3 text-sm font-medium',
                  active
                    ? 'border-primary/40 bg-primary/5 text-foreground'
                    : 'border-border bg-background text-foreground',
                )}
              >
                {audience.label}
                {active ? null : (
                  <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                    この宛先の下書きは未作成です
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        <Button
          type="button"
          className="mt-5 min-h-11 w-full bg-emerald-600 text-white hover:bg-emerald-700"
          disabled={confirmPending}
          onClick={onConfirm}
        >
          {confirmPending ? '確認中...' : '薬剤師確認済みにする'}
        </Button>
      </aside>
    </div>
  );
}
