'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ClipboardList, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/loading';
import { StateBadge } from '@/components/ui/state-badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { hasPermission } from '@/lib/auth/permission-matrix';
import { useOrgId } from '@/lib/hooks/use-org-id';
import {
  INCIDENT_REPORTS_API_PATH,
  buildIncidentReportApiPath,
} from '@/lib/incident-reports/api-paths';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { useAuthStore } from '@/lib/stores/auth-store';
import { cn } from '@/lib/utils';
import {
  EMPTY_INCIDENT_CREATE_FORM,
  INCIDENT_PROCESS_OPTIONS,
  INCIDENT_SEVERITY_OPTIONS,
  INCIDENT_STATUS_OPTIONS,
  buildIncidentCreatePayload,
  buildIncidentMemoCompletion,
  buildIncidentMemoPatchPayload,
  incidentCardSubtext,
  incidentSeverityBadgeRole,
  incidentSeverityLabel,
  incidentStatusBadgeRole,
  incidentStatusLabel,
  isIncidentCreateFormValid,
  isIncidentMemoFieldFilled,
  toIncidentMemoForm,
  toIncidentStatusPatchValue,
  type IncidentCreateForm,
  type IncidentMemoForm,
  type IncidentReportListItem,
} from './incidents-form';

/**
 * p1_09「ヒヤリハット管理」: 左に記録一覧(カード選択)、右に再発防止メモ
 * (起きたこと/原因/すぐ行った対応/次から変えること/関係する工程)の
 * 5項目フォーム+「保存する」の2カラム画面。
 */

const MEMO_TEXT_FIELDS = [
  { key: 'whatHappened', label: '起きたこと' },
  { key: 'cause', label: '原因' },
  { key: 'immediateAction', label: 'すぐ行った対応' },
  { key: 'preventionPlan', label: '次から変えること' },
] as const;
const INCIDENT_MEMO_DISABLED_REASON_ID = 'incident-memo-disabled-reason';
const INCIDENT_MEMO_DISABLED_REASON = '記録一覧に記録がないため入力できません。';

/** 未入力(未完了)を示す控えめな confirm チップ。保存はできる=要対応であってブロックではない。 */
function MissingFieldChip() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-state-confirm/30 bg-state-confirm/10 px-2 py-0.5 text-xs font-medium text-state-confirm">
      <span aria-hidden className="size-1.5 rounded-full bg-state-confirm" />
      未入力
    </span>
  );
}

function formatIncidentDate(value: string | null): string {
  if (!value) return '日時未設定';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '日時未設定';
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

export function IncidentsContent() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();

  const reportsQuery = useQuery({
    queryKey: ['incident-reports', orgId],
    queryFn: async () => {
      const res = await fetch(INCIDENT_REPORTS_API_PATH, {
        headers: buildOrgHeaders(orgId),
      });
      if (!res.ok) throw new Error('ヒヤリハット記録の取得に失敗しました');
      const json = (await res.json()) as { data: IncidentReportListItem[] };
      return json.data;
    },
    enabled: !!orgId,
  });

  const reports = React.useMemo(() => reportsQuery.data ?? [], [reportsQuery.data]);

  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const selected = reports.find((report) => report.id === selectedId) ?? reports[0] ?? null;

  // 記録の切替時のみフォームを読み直す(編集中の値は id が変わるまで保持)
  const [hydratedId, setHydratedId] = React.useState<string | null>(null);
  const [form, setForm] = React.useState<IncidentMemoForm>(() => toIncidentMemoForm(null));
  if (selected && hydratedId !== selected.id) {
    setHydratedId(selected.id);
    setForm(toIncidentMemoForm(selected));
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error('記録一覧から記録を選択してください');
      const res = await fetch(buildIncidentReportApiPath(selected.id), {
        method: 'PATCH',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify(buildIncidentMemoPatchPayload(form)),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(err?.message ?? '再発防止メモの保存に失敗しました');
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success('再発防止メモを保存しました');
      void queryClient.invalidateQueries({ queryKey: ['incident-reports', orgId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const viewerRole = useAuthStore((s) => s.currentUser.role);
  // ステータス変更(未対応/確認済み/クローズ)は管理者のみ。サーバ側 canAdmin ガードと一致させ、
  // 非管理者には常時 403 になる操作を出さない(hide、not disable-with-tooltip)。
  const canChangeStatus = viewerRole ? hasPermission(viewerRole, 'canAdmin') : false;

  const statusMutation = useMutation({
    mutationFn: async (status: string) => {
      if (!selected) throw new Error('記録一覧から記録を選択してください');
      const nextStatus = toIncidentStatusPatchValue(status);
      if (!nextStatus) throw new Error('対応していないステータスです');
      const res = await fetch(buildIncidentReportApiPath(selected.id), {
        method: 'PATCH',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(err?.message ?? 'ステータスの変更に失敗しました');
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success('ステータスを更新しました');
      void queryClient.invalidateQueries({ queryKey: ['incident-reports', orgId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const [createOpen, setCreateOpen] = React.useState(false);
  const [createForm, setCreateForm] = React.useState<IncidentCreateForm>(
    EMPTY_INCIDENT_CREATE_FORM,
  );

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(INCIDENT_REPORTS_API_PATH, {
        method: 'POST',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify(buildIncidentCreatePayload(createForm)),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(err?.message ?? '記録の作成に失敗しました');
      }
      return res.json() as Promise<{ data: IncidentReportListItem }>;
    },
    onSuccess: (result) => {
      toast.success('記録を作成しました');
      setCreateOpen(false);
      setCreateForm(EMPTY_INCIDENT_CREATE_FORM);
      setSelectedId(result.data.id);
      setHydratedId(result.data.id);
      setForm(toIncidentMemoForm(result.data));
      void queryClient.invalidateQueries({ queryKey: ['incident-reports', orgId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (!orgId || reportsQuery.isLoading) {
    return (
      <div
        className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]"
        role="status"
        aria-label="ヒヤリハット記録読み込み中"
      >
        <Skeleton className="h-96 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  if (reportsQuery.isError) {
    return (
      <div className="rounded-xl border border-border/70 bg-card p-4">
        <ErrorState
          variant="server"
          title="ヒヤリハット記録を表示できません"
          description="記録の取得に失敗しました。再試行してください。"
          onRetry={() => void reportsQuery.refetch()}
        />
      </div>
    );
  }

  const completion = buildIncidentMemoCompletion(form);
  const selectedDate = formatIncidentDate(selected?.occurred_at ?? selected?.created_at ?? null);

  return (
    <>
      <div
        className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]"
        data-testid="incidents-page"
      >
        {/* 記録一覧 */}
        <section
          aria-label="記録一覧"
          className="rounded-xl border border-border/70 bg-card p-5 shadow-sm"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-bold text-foreground">記録一覧</h2>
            <Button
              type="button"
              size="sm"
              className="h-11 min-h-[44px]"
              onClick={() => {
                setCreateForm(EMPTY_INCIDENT_CREATE_FORM);
                setCreateOpen(true);
              }}
            >
              <Plus aria-hidden className="size-4" />
              新規記録
            </Button>
          </div>
          {reports.length === 0 ? (
            <div className="mt-5">
              <EmptyState
                icon={ClipboardList}
                title="ヒヤリハット記録はまだありません"
                description="記録が登録されると、ここに一覧で表示されます。"
              />
            </div>
          ) : (
            <ul className="mt-5 space-y-5" role="list" data-testid="incident-record-list">
              {reports.map((report) => {
                const active = report.id === selected?.id;
                return (
                  <li key={report.id}>
                    <button
                      type="button"
                      data-testid="incident-record-item"
                      aria-pressed={active}
                      onClick={() => setSelectedId(report.id)}
                      className={cn(
                        'min-h-11 w-full rounded-lg border px-4 py-3.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                        active
                          ? 'border-primary/40 bg-primary/5'
                          : 'border-border bg-background hover:bg-muted/40',
                      )}
                    >
                      <span className="block text-[15px] font-bold text-foreground">
                        {report.title}
                      </span>
                      <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <StateBadge role={incidentStatusBadgeRole(report.status)}>
                          {incidentStatusLabel(report.status)}
                        </StateBadge>
                        <StateBadge role={incidentSeverityBadgeRole(report.severity)}>
                          {incidentSeverityLabel(report.severity)}
                        </StateBadge>
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {incidentCardSubtext(report)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* 再発防止メモ */}
        <section
          aria-label="再発防止メモ"
          className="rounded-xl border border-border/70 bg-card p-5 shadow-sm"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-foreground">再発防止メモ</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {selected ? `${selected.title} / ${selectedDate}` : '記録を選択してください'}
              </p>
              {selected ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <StateBadge role={incidentSeverityBadgeRole(selected.severity)}>
                    {incidentSeverityLabel(selected.severity)}
                  </StateBadge>
                  {canChangeStatus ? (
                    <Select
                      value={selected.status}
                      onValueChange={(value) => {
                        if (value) statusMutation.mutate(value);
                      }}
                      disabled={statusMutation.isPending}
                    >
                      <SelectTrigger
                        aria-label="ステータスを変更"
                        data-testid="incident-status-select"
                        className="h-9 w-[160px]"
                      >
                        <SelectValue>{incidentStatusLabel(selected.status)}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {INCIDENT_STATUS_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <StateBadge role={incidentStatusBadgeRole(selected.status)}>
                      {incidentStatusLabel(selected.status)}
                    </StateBadge>
                  )}
                </div>
              ) : null}
            </div>
            <div className="rounded-md border border-border/70 bg-muted/30 px-3 py-2 text-right">
              <p className="text-xs text-muted-foreground">記入状況</p>
              <p className="mt-0.5 text-sm font-bold text-foreground">
                {completion.completedCount}/{completion.totalCount} 項目
              </p>
            </div>
          </div>

          <div className="mt-4 rounded-md border border-border/70 bg-muted/20 p-3">
            <p className="text-sm font-medium text-foreground">
              保存前に「何が起きたか」「なぜ起きたか」「次から変えること」を揃えます。
            </p>
            {completion.isComplete ? (
              <p className="mt-2 text-sm text-state-done">必要項目は埋まっています。</p>
            ) : (
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                未入力: {completion.missingLabels.join('、')}
              </p>
            )}
          </div>
          <form
            data-testid="incident-memo-form"
            className="mt-5 space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              if (!selected) return;
              saveMutation.mutate();
            }}
          >
            {!selected ? (
              <p id={INCIDENT_MEMO_DISABLED_REASON_ID} className="text-sm text-muted-foreground">
                {INCIDENT_MEMO_DISABLED_REASON}
              </p>
            ) : null}
            {MEMO_TEXT_FIELDS.map((field) => (
              <div
                key={field.key}
                className="grid gap-2 sm:grid-cols-[150px_minmax(0,1fr)] sm:items-start"
              >
                <div className="flex items-center gap-2 sm:pt-2">
                  <label htmlFor={`incident-${field.key}`} className="text-sm font-medium">
                    {field.label}
                  </label>
                  {selected && !isIncidentMemoFieldFilled(form, field.key) ? (
                    <MissingFieldChip />
                  ) : null}
                </div>
                <Textarea
                  id={`incident-${field.key}`}
                  value={form[field.key]}
                  rows={3}
                  placeholder={`${field.label}を記録`}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, [field.key]: event.target.value }))
                  }
                  aria-describedby={!selected ? INCIDENT_MEMO_DISABLED_REASON_ID : undefined}
                  disabled={!selected}
                  className="min-h-[96px] resize-y"
                />
              </div>
            ))}

            <div className="grid gap-2 sm:grid-cols-[150px_minmax(0,1fr)] sm:items-center">
              <div className="flex items-center gap-2">
                <label id="incident-related-process-label" className="text-sm font-medium">
                  関係する工程
                </label>
                {selected && !isIncidentMemoFieldFilled(form, 'relatedProcess') ? (
                  <MissingFieldChip />
                ) : null}
              </div>
              <Select
                value={form.relatedProcess}
                onValueChange={(value) =>
                  setForm((prev) => ({ ...prev, relatedProcess: (value as string | null) ?? '' }))
                }
                disabled={!selected}
              >
                <SelectTrigger
                  aria-labelledby="incident-related-process-label"
                  aria-describedby={!selected ? INCIDENT_MEMO_DISABLED_REASON_ID : undefined}
                  data-testid="incident-related-process"
                  className="w-full sm:h-10"
                >
                  <SelectValue placeholder="工程を選択" />
                </SelectTrigger>
                <SelectContent>
                  {INCIDENT_PROCESS_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              type="submit"
              className="mt-8 h-11 w-[220px]"
              aria-describedby={!selected ? INCIDENT_MEMO_DISABLED_REASON_ID : undefined}
              disabled={!selected || saveMutation.isPending}
            >
              {saveMutation.isPending
                ? '保存中...'
                : completion.isComplete
                  ? '再発防止メモを保存'
                  : '不足ありで保存'}
            </Button>
          </form>
        </section>
      </div>

      <Sheet
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) setCreateForm(EMPTY_INCIDENT_CREATE_FORM);
        }}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>ヒヤリハット記録を作成</SheetTitle>
            <SheetDescription>
              表題は必須です。詳細な再発防止メモは作成後に右側フォームから記録できます。
            </SheetDescription>
          </SheetHeader>
          <form
            className="mt-6 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!isIncidentCreateFormValid(createForm)) return;
              createMutation.mutate();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="incident-create-title">表題</Label>
              <Input
                id="incident-create-title"
                value={createForm.title}
                onChange={(event) =>
                  setCreateForm((prev) => ({ ...prev, title: event.target.value }))
                }
                placeholder="例: セット日付間違い"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label id="incident-create-severity-label" htmlFor="incident-create-severity">
                重大度
              </Label>
              <Select
                value={createForm.severity}
                onValueChange={(value) =>
                  setCreateForm((prev) => ({ ...prev, severity: (value as string | null) ?? '' }))
                }
              >
                <SelectTrigger
                  id="incident-create-severity"
                  aria-labelledby="incident-create-severity-label"
                  className="w-full"
                >
                  <SelectValue placeholder="ヒヤリハット(既定)" />
                </SelectTrigger>
                <SelectContent>
                  {INCIDENT_SEVERITY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="incident-create-occurred-at">発生日</Label>
              <Input
                id="incident-create-occurred-at"
                type="date"
                value={createForm.occurredAt}
                onChange={(event) =>
                  setCreateForm((prev) => ({ ...prev, occurredAt: event.target.value }))
                }
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                キャンセル
              </Button>
              <Button
                type="submit"
                disabled={!isIncidentCreateFormValid(createForm) || createMutation.isPending}
              >
                {createMutation.isPending ? '作成中...' : '作成する'}
              </Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}
