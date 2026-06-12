'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheck } from 'lucide-react';
import { toast } from 'sonner';
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
import { WorkspaceActionRail } from '@/components/features/workspace/action-rail';
import { WorkflowBackLink } from '@/components/features/workflow/workflow-back-link';
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
 * 3 カラム構成: 左「気になる点」(カテゴリ別カード・critical は赤見出し)→
 * 中央「確認の流れ」(4 ステップ・済は薄緑)→ 右「次にやること」
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
};

async function fetchPatientCdsAlerts(orgId: string, patientId: string): Promise<SafetyCdsAlert[]> {
  // CDS チェックはサイクル単位のため、患者の最新サイクルを引いてから実行する。
  // サイクル無し・権限不足(閲覧は canDispense)・チェック失敗は補強なしとして扱う。
  const cyclesRes = await fetch(`/api/medication-cycles?patient_id=${patientId}&limit=1`, {
    headers: { 'x-org-id': orgId },
  });
  if (!cyclesRes.ok) return [];
  const cyclesJson = (await cyclesRes.json()) as { data?: Array<{ id: string }> };
  const cycleId = cyclesJson.data?.[0]?.id;
  if (!cycleId) return [];

  const checkRes = await fetch('/api/cds/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
    body: JSON.stringify({ cycleId, patientId }),
  });
  if (!checkRes.ok) return [];
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
          'min-h-[44px] w-full rounded-lg border bg-card p-4 text-left transition-colors',
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
            step.done ? 'border-emerald-200 bg-emerald-50' : 'border-border/70 bg-card',
          )}
        >
          <p className="text-[15px] font-semibold leading-6 text-foreground">
            {step.stepNumber}. {step.label}
          </p>
          {step.done ? (
            <span className="flex shrink-0 items-center gap-1 text-emerald-700">
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
    <div className="grid gap-4 xl:grid-cols-[minmax(0,17fr)_minmax(0,22fr)_minmax(280px,10fr)]">
      {[0, 1, 2].map((column) => (
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
    queryKey: ['medication-issues', patientId],
    queryFn: async () => {
      const response = await fetch(`/api/medication-issues?patient_id=${patientId}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!response.ok) throw new Error('服薬課題の取得に失敗しました');
      return response.json() as Promise<MedicationIssueResponse>;
    },
    enabled: !!orgId,
  });

  const patientQuery = useQuery({
    queryKey: ['patient-safety-check-summary', patientId, orgId],
    queryFn: async () => {
      const response = await fetch(`/api/patients/${patientId}`, {
        headers: { 'x-org-id': orgId },
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
      queryClient.invalidateQueries({ queryKey: ['medication-issues', patientId] }),
      invalidateQueryKeys(queryClient, getPatientCareQueryKeys({ orgId, patientId })),
    ]);
  }

  const consultationMutation = useMutation({
    mutationFn: async (content: string) => {
      const response = await fetch('/api/interventions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
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
      if (selectedIssue && selectedIssue.status === 'open') {
        const patchResponse = await fetch(`/api/medication-issues/${selectedIssue.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
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
      toast.error(error instanceof Error ? error.message : '医師への確認の記録に失敗しました');
    },
  });

  const resolveMutation = useMutation({
    mutationFn: async (issueId: string) => {
      const response = await fetch(`/api/medication-issues/${issueId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
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
      toast.error(error instanceof Error ? error.message : '課題の完了に失敗しました');
    },
  });

  const isLoading = !orgId || issuesQuery.isLoading;
  const patientName = patientQuery.data?.name;

  return (
    <section aria-label="薬の安全チェック" data-testid="safety-check">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-xl font-bold text-foreground">薬の安全チェック</h2>
          <p className="text-sm text-muted-foreground">
            {patientName
              ? `${patientName}さん — 気になる点を処方医への相談から報告書反映まで進めます`
              : '気になる点を処方医への相談から報告書反映まで進めます'}
          </p>
        </div>
        <WorkflowBackLink href={`/patients/${patientId}`} label="患者詳細へ戻る" />
      </div>

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
              action={{ label: '再試行', onClick: () => void issuesQuery.refetch() }}
            />
          </div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,17fr)_minmax(0,22fr)_minmax(280px,10fr)]">
            <section
              aria-labelledby="safety-concerns-heading"
              className="rounded-lg border border-border/70 bg-card p-4"
              data-testid="safety-concerns"
            >
              <h3 id="safety-concerns-heading" className="text-base font-semibold text-foreground">
                気になる点
              </h3>
              {concerns.length === 0 ? (
                <p className="mt-4 text-sm leading-6 text-muted-foreground">
                  気になる点はありません。新しい課題は服薬管理画面から登録できます。
                </p>
              ) : (
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
              )}
            </section>

            <section
              aria-labelledby="safety-steps-heading"
              className="rounded-lg border border-border/70 bg-card p-4"
              data-testid="safety-steps"
            >
              <h3 id="safety-steps-heading" className="text-base font-semibold text-foreground">
                確認の流れ
              </h3>
              <div className="mt-4">
                <SafetyStepList issues={issues} />
              </div>
            </section>

            <div className="space-y-4">
              <WorkspaceActionRail
                nextAction={{
                  actionLabel: '医師への確認を記録',
                  onAction: () => setConsultDialogOpen(true),
                  actionDisabled: !selectedConcern || consultationMutation.isPending,
                  secondaryActionLabel: '問題なしにする',
                  onSecondaryAction: () => setResolveDialogOpen(true),
                  secondaryActionDisabled: !selectedIssue || resolveMutation.isPending,
                  description: selectedConcern
                    ? `対象: ${selectedConcern.label}(${selectedConcern.subLabel})`
                    : undefined,
                }}
              />
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
