'use client';

import Link from 'next/link';
import { useQuery, useQueries } from '@tanstack/react-query';
import { FileQuestion } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/loading';
import { buildOrgHeaders } from '@/lib/api/org-headers';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { buildPatientApiPath } from '@/lib/patient/api-paths';
import { buildPatientHref } from '@/lib/patient/navigation';
import { cn } from '@/lib/utils';
import type { PatientBoardResponse } from '@/types/patient-board';
import { fetchPatientBoard } from '../patients-board';
import type { PatientOverview } from '../[id]/patient-detail.types';
import {
  deriveCompareCardView,
  selectDefaultComparePatients,
  type CompareCardView,
} from './compare-card-helpers';

/**
 * design/images/P1 p1_02_multi_card_split_workspace: 複数カードを並べて確認。
 * 3 カラムのカードプレビュー(種別ラベル / 患者名 / 期間サブ + 今日の見どころ /
 * 止まっている理由 / 次にやること(薄青)+ 下部「このカードへ」)。
 * データは既存 BFF の再利用のみ: /api/patients/board(並べる対象の導出と状態文)+
 * /api/patients/[id]/overview(カード作業台と同じ workspace)を患者ごとに並列取得する。
 */

async function fetchPatientOverview(orgId: string, patientId: string): Promise<PatientOverview> {
  const res = await fetch(buildPatientApiPath(patientId, '/overview'), {
    headers: buildOrgHeaders(orgId),
  });
  if (!res.ok) throw new Error('患者情報の取得に失敗しました');
  return res.json();
}

/** 止まっている理由の重大度ドット(色だけに依存しないよう sr-only で重大/注意を併記)。 */
const SEVERITY_DOT_CLASSES: Record<'critical' | 'warning', string> = {
  critical: 'bg-state-blocked',
  warning: 'bg-state-confirm',
};

const SEVERITY_TEXT_LABELS: Record<'critical' | 'warning', string> = {
  critical: '重大',
  warning: '注意',
};

/** カード内の枠(今日の見どころ / 止まっている理由 / 次にやること)。 */
function PreviewBox({
  title,
  tone = 'default',
  children,
}: {
  title: string;
  tone?: 'default' | 'next';
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        'rounded-lg p-4',
        tone === 'next' ? 'bg-tag-info/10' : 'border border-border/70 bg-card',
      )}
      aria-label={title}
    >
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <div className="mt-2 space-y-1 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

function ComparePreviewCard({
  patientId,
  patientName,
  view,
}: {
  patientId: string;
  patientName: string;
  view: CompareCardView;
}) {
  return (
    <article
      data-testid="compare-card"
      className="flex min-h-[720px] flex-col rounded-xl border border-border/70 bg-card p-5 shadow-sm"
    >
      <p className="text-sm font-semibold text-foreground">{view.typeLabel}</p>
      <h2 className="mt-3 text-xl font-bold leading-snug text-foreground">{patientName} 様</h2>
      <p className="mt-1 text-sm text-muted-foreground">{view.periodSub}</p>

      <div className="mt-5 flex flex-1 flex-col gap-5">
        <PreviewBox title="今日の見どころ">
          {view.highlights.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </PreviewBox>

        <PreviewBox title="止まっている理由">
          {view.blockedReasons.length > 0 ? (
            view.blockedReasons.map((reason) => (
              <p key={reason.id} className="flex items-start gap-2">
                <span
                  aria-hidden="true"
                  className={cn(
                    'mt-1.5 inline-block size-2 shrink-0 rounded-full',
                    SEVERITY_DOT_CLASSES[reason.severity],
                  )}
                />
                <span className="sr-only">{SEVERITY_TEXT_LABELS[reason.severity]}: </span>
                <span className="min-w-0">{reason.label}</span>
              </p>
            ))
          ) : (
            <p>止まっている作業はありません。</p>
          )}
        </PreviewBox>

        <PreviewBox title="次にやること" tone="next">
          {view.nextAction ? (
            <>
              <p className="text-foreground">{view.nextAction.description}</p>
              <p>
                主操作: {view.nextAction.actionLabel}(
                <Link
                  href={view.nextAction.actionHref}
                  className="text-primary underline-offset-2 hover:underline"
                >
                  作業画面を開く
                </Link>
                )
              </p>
            </>
          ) : (
            <p>次にやることはありません。</p>
          )}
        </PreviewBox>
      </div>

      <div className="mt-6">
        <Link
          href={buildPatientHref(patientId)}
          className={buttonVariants({ className: 'min-w-40' })}
          data-testid="compare-card-open"
        >
          このカードへ
        </Link>
      </div>
    </article>
  );
}

function CompareCardSkeleton() {
  return (
    <div className="flex min-h-[720px] flex-col gap-4 rounded-xl border border-border/70 bg-card p-5 shadow-sm">
      <Skeleton className="h-4 w-28" />
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-4 w-52" />
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-28 w-full" />
      <Skeleton className="mt-auto h-10 w-40" />
    </div>
  );
}

export function CompareBoard({ requestedPatientIds }: { requestedPatientIds: string[] }) {
  const orgId = useOrgId();

  // 並べる対象の導出と状態文のため、患者カード一覧 BFF を再利用(全員スコープ)
  const boardQuery = useQuery<PatientBoardResponse>({
    queryKey: ['patients-board', 'all', orgId],
    queryFn: () => fetchPatientBoard(orgId, 'all'),
    enabled: Boolean(orgId),
  });

  // クエリ指定があればその患者、無ければ「注目すべきカード 3 枚」を一覧から導出
  const targetPatientIds =
    requestedPatientIds.length > 0
      ? requestedPatientIds
      : selectDefaultComparePatients(boardQuery.data?.cards ?? []);

  // 1 リクエスト/患者で並列取得(カード作業台と同じ overview BFF を再利用)
  const overviewQueries = useQueries({
    queries: targetPatientIds.map((patientId) => ({
      queryKey: ['patient-overview', patientId, orgId],
      queryFn: () => fetchPatientOverview(orgId, patientId),
      enabled: Boolean(orgId),
    })),
  });

  const heading = <h1 className="text-2xl font-bold text-foreground">複数カードを並べて確認</h1>;

  const waitingForDefaults = requestedPatientIds.length === 0 && !boardQuery.data;
  if (!orgId || waitingForDefaults) {
    if (requestedPatientIds.length === 0 && boardQuery.error) {
      return (
        <div className="space-y-6" data-testid="compare-board">
          {heading}
          <ErrorState
            variant="server"
            title="カード一覧を取得できません"
            description="並べる対象のカードを導出できませんでした。再読み込みしてください。"
          />
        </div>
      );
    }
    return (
      <div className="space-y-6" data-testid="compare-board">
        {heading}
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          <CompareCardSkeleton />
          <CompareCardSkeleton />
          <CompareCardSkeleton />
        </div>
      </div>
    );
  }

  if (targetPatientIds.length === 0) {
    return (
      <div className="space-y-6" data-testid="compare-board">
        {heading}
        <EmptyState
          icon={FileQuestion}
          title="並べられるカードがありません"
          description="進行中の患者カードがまだありません。患者一覧から対象を選んでください。"
        />
      </div>
    );
  }

  const boardCardByPatientId = new Map(
    (boardQuery.data?.cards ?? []).map((card) => [card.patient_id, card]),
  );

  return (
    <div className="space-y-6" data-testid="compare-board">
      {heading}
      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {targetPatientIds.map((patientId, index) => {
          const query = overviewQueries[index];
          if (!query || query.isLoading) {
            return <CompareCardSkeleton key={patientId} />;
          }
          const overview = query.data;
          if (query.error || !overview) {
            return (
              <div
                key={patientId}
                className="flex min-h-[720px] flex-col rounded-xl border border-border/70 bg-card p-5 shadow-sm"
                data-testid="compare-card-error"
              >
                <EmptyState
                  icon={FileQuestion}
                  title="カードを取得できません"
                  description="この患者の情報を取得できませんでした。"
                />
              </div>
            );
          }
          const view = deriveCompareCardView({
            boardCard: boardCardByPatientId.get(patientId) ?? null,
            workspace: overview.workspace,
          });
          return (
            <ComparePreviewCard
              key={patientId}
              patientId={patientId}
              patientName={overview.name}
              view={view}
            />
          );
        })}
      </div>
    </div>
  );
}
