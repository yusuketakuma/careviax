'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheck } from 'lucide-react';
import { toast } from 'sonner';
import { messageFromError } from '@/lib/utils/error-message';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ErrorState } from '@/components/ui/error-state';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/loading';
import { Textarea } from '@/components/ui/textarea';
import { WorkflowBackLink } from '@/components/features/workflow/workflow-back-link';
import { PatientHeader } from '@/components/features/patients/patient-header';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { encodePathSegment } from '@/lib/http/path-segment';
import { buildPatientApiPath } from '@/lib/patient/api-paths';
import { buildPatientHref } from '@/lib/patient/navigation';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { getPatientCareQueryKeys, invalidateQueryKeys } from '@/lib/visits/query-invalidations';
import { cn } from '@/lib/utils';
import {
  buildSafetyConcerns,
  deriveSafetySteps,
  type ConcernCategory,
  type SafetyCdsAlert,
  type SafetyConcern,
  type SafetyIssueRecord,
} from './safety-check.shared';

/**
 * p0_32 薬の安全チェック(docs/design-gap-analysis.md)。
 * 2 カラム構成: 左「気になる点」(カテゴリ別カード・critical は赤見出し)→
 * 中央「確認の流れ」(4 ステップ・済は薄緑)。補助操作は右ドロワーの「次にやること」
 * (主操作「医師への確認を記録」+ 副操作「問題なしにする」)。
 * データ源は /api/medication-issues(主)+ /api/cds/check(現行サイクルがあるときの補強)。
 */

type MedicationIssueResponse = {
  data: Array<
    SafetyIssueRecord & {
      patient_id: string;
      case_id: string | null;
    }
  >;
};

type PatientSummaryResponse = {
  name: string;
  name_kana?: string | null;
  birth_date?: string | null;
  // root /api/patients/[id] は workspace.safety を返す(card-workspace と同一形状)。
  // 安全チェック中もアレルギー/ハイリスクを常時可視化するために再掲する。
  workspace?: {
    safety?: {
      allergy?: string | null;
      renal?: string | null;
      swallowing?: string | null;
      handling_tags?: string[] | null;
      cautions?: string[] | null;
    } | null;
  } | null;
};

async function fetchPatientCdsAlerts(orgId: string, patientId: string): Promise<SafetyCdsAlert[]> {
  // CDS チェックはサイクル単位のため、患者の最新サイクルを引いてから実行する。
  // 「正当な空」(サイクル無し・権限による空=閲覧は canDispense のため 4xx)は補強なしの [] で扱う。
  // ただしサーバエラー(5xx)は握り潰さず throw し、cdsQuery.isError に乗せて degraded を明示する。
  // 相互作用/アレルギーの false-negative は最重被害のため、失敗を「問題なし」に偽装しない(fail-close)。
  const cyclesRes = await fetch(
    `/api/medication-cycles?${new URLSearchParams({ patient_id: patientId, limit: '1' })}`,
    { headers: buildOrgHeaders(orgId) },
  );
  if (!cyclesRes.ok) {
    if (cyclesRes.status >= 500) {
      throw new Error('相互作用チェックの前提となる服薬サイクルを取得できませんでした');
    }
    return [];
  }
  const cyclesJson = (await cyclesRes.json()) as { data?: Array<{ id: string }> };
  const cycleId = cyclesJson.data?.[0]?.id;
  if (!cycleId) return [];

  const checkRes = await fetch('/api/cds/check', {
    method: 'POST',
    headers: buildOrgJsonHeaders(orgId),
    body: JSON.stringify({ cycleId, patientId }),
  });
  if (!checkRes.ok) {
    if (checkRes.status >= 500) {
      throw new Error('相互作用チェックを実行できませんでした');
    }
    return [];
  }
  const checkJson = (await checkRes.json()) as { alerts?: SafetyCdsAlert[] };
  return checkJson.alerts ?? [];
}

// ---------------------------------------------------------------------------
// 左カラム: 気になる点
// ---------------------------------------------------------------------------

function ConcernCard({
  concern,
  selected,
  onSelect,
}: {
  concern: SafetyConcern;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        data-testid={`safety-concern-${concern.category}`}
        className={cn(
          'min-h-[44px] w-full rounded-lg border bg-card p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
          selected
            ? 'border-primary/60 ring-1 ring-primary/30'
            : 'border-border/70 hover:border-primary/40',
        )}
      >
        <p
          className={cn(
            'text-[15px] font-bold leading-6',
            concern.critical ? 'text-destructive' : 'text-foreground',
          )}
        >
          {concern.label}
        </p>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          {concern.subLabel}
          {concern.itemCount > 1 ? ` ほか${concern.itemCount - 1}件` : ''}
        </p>
      </button>
    </li>
  );
}

// ---------------------------------------------------------------------------
// 中央カラム: 確認の流れ
// ---------------------------------------------------------------------------

function SafetyStepList({ issues }: { issues: SafetyIssueRecord[] }) {
  const steps = deriveSafetySteps(issues);

  return (
    <ol className="space-y-4">
      {steps.map((step) => (
        <li
          key={step.id}
          data-testid={`safety-step-${step.stepNumber}`}
          className={cn(
            'flex items-center justify-between gap-2 rounded-lg border px-4 py-5',
            step.done ? 'border-state-done/30 bg-state-done/10' : 'border-border/70 bg-card',
          )}
        >
          <p className="text-[15px] font-semibold leading-6 text-foreground">
            {step.stepNumber}. {step.label}
          </p>
          {step.done ? (
            <span className="flex shrink-0 items-center gap-1 text-state-done">
              <CircleCheck className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">済</span>
            </span>
          ) : (
            <span className="sr-only">未実施</span>
          )}
        </li>
      ))}
    </ol>
  );
}

function SafetyPrimaryAction({
  concern,
  issue,
  consultationPending,
  resolvePending,
  onConsult,
  onResolve,
}: {
  concern: SafetyConcern | null;
  issue: SafetyIssueRecord | null;
  consultationPending: boolean;
  resolvePending: boolean;
  onConsult: () => void;
  onResolve: () => void;
}) {
  return (
    <section
      aria-label="選択中の安全確認"
      className="rounded-lg border border-primary/20 bg-primary/5 p-4"
      data-testid="safety-primary-action"
    >
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-primary">次にやること</p>
          <p className="mt-1 text-base font-bold leading-6 text-foreground">
            {concern ? concern.label : '気になる点を選択'}
          </p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {concern
              ? `${concern.subLabel}を、処方医への確認から記録完了まで進めます。`
              : '気になる点を選ぶと、この場で確認記録へ進めます。'}
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:min-w-80">
          <Button
            type="button"
            className="!h-auto !min-h-11 px-4 py-2"
            onClick={onConsult}
            disabled={!concern || consultationPending}
          >
            医師への確認を記録
          </Button>
          <Button
            type="button"
            variant="outline"
            className="!h-auto !min-h-11 px-4 py-2 text-primary hover:text-primary"
            onClick={onResolve}
            disabled={!issue || resolvePending}
          >
            問題なしにする
          </Button>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 医師への確認を記録ダイアログ
// ---------------------------------------------------------------------------

function ConsultationDialog({
  open,
  onOpenChange,
  concern,
  pending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  concern: SafetyConcern | null;
  pending: boolean;
  onSubmit: (content: string) => void;
}) {
  const [content, setContent] = useState('');

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) setContent('');
    onOpenChange(nextOpen);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>医師への確認を記録</DialogTitle>
          <DialogDescription className="sr-only">
            処方医へ確認した内容を介入記録として保存します。
          </DialogDescription>
        </DialogHeader>

        {concern ? (
          <p className="text-sm leading-6 text-muted-foreground">
            対象: {concern.label}({concern.subLabel})
          </p>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor="safety-consultation-content">確認内容</Label>
          <Textarea
            id="safety-consultation-content"
            rows={4}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder="例: 処方医へ電話。NSAIDs の継続可否を確認し、回答待ち。"
          />
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
            キャンセル
          </Button>
          <Button
            type="button"
            onClick={() => onSubmit(content.trim())}
            disabled={pending || content.trim().length === 0}
          >
            記録する
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// 画面全体
// ---------------------------------------------------------------------------

function SafetyCheckSkeleton() {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,17fr)_minmax(0,22fr)]">
      {[0, 1].map((column) => (
        <div key={column} className="space-y-3 rounded-lg border border-border/70 bg-card p-4">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ))}
    </div>
  );
}

export function SafetyCheckContent({ patientId }: { patientId: string }) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [selectedCategory, setSelectedCategory] = useState<ConcernCategory | null>(null);
  const [consultDialogOpen, setConsultDialogOpen] = useState(false);
  const [resolveDialogOpen, setResolveDialogOpen] = useState(false);

  const issuesQuery = useQuery({
    queryKey: ['medication-issues', orgId, patientId],
    queryFn: async () => {
      const response = await fetch(
        `/api/medication-issues?${new URLSearchParams({ patient_id: patientId })}`,
        { headers: buildOrgHeaders(orgId) },
      );
      if (!response.ok) throw new Error('服薬課題の取得に失敗しました');
      return response.json() as Promise<MedicationIssueResponse>;
    },
    enabled: !!orgId,
  });

  const patientQuery = useQuery({
    queryKey: ['patient-safety-check-summary', patientId, orgId],
    queryFn: async () => {
      const response = await fetch(buildPatientApiPath(patientId), {
        headers: buildOrgHeaders(orgId),
      });
      if (!response.ok) throw new Error('患者情報の取得に失敗しました');
      return response.json() as Promise<PatientSummaryResponse>;
    },
    enabled: !!orgId,
  });

  const cdsQuery = useQuery({
    queryKey: ['safety-check-cds', patientId, orgId],
    queryFn: () => fetchPatientCdsAlerts(orgId, patientId),
    enabled: !!orgId,
  });

  const issues = useMemo(() => issuesQuery.data?.data ?? [], [issuesQuery.data?.data]);
  const alerts = useMemo(() => cdsQuery.data ?? [], [cdsQuery.data]);
  const concerns = useMemo(() => buildSafetyConcerns(issues, alerts), [issues, alerts]);

  // 既定は先頭(最重要)カテゴリを選択。解決済みで消えたカテゴリは先頭へ戻す。
  const selectedConcern =
    concerns.find((concern) => concern.category === selectedCategory) ?? concerns[0] ?? null;
  const selectedIssue = selectedConcern?.issueId
    ? (issues.find((issue) => issue.id === selectedConcern.issueId) ?? null)
    : null;

  async function invalidatePatientIssueQueries() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['medication-issues', orgId, patientId] }),
      invalidateQueryKeys(queryClient, getPatientCareQueryKeys({ orgId, patientId })),
    ]);
  }

  const consultationMutation = useMutation({
    mutationFn: async (content: string) => {
      // open 課題のフォローアップ PATCH パスを fetch 前に検証する。
      // dot segment id は RangeError を投げ、interventions POST の副作用より前に fail-closed する。
      const followUpIssuePath =
        selectedIssue && selectedIssue.status === 'open'
          ? encodePathSegment(selectedIssue.id)
          : null;

      const response = await fetch('/api/interventions', {
        method: 'POST',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify({
          patient_id: patientId,
          ...(selectedIssue ? { issue_id: selectedIssue.id } : {}),
          type: 'prescriber_consultation',
          description: content,
          performed_at: new Date().toISOString(),
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.message ?? '医師への確認の記録に失敗しました');
      }

      // 相談を記録した課題は「処方医へ相談」進行中(in_progress)へ進める
      if (followUpIssuePath) {
        const patchResponse = await fetch(`/api/medication-issues/${followUpIssuePath}`, {
          method: 'PATCH',
          headers: buildOrgJsonHeaders(orgId),
          body: JSON.stringify({ status: 'in_progress' }),
        });
        if (!patchResponse.ok) {
          const patchPayload = await patchResponse.json().catch(() => null);
          throw new Error(patchPayload?.message ?? '課題状態の更新に失敗しました');
        }
      }
      return payload;
    },
    onSuccess: async () => {
      await invalidatePatientIssueQueries();
      toast.success('医師への確認を記録しました');
      setConsultDialogOpen(false);
    },
    onError: (error) => {
      toast.error(messageFromError(error, '医師への確認の記録に失敗しました'));
    },
  });

  const resolveMutation = useMutation({
    mutationFn: async (issueId: string) => {
      const response = await fetch(`/api/medication-issues/${encodePathSegment(issueId)}`, {
        method: 'PATCH',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify({ status: 'resolved' }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.message ?? '課題の完了に失敗しました');
      }
      return payload;
    },
    onSuccess: async () => {
      await invalidatePatientIssueQueries();
      toast.success('問題なしとして完了しました');
    },
    onError: (error) => {
      toast.error(messageFromError(error, '課題の完了に失敗しました'));
    },
  });

  const isLoading = !orgId || issuesQuery.isLoading;
  const patient = patientQuery.data;
  const patientName = patient?.name;
  const patientSafety = patient?.workspace?.safety;

  return (
    <section aria-label="薬の安全チェック" data-testid="safety-check">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-xl font-bold text-foreground">薬の安全チェック</h1>
          <p className="text-sm leading-6 text-muted-foreground">
            {patientName
              ? `${patientName}さん — リスクを選び、その場で確認記録へ進めます`
              : 'リスクを選び、その場で確認記録へ進めます'}
          </p>
        </div>
        <WorkflowBackLink href={buildPatientHref(patientId)} label="患者詳細へ戻る" />
      </div>

      {/* p1: 患者識別 + アレルギー/ハイリスクを Pinned 再掲。安全チェック中も常時可視化する。 */}
      {patientQuery.isError ? (
        <div className="mt-4 rounded-lg border border-border/70 bg-card p-4">
          <ErrorState
            variant="server"
            size="inline"
            title="患者安全情報を表示できません"
            description="患者安全情報を読み込めませんでした。アレルギー・ハイリスク情報が表示されていない可能性があります。再試行してください。"
            onRetry={() => void patientQuery.refetch()}
          />
        </div>
      ) : patientName ? (
        <PatientHeader
          name={patientName}
          kana={patient?.name_kana ?? null}
          birthDate={patient?.birth_date ?? null}
          safety={{
            allergy: patientSafety?.allergy ?? null,
            renal: patientSafety?.renal ?? null,
            swallowing: patientSafety?.swallowing ?? null,
            handlingTags: patientSafety?.handling_tags ?? undefined,
            cautions: patientSafety?.cautions ?? undefined,
          }}
          className="mt-4"
        />
      ) : null}

      <div className="mt-4">
        {isLoading ? (
          <SafetyCheckSkeleton />
        ) : issuesQuery.isError ? (
          <div className="rounded-lg border border-border/70 bg-card p-4">
            <ErrorState
              variant="server"
              title="薬の安全チェックを表示できません"
              description="服薬課題の取得に失敗しました。再試行してください。"
              detail={issuesQuery.error instanceof Error ? issuesQuery.error.message : undefined}
              onRetry={() => void issuesQuery.refetch()}
            />
          </div>
        ) : (
          <div className="space-y-4">
            <SafetyPrimaryAction
              concern={selectedConcern}
              issue={selectedIssue}
              consultationPending={consultationMutation.isPending}
              resolvePending={resolveMutation.isPending}
              onConsult={() => setConsultDialogOpen(true)}
              onResolve={() => setResolveDialogOpen(true)}
            />

            <div className="grid gap-4 xl:grid-cols-[minmax(0,17fr)_minmax(0,22fr)]">
              <section
                aria-labelledby="safety-concerns-heading"
                className="rounded-lg border border-border/70 bg-card p-4"
                data-testid="safety-concerns"
              >
                <h2
                  id="safety-concerns-heading"
                  className="text-base font-semibold text-foreground"
                >
                  気になる点
                </h2>
                {/* CDS 補強の取得失敗を「問題なし」に潰さない(false-safe 禁止)。相互作用チェックが
                    実行できなかった旨と、表示中の気になる点が不完全でありうる旨を明示し、再試行導線を出す。 */}
                {cdsQuery.isError ? (
                  <div
                    role="alert"
                    data-testid="safety-cds-degraded"
                    className="mt-4 flex flex-wrap items-center gap-3 rounded-md border border-border/70 border-l-4 border-l-state-blocked bg-card p-3"
                  >
                    <p className="min-w-0 flex-1 text-sm leading-6 text-foreground">
                      相互作用チェックを実行できませんでした。表示中の「気になる点」は不完全な可能性があります。
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void cdsQuery.refetch()}
                    >
                      再試行
                    </Button>
                  </div>
                ) : null}
                {concerns.length > 0 ? (
                  <ul className="mt-4 space-y-4" role="list">
                    {concerns.map((concern) => (
                      <ConcernCard
                        key={concern.category}
                        concern={concern}
                        selected={selectedConcern?.category === concern.category}
                        onSelect={() => setSelectedCategory(concern.category)}
                      />
                    ))}
                  </ul>
                ) : cdsQuery.isError ? null : (
                  <p className="mt-4 text-sm leading-6 text-muted-foreground">
                    気になる点はありません。新しい課題は服薬管理画面から登録できます。
                  </p>
                )}
              </section>

              <section
                aria-labelledby="safety-steps-heading"
                className="rounded-lg border border-border/70 bg-card p-4"
                data-testid="safety-steps"
              >
                <h2 id="safety-steps-heading" className="text-base font-semibold text-foreground">
                  確認の流れ
                </h2>
                <div className="mt-4">
                  <SafetyStepList issues={issues} />
                </div>
              </section>
            </div>
          </div>
        )}
      </div>

      <ConsultationDialog
        open={consultDialogOpen}
        onOpenChange={setConsultDialogOpen}
        concern={selectedConcern}
        pending={consultationMutation.isPending}
        onSubmit={(content) => consultationMutation.mutate(content)}
      />

      <ConfirmDialog
        open={resolveDialogOpen}
        onOpenChange={setResolveDialogOpen}
        title="問題なしにする"
        description={
          selectedConcern
            ? `「${selectedConcern.label}(${selectedConcern.subLabel})」を確認済み(問題なし)として完了します。よろしいですか?`
            : '選択中の気になる点を完了します。'
        }
        confirmLabel="問題なしにする"
        onConfirm={() => {
          if (selectedIssue) resolveMutation.mutate(selectedIssue.id);
        }}
      />
    </section>
  );
}
