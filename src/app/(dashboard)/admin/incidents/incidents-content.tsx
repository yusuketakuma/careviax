'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ClipboardList } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/loading';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useOrgId } from '@/lib/hooks/use-org-id';
import {
  INCIDENT_REPORTS_API_PATH,
  buildIncidentReportApiPath,
} from '@/lib/incident-reports/api-paths';
import { cn } from '@/lib/utils';
import {
  INCIDENT_PROCESS_OPTIONS,
  buildIncidentMemoCompletion,
  buildIncidentMemoPatchPayload,
  incidentCardSubtext,
  isIncidentMemoFieldFilled,
  toIncidentMemoForm,
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
        headers: { 'x-org-id': orgId },
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
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
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
          action={{ label: '再試行', onClick: () => void reportsQuery.refetch() }}
        />
      </div>
    );
  }

  const completion = buildIncidentMemoCompletion(form);
  const selectedDate = formatIncidentDate(selected?.occurred_at ?? selected?.created_at ?? null);

  return (
    <div
      className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]"
      data-testid="incidents-page"
    >
      {/* 記録一覧 */}
      <section
        aria-label="記録一覧"
        className="rounded-xl border border-border/70 bg-card p-5 shadow-sm"
      >
        <h2 className="text-base font-bold text-foreground">記録一覧</h2>
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
                      'min-h-11 w-full rounded-lg border px-4 py-3.5 text-left transition-colors',
                      active
                        ? 'border-primary/40 bg-primary/5'
                        : 'border-border bg-background hover:bg-muted/40',
                    )}
                  >
                    <span className="block text-[15px] font-bold text-foreground">
                      {report.title}
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
  );
}
