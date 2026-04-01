'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { Archive, CheckCircle2, FileText, PencilLine, Plus, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loading } from '@/components/ui/loading';
import { getPatientCareQueryKeys, invalidateQueryKeys } from '@/lib/visits/query-invalidations';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

type CaseSummary = {
  id: string;
  status: string;
  primary_pharmacist_id: string | null;
  referral_source: string | null;
  start_date: string | null;
  end_date: string | null;
};

type ManagementPlan = {
  id: string;
  case_id: string;
  title: string;
  summary: string | null;
  content: Record<string, unknown>;
  version: number;
  status: 'draft' | 'approved' | 'superseded' | 'archived';
  effective_from: string | null;
  next_review_date: string | null;
  approved_at: string | null;
  updated_at: string;
  created_at: string;
};

type ManagementPlanListResponse = {
  data: ManagementPlan[];
};

type EditorState = {
  open: boolean;
  plan: ManagementPlan | null;
};

type ManagementPlanFormState = {
  title: string;
  summary: string;
  effective_from: string;
  next_review_date: string;
  contentText: string;
};

const caseStatusLabel: Record<string, string> = {
  referral_received: '紹介受領',
  assessment: 'アセスメント',
  active: '稼働中',
  on_hold: '保留',
  discharged: '終了',
  terminated: '解約',
};

const managementPlanStatusLabel: Record<ManagementPlan['status'], string> = {
  draft: '下書き',
  approved: '承認済',
  superseded: '差替済',
  archived: 'アーカイブ',
};

const managementPlanStatusVariant: Record<
  ManagementPlan['status'],
  'default' | 'secondary' | 'outline'
> = {
  draft: 'secondary',
  approved: 'default',
  superseded: 'outline',
  archived: 'outline',
};

const defaultPlanContent = {
  visit_policy: '',
  monitoring_points: [],
  collaboration_notes: '',
};

function pickInitialCaseId(cases: CaseSummary[]) {
  return (
    cases.find((careCase) => careCase.status === 'active')?.id ??
    cases.find((careCase) => careCase.status !== 'discharged' && careCase.status !== 'terminated')
      ?.id ??
    cases[0]?.id ??
    ''
  );
}

function toDateInputValue(value?: string | null) {
  if (!value) return '';
  return value.slice(0, 10);
}

function toEditorFormState(plan?: ManagementPlan | null): ManagementPlanFormState {
  return {
    title: plan?.title ?? '訪問薬剤管理指導計画書',
    summary: plan?.summary ?? '',
    effective_from: toDateInputValue(plan?.effective_from),
    next_review_date: toDateInputValue(plan?.next_review_date),
    contentText: JSON.stringify(plan?.content ?? defaultPlanContent, null, 2),
  };
}

function renderDate(value?: string | null) {
  if (!value) return '—';
  return format(parseISO(value), 'yyyy/MM/dd', { locale: ja });
}

function formatCaseLabel(careCase: CaseSummary) {
  const suffix = careCase.id.slice(-6).toUpperCase();
  const status = caseStatusLabel[careCase.status] ?? careCase.status;
  return `ケース #${suffix} / ${status}`;
}

function parseContentValue(contentText: string) {
  let parsed: unknown;

  try {
    parsed = JSON.parse(contentText);
  } catch {
    throw new Error('本文は JSON 形式で入力してください');
  }

  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('本文は JSON オブジェクト形式で入力してください');
  }

  return parsed as Record<string, unknown>;
}

function buildPlanPayload(form: ManagementPlanFormState) {
  return {
    title: form.title.trim(),
    ...(form.summary.trim() ? { summary: form.summary.trim() } : {}),
    ...(form.effective_from ? { effective_from: form.effective_from } : {}),
    ...(form.next_review_date ? { next_review_date: form.next_review_date } : {}),
    content: parseContentValue(form.contentText),
  };
}

function ManagementPlanEditorForm({
  plan,
  onSubmit,
  onCancel,
  isPending,
}: {
  plan: ManagementPlan | null;
  onSubmit: (form: ManagementPlanFormState) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const [form, setForm] = useState<ManagementPlanFormState>(() => toEditorFormState(plan));

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.title.trim()) {
      toast.error('タイトルを入力してください');
      return;
    }

    try {
      parseContentValue(form.contentText);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '本文の形式が不正です');
      return;
    }

    onSubmit(form);
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{plan ? '計画書を編集' : '計画書を作成'}</DialogTitle>
        <DialogDescription>
          計画書本文は JSON オブジェクトで保持します。既存 API の内容をそのまま編集できます。
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="management_plan_title">タイトル</Label>
            <Input
              id="management_plan_title"
              value={form.title}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  title: event.target.value,
                }))
              }
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="management_plan_effective_from">適用開始日</Label>
            <Input
              id="management_plan_effective_from"
              type="date"
              value={form.effective_from}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  effective_from: event.target.value,
                }))
              }
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="management_plan_next_review_date">次回見直し日</Label>
            <Input
              id="management_plan_next_review_date"
              type="date"
              value={form.next_review_date}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  next_review_date: event.target.value,
                }))
              }
            />
          </div>

          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="management_plan_summary">要約</Label>
            <Textarea
              id="management_plan_summary"
              rows={3}
              value={form.summary}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  summary: event.target.value,
                }))
              }
            />
          </div>

          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="management_plan_content">本文(JSON)</Label>
            <Textarea
              id="management_plan_content"
              rows={14}
              className="font-mono text-xs"
              value={form.contentText}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  contentText: event.target.value,
                }))
              }
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel} disabled={isPending}>
            キャンセル
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending ? '保存中...' : plan ? '更新する' : '作成する'}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

function ManagementPlanEditorDialog({
  open,
  plan,
  onOpenChange,
  onSubmit,
  isPending,
}: {
  open: boolean;
  plan: ManagementPlan | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (form: ManagementPlanFormState) => void;
  isPending: boolean;
}) {
  const editorKey = `${open ? 'open' : 'closed'}-${plan?.id ?? 'new'}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        {open ? (
          <ManagementPlanEditorForm
            key={editorKey}
            plan={plan}
            onSubmit={onSubmit}
            onCancel={() => onOpenChange(false)}
            isPending={isPending}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function ManagementPlanPanel({
  patientId,
  patientName,
  cases,
  orgId,
}: {
  patientId: string;
  patientName: string;
  cases: CaseSummary[];
  orgId: string;
}) {
  const queryClient = useQueryClient();
  const fallbackCaseId = useMemo(() => pickInitialCaseId(cases), [cases]);
  const [selectedCaseId, setSelectedCaseId] = useState(fallbackCaseId);
  const [editor, setEditor] = useState<EditorState>({ open: false, plan: null });
  const resolvedSelectedCaseId = cases.some((careCase) => careCase.id === selectedCaseId)
    ? selectedCaseId
    : fallbackCaseId;
  const selectedCase = cases.find((careCase) => careCase.id === resolvedSelectedCaseId) ?? null;

  const { data, isLoading, error } = useQuery<ManagementPlanListResponse>({
    queryKey: ['management-plans', resolvedSelectedCaseId, orgId],
    queryFn: async () => {
      const res = await fetch(`/api/management-plans?case_id=${resolvedSelectedCaseId}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('管理計画書の取得に失敗しました');
      return res.json();
    },
    enabled: !!orgId && !!resolvedSelectedCaseId,
  });

  const saveMutation = useMutation({
    mutationFn: async (form: ManagementPlanFormState) => {
      const payload = buildPlanPayload(form);
      const isEditing = Boolean(editor.plan);
      const res = await fetch(
        isEditing ? `/api/management-plans/${editor.plan?.id}` : '/api/management-plans',
        {
          method: isEditing ? 'PATCH' : 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-org-id': orgId,
          },
          body: JSON.stringify(
            isEditing
              ? {
                  action: 'update',
                  ...payload,
                }
              : {
                  case_id: resolvedSelectedCaseId,
                  ...payload,
                },
          ),
        },
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? '管理計画書の保存に失敗しました');
      }

      return res.json();
    },
    onSuccess: async () => {
      toast.success(editor.plan ? '管理計画書を更新しました' : '管理計画書を作成しました');
      setEditor({ open: false, plan: null });
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['management-plans', resolvedSelectedCaseId, orgId],
        }),
        invalidateQueryKeys(queryClient, getPatientCareQueryKeys({ orgId, patientId })),
      ]);
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const actionMutation = useMutation({
    mutationFn: async ({ planId, action }: { planId: string; action: 'approve' | 'archive' }) => {
      const res = await fetch(`/api/management-plans/${planId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({ action }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          err.message ??
            (action === 'approve'
              ? '管理計画書の承認に失敗しました'
              : '管理計画書のアーカイブに失敗しました'),
        );
      }

      return res.json();
    },
    onSuccess: async (_, variables) => {
      toast.success(
        variables.action === 'approve'
          ? '管理計画書を承認しました'
          : '管理計画書をアーカイブしました',
      );
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['management-plans', resolvedSelectedCaseId, orgId],
        }),
        invalidateQueryKeys(queryClient, getPatientCareQueryKeys({ orgId, patientId })),
      ]);
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  if (cases.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">管理計画書</CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState
            icon={FileText}
            title="ケースがありません"
            description="ケース作成後に管理計画書を登録できます"
          />
        </CardContent>
      </Card>
    );
  }

  const plans = data?.data ?? [];

  return (
    <>
      <Card>
        <CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="text-base">管理計画書</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {patientName} さんのケースごとに計画書を管理します。
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:min-w-[280px]">
            <Select
              value={resolvedSelectedCaseId}
              onValueChange={(value) => setSelectedCaseId(value ?? fallbackCaseId)}
            >
              <SelectTrigger>
                <SelectValue placeholder="ケースを選択" />
              </SelectTrigger>
              <SelectContent>
                {cases.map((careCase) => (
                  <SelectItem key={careCase.id} value={careCase.id}>
                    {formatCaseLabel(careCase)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              onClick={() => setEditor({ open: true, plan: null })}
              disabled={!resolvedSelectedCaseId}
            >
              <Plus className="size-4" aria-hidden="true" />
              新規計画書
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {selectedCase ? (
            <div className="rounded-lg border bg-muted/20 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">
                  {caseStatusLabel[selectedCase.status] ?? selectedCase.status}
                </Badge>
                <span className="text-muted-foreground">
                  開始日: {renderDate(selectedCase.start_date)}
                </span>
                <span className="text-muted-foreground">
                  終了日: {renderDate(selectedCase.end_date)}
                </span>
              </div>
            </div>
          ) : null}

          {isLoading ? <Loading /> : null}
          {error ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              管理計画書を取得できませんでした
            </div>
          ) : null}

          {!isLoading && !error && plans.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="管理計画書がありません"
              description="選択中のケースに対する計画書を作成してください"
            />
          ) : null}

          {!isLoading && !error
            ? plans.map((plan) => (
                <article key={plan.id} className="rounded-xl border bg-card p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-medium text-foreground">{plan.title}</h3>
                        <Badge variant={managementPlanStatusVariant[plan.status]}>
                          {managementPlanStatusLabel[plan.status]}
                        </Badge>
                        <Badge variant="outline">v{plan.version}</Badge>
                      </div>
                      <dl className="grid gap-2 text-sm text-muted-foreground md:grid-cols-3">
                        <div>
                          <dt>適用開始</dt>
                          <dd className="text-foreground">{renderDate(plan.effective_from)}</dd>
                        </div>
                        <div>
                          <dt>次回見直し</dt>
                          <dd className="text-foreground">{renderDate(plan.next_review_date)}</dd>
                        </div>
                        <div>
                          <dt>最終更新</dt>
                          <dd className="text-foreground">{renderDate(plan.updated_at)}</dd>
                        </div>
                      </dl>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Link
                        href={`/api/management-plans/${plan.id}/pdf`}
                        target="_blank"
                        rel="noreferrer"
                        className={buttonVariants({ variant: 'outline', size: 'sm' })}
                      >
                        <FileText className="size-4" aria-hidden="true" />
                        PDF
                      </Link>
                      <Link
                        href={`/patients/${patientId}/management-plan/print?planId=${plan.id}`}
                        className={buttonVariants({ variant: 'outline', size: 'sm' })}
                      >
                        <Printer className="size-4" aria-hidden="true" />
                        印刷ビュー
                      </Link>
                      {plan.status === 'draft' ? (
                        <>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setEditor({ open: true, plan })}
                          >
                            <PencilLine className="size-4" aria-hidden="true" />
                            編集
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            onClick={() =>
                              actionMutation.mutate({ planId: plan.id, action: 'approve' })
                            }
                            disabled={actionMutation.isPending}
                          >
                            <CheckCircle2 className="size-4" aria-hidden="true" />
                            承認
                          </Button>
                        </>
                      ) : null}

                      {plan.status !== 'archived' ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            actionMutation.mutate({ planId: plan.id, action: 'archive' })
                          }
                          disabled={actionMutation.isPending}
                        >
                          <Archive className="size-4" aria-hidden="true" />
                          アーカイブ
                        </Button>
                      ) : null}
                    </div>
                  </div>

                  {plan.summary ? (
                    <div className="mt-4 rounded-lg bg-muted/30 p-3 text-sm text-foreground">
                      {plan.summary}
                    </div>
                  ) : null}

                  <div className="mt-4 space-y-2">
                    <p className="text-sm font-medium text-foreground">本文</p>
                    <pre className="max-h-64 overflow-auto rounded-lg border bg-muted/20 p-3 text-xs whitespace-pre-wrap text-foreground">
                      {JSON.stringify(plan.content, null, 2)}
                    </pre>
                  </div>
                </article>
              ))
            : null}
        </CardContent>
      </Card>

      <ManagementPlanEditorDialog
        open={editor.open}
        plan={editor.plan}
        onOpenChange={(open) =>
          setEditor((current) => ({
            ...current,
            open,
            plan: open ? current.plan : null,
          }))
        }
        onSubmit={(form) => saveMutation.mutate(form)}
        isPending={saveMutation.isPending}
      />
    </>
  );
}
