'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { format, formatDistanceToNowStrict, isSameDay, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { FileQuestion } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Loading } from '@/components/ui/loading';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  SafetyBoard,
  getHandlingTagBadgeClass,
  getHandlingTagLabel,
} from '@/components/features/workspace/safety-board';
import { ProcessChips } from '@/components/features/workspace/process-chips';
import { ListOpenCard } from '@/components/features/workspace/list-open-card';
import {
  WorkspaceActionRail,
  type BlockedReason,
  type EvidenceItem,
} from '@/components/features/workspace/action-rail';
import {
  PROCESS_STEPS_9,
  getCycleWorkspaceAction,
  getProcessStepIndex,
  getProcessStepKeyForStatus,
} from '@/lib/prescription/cycle-workspace';
import { formatPrescriptionCardNumber } from '@/lib/prescription/rx-number';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { cn } from '@/lib/utils';
import type {
  PatientOverview,
  PatientWorkspaceActivity,
  PatientWorkspaceTodayTask,
} from './patient-detail.types';
import type { VisitBriefUnresolvedItem } from '@/types/visit-brief';

/**
 * design/images/new 06_card: カード = 1 処方サイクル(1 RX 番号)の作業台。
 * タブなしの単一スクロール構成: ヘッダー → セーフティボード → 今回の処方(工程チップ+薬剤テーブル)
 * → 直近の動き、右レール(xl〜)に「このカードに紐づく今日」+ 3 点セット(次にやること/止まっている理由/根拠・記録)。
 * 旧タブ構成(患者プロフィール)へは右上「→ 患者プロフィール」(?view=profile)から到達する。
 */

/** 直近の動き: 種別 → 行頭バッジ表示 */
const ACTIVITY_TYPE_LABELS: Record<PatientWorkspaceActivity['type'], string> = {
  transition: '工程',
  inquiry: '照会',
  intake: '取込',
};

const ACTIVITY_BADGE_CLASSES: Record<PatientWorkspaceActivity['type'], string> = {
  transition: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  inquiry: 'border-blue-200 bg-blue-50 text-blue-700',
  intake: 'border-border bg-muted text-muted-foreground',
};

/** このカードに紐づく今日: トーン → 時刻ピル配色(期限=赤/順序待ち=灰/時刻確定=緑) */
const TODAY_TONE_CLASSES: Record<PatientWorkspaceTodayTask['tone'], string> = {
  deadline: 'border-red-300 bg-red-50 text-red-700',
  waiting: 'border-border bg-muted text-muted-foreground',
  scheduled: 'border-emerald-300 bg-emerald-50 text-emerald-700',
};

/** 止まっている理由: WorkflowException type → カテゴリ色チップ(患者/事務/医療機関) */
const EXCEPTION_CATEGORY_LABELS: Record<string, string> = {
  no_show: '患者',
  hospitalized: '患者',
  refused_receipt: '患者',
  discontinued_collection_unconfirmed: '患者',
  family_consent_pending: '患者',
  awaiting_reply: '医療機関',
  prescription_structuring_block: '事務',
  outpatient_injection_eligibility_block: '事務',
  delivery_target_confirmation: '事務',
  report_failed: '事務',
};

/** 止まっている理由: type 別の個別アクション(06_card 右レール「再連絡する→」等) */
const EXCEPTION_ACTIONS: Record<string, { label: string; href: string }> = {
  family_consent_pending: { label: '再連絡する', href: '/communications/requests' },
  delivery_target_confirmation: { label: '状況を見る', href: '/admin/contact-profiles' },
};

const UNRESOLVED_CATEGORY_LABELS: Record<VisitBriefUnresolvedItem['source_type'], string> = {
  task: '事務',
  issue: '患者',
  inquiry: '医療機関',
  billing: '事務',
};

/** 当日は HH:mm、それ以外は M/d 表示(06_card 直近の動きの時刻表記) */
function formatActivityTime(value: string): string {
  const date = parseISO(value);
  if (Number.isNaN(date.getTime())) return value;
  return isSameDay(date, new Date()) ? format(date, 'HH:mm') : format(date, 'M/d', { locale: ja });
}

/** 経過時間ラベル(「1日」「30分」)。解釈できない値は undefined。 */
function formatAgeLabel(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const date = parseISO(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return formatDistanceToNowStrict(date, { locale: ja });
}

function formatQuantityLabel(line: {
  quantity: number | null;
  unit: string | null;
  days: number;
}): string {
  if (line.quantity != null) {
    return `${line.quantity}${line.unit ?? ''}`;
  }
  return `${line.days}日分`;
}

function SectionCard({ children, className, ...props }: React.ComponentProps<'section'>) {
  return (
    <section className={cn('rounded-lg border border-border/70 bg-card p-4', className)} {...props}>
      {children}
    </section>
  );
}

function CardTodayPanel({ tasks }: { tasks: PatientWorkspaceTodayTask[] }) {
  return (
    <SectionCard aria-label="このカードに紐づく今日" data-testid="card-today-panel">
      <h3 className="text-sm font-semibold text-foreground">このカードに紐づく今日</h3>
      {tasks.length > 0 ? (
        <ul className="mt-3 divide-y divide-border/60" role="list">
          {tasks.map((task) => (
            <li key={task.id} className="flex items-center gap-2 py-2.5 first:pt-0 last:pb-0">
              <span
                className={cn(
                  'inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium',
                  TODAY_TONE_CLASSES[task.tone],
                )}
              >
                {task.time_label}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                {task.label}
              </span>
              <Link
                href={task.href}
                className={buttonVariants({
                  variant: 'outline',
                  size: 'sm',
                  className: 'shrink-0',
                })}
              >
                → {task.action_label}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">今日このカードでやることはありません。</p>
      )}
    </SectionCard>
  );
}

export function CardWorkspace({ patientId }: { patientId: string }) {
  const orgId = useOrgId();
  const router = useRouter();

  const {
    data: patient,
    isLoading,
    error,
  } = useQuery<PatientOverview>({
    queryKey: ['patient-overview', patientId, orgId],
    queryFn: async () => {
      const res = await fetch(`/api/patients/${patientId}/overview`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('患者情報の取得に失敗しました');
      return res.json();
    },
    enabled: Boolean(orgId),
  });

  if (!orgId || isLoading) return <Loading />;
  if (error || !patient) {
    return (
      <EmptyState
        icon={FileQuestion}
        title="患者が見つかりません"
        description="指定された患者情報を取得できませんでした"
      />
    );
  }

  const workspace = patient.workspace;
  const profileHref = `/patients/${patientId}?view=profile`;
  const rxNumber = workspace?.current_intake
    ? formatPrescriptionCardNumber(
        workspace.current_intake.id,
        workspace.current_intake.prescribed_date.slice(0, 10),
        'rx_year',
      )
    : null;

  const headerRow = (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-xl font-bold leading-snug text-foreground">
            カード — {patient.name} 様
          </h2>
          <p className="text-sm text-muted-foreground">
            {rxNumber ? `${rxNumber} / ` : ''}1枚で患者のいまが全部わかる作業台
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link
          href={profileHref}
          className={buttonVariants({ variant: 'outline' })}
          data-testid="card-open-profile"
        >
          → 患者プロフィール
        </Link>
        <Link
          href={`/patients/compare?patients=${patientId}`}
          className={buttonVariants({ variant: 'outline' })}
          data-testid="card-open-compare"
        >
          カードを分割表示
        </Link>
      </div>
    </div>
  );

  if (!workspace) {
    return (
      <div className="space-y-6" data-testid="card-workspace">
        {headerRow}
        <EmptyState
          icon={FileQuestion}
          title="進行中のカードがありません"
          description="処方を受け付けると、この患者の処方サイクル(取込〜算定)の作業台がここに表示されます。"
        />
      </div>
    );
  }

  const currentStep = getProcessStepKeyForStatus(workspace.overall_status);
  const currentStepLabel =
    currentStep != null ? (PROCESS_STEPS_9[getProcessStepIndex(currentStep)]?.label ?? null) : null;
  const cycleAction = getCycleWorkspaceAction(workspace.overall_status);
  const processLabel = currentStepLabel
    ? `工程: ${currentStepLabel}(いまここ)`
    : cycleAction
      ? `工程: ${cycleAction.statusLabel}`
      : null;

  // 次にやること(主操作はこの 1 つだけ青)。期限つきタスクがあればラベルに内包する。
  const deadlineTask = workspace.today_tasks.find((task) => task.due_time != null) ?? null;
  const nextAction = cycleAction
    ? {
        description: cycleAction.description,
        actionLabel: deadlineTask?.due_time
          ? `${cycleAction.actionLabel} — ${deadlineTask.due_time}期限`
          : cycleAction.actionLabel,
        actionHref: cycleAction.actionHref,
      }
    : undefined;

  const unresolved = patient.visit_brief?.unresolved_items ?? [];
  const blockedReasons: BlockedReason[] = [
    ...workspace.open_exceptions.map((exception) => {
      const action = EXCEPTION_ACTIONS[exception.exception_type];
      return {
        id: exception.id,
        label: exception.description,
        severity: exception.severity,
        categoryLabel: EXCEPTION_CATEGORY_LABELS[exception.exception_type] ?? '事務',
        ageLabel: formatAgeLabel(exception.created_at),
        actionLabel: `${action?.label ?? '状況を見る'} →`,
        actionHref: action?.href ?? '/workflow',
      };
    }),
    ...unresolved.map((item, index) => ({
      id: `${item.source_type}-${index}`,
      label: item.title,
      severity: (item.severity === 'urgent' || item.severity === 'high'
        ? 'critical'
        : 'warning') as BlockedReason['severity'],
      categoryLabel: UNRESOLVED_CATEGORY_LABELS[item.source_type],
      actionLabel: '状況を見る →',
      actionHref: item.href,
    })),
  ];

  const latestInquiryActivity =
    workspace.recent_activities.find((activity) => activity.type === 'inquiry') ?? null;
  const hasEgfr = patient.lab_summary.some((lab) => lab.analyte_code === 'egfr');
  const intakeDateLabel = workspace.current_intake
    ? formatActivityTime(workspace.current_intake.prescribed_date)
    : undefined;
  const evidence: EvidenceItem[] = [
    ...(workspace.prescription_document_url
      ? [
          {
            id: 'prescription-image',
            label: '処方せん画像',
            meta: intakeDateLabel,
            href: workspace.prescription_document_url,
          },
        ]
      : []),
    {
      id: 'medication-notebook',
      label: 'お薬手帳(最新)',
      href: `/patients/${patientId}?view=profile&tab=medications`,
    },
    ...(latestInquiryActivity
      ? [
          {
            id: 'inquiry-response',
            label: '照会回答',
            meta: formatActivityTime(latestInquiryActivity.at),
            href: latestInquiryActivity.href,
          },
        ]
      : []),
    {
      id: 'lab-trend',
      label: '検査値の推移',
      meta: hasEgfr ? 'eGFR' : undefined,
      href: `/patients/${patientId}?view=profile&tab=basic`,
    },
  ];

  return (
    <div className="space-y-4" data-testid="card-workspace">
      {headerRow}

      {/* デザイン 06: 2xl〜は [本文 | このカードに紐づく今日 | 3点セット] の 3 カラム。
          xl 帯で 3 カラムにすると中央が潰れるため、xl は右カラム縦積みの 2 カラムに留める */}
      <div className="space-y-4 xl:grid xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start xl:gap-6 xl:space-y-0 2xl:grid-cols-[minmax(0,1fr)_300px_320px]">
        <div className="min-w-0 space-y-4">
          {/* セーフティボード: どの工程でも常時表示。危険タグは絶対に隠さない */}
          <SafetyBoard
            allergy={workspace.safety.allergy ?? undefined}
            renal={workspace.safety.renal ?? undefined}
            handlingTags={workspace.safety.handling_tags}
            swallowing={workspace.safety.swallowing ?? undefined}
            cautions={workspace.safety.cautions}
          />

          {/* 今回の処方: 工程チップ(9 工程)+ 薬剤テーブル(薬剤/用法/数量/安全) */}
          <SectionCard aria-label="今回の処方" data-testid="card-prescription-section">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h3 className="text-base font-semibold text-foreground">
                  今回の処方{rxNumber ? ` — ${rxNumber}` : ''}
                </h3>
                {processLabel ? (
                  <span className="text-xs text-muted-foreground">{processLabel}</span>
                ) : null}
              </div>
              {cycleAction && currentStepLabel ? (
                <Link
                  href={cycleAction.actionHref}
                  className={buttonVariants({ variant: 'outline', size: 'sm' })}
                >
                  → {currentStepLabel}へ
                </Link>
              ) : null}
            </div>
            {currentStep ? <ProcessChips currentStep={currentStep} className="mt-3" /> : null}
            {workspace.prescription_lines.length > 0 ? (
              <Table className="mt-3">
                <TableHeader>
                  <TableRow>
                    <TableHead>薬剤</TableHead>
                    <TableHead>用法</TableHead>
                    <TableHead className="w-24">数量</TableHead>
                    <TableHead className="w-32">安全</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {workspace.prescription_lines.map((line) => {
                    const isNarcotic = line.packaging_instruction_tags.includes('narcotic');
                    const isCold = line.packaging_instruction_tags.includes('cold_storage');
                    return (
                      <TableRow
                        key={line.id}
                        className={cn(
                          isNarcotic && 'bg-red-50/60 hover:bg-red-50',
                          !isNarcotic && isCold && 'bg-amber-50/60 hover:bg-amber-50',
                        )}
                      >
                        <TableCell className="font-medium text-foreground">
                          {line.drug_name}
                        </TableCell>
                        <TableCell>
                          {line.frequency} {line.dose}
                        </TableCell>
                        <TableCell>{formatQuantityLabel(line)}</TableCell>
                        <TableCell>
                          {line.packaging_instruction_tags.length > 0 ? (
                            <span className="flex flex-wrap gap-1">
                              {line.packaging_instruction_tags.map((tag) => (
                                <span
                                  key={tag}
                                  className={cn(
                                    'inline-flex items-center rounded-full border px-2 py-0.5 text-xs',
                                    getHandlingTagBadgeClass(tag),
                                  )}
                                >
                                  {getHandlingTagLabel(tag)}
                                </span>
                              ))}
                            </span>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                処方明細はまだ取り込まれていません。
              </p>
            )}
          </SectionCard>

          {/* 直近の動き: 工程遷移・疑義照会・処方取込の時系列 */}
          <SectionCard aria-label="直近の動き" data-testid="card-recent-activities">
            <h3 className="text-base font-semibold text-foreground">直近の動き</h3>
            {workspace.recent_activities.length > 0 ? (
              <div className="mt-3 space-y-2">
                {workspace.recent_activities.map((activity) => (
                  <ListOpenCard
                    key={activity.id}
                    badgeLabel={ACTIVITY_TYPE_LABELS[activity.type]}
                    badgeClassName={ACTIVITY_BADGE_CLASSES[activity.type]}
                    title={
                      activity.actor ? `${activity.label} — ${activity.actor}` : activity.label
                    }
                    subtitle={formatActivityTime(activity.at)}
                    openLabel="開く"
                    onOpen={() => router.push(activity.href)}
                  />
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">直近の動きはまだありません。</p>
            )}
          </SectionCard>
        </div>

        {/* 右側(xl: 縦積みの 1 カラム / 2xl: contents 化して「紐づく今日」が中央・3点セットが右の独立カラム) */}
        <aside
          className="space-y-4 xl:sticky xl:top-6 2xl:contents"
          aria-label="このカードに紐づく今日・次にやること・止まっている理由・根拠"
        >
          <div className="2xl:sticky 2xl:top-6">
            <CardTodayPanel tasks={workspace.today_tasks} />
          </div>
          <div className="space-y-4 2xl:sticky 2xl:top-6">
            <WorkspaceActionRail
              nextAction={nextAction}
              blockedReasons={blockedReasons}
              blockedReasonsEmptyLabel="止まっている作業はありません"
              evidence={evidence}
              evidenceOpenLabel="開く"
            />
          </div>
        </aside>
      </div>
    </div>
  );
}
