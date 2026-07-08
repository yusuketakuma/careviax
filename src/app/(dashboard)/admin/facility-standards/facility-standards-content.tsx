'use client';

import { useMemo } from 'react';
import {
  buildFacilityCriteriaRows,
  FacilityCriteriaChecklist,
  summarizeFacilityCriteriaRows,
} from './facility-criteria-checklist';
import { useQuery } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import { format, differenceInDays, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { AlertTriangle, CheckCircle2, XCircle, Bell } from 'lucide-react';
import { DataTable } from '@/components/ui/data-table';
import { ErrorState } from '@/components/ui/error-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { buildOrgHeaders } from '@/lib/api/org-headers';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { readApiJson } from '@/lib/api/client-json';

// --- Types ---

type FacilityStandard = {
  id: string;
  standard_type: string;
  filed_date: string;
  effective_date: string | null;
  expiry_date: string | null;
  renewal_alert_date: string | null;
  requirements_status: Record<string, boolean> | null;
  claim_status: 'claimable' | 'blocked' | 'unknown';
};

type FacilityStandardsResponse = {
  data: FacilityStandard[];
  meta: {
    total_count: number;
    visible_count: number;
    hidden_count: number;
    truncated: boolean;
    count_basis: 'facility_standards';
    filters_applied: Record<string, never>;
    limit: number;
  };
};

// --- Helpers ---

function getRequirementBadge(status: Record<string, boolean> | null) {
  if (!status) {
    return (
      <Badge variant="outline" className="text-xs text-muted-foreground">
        未確認
      </Badge>
    );
  }
  const values = Object.values(status);
  const allMet = values.every(Boolean);
  const noneMet = values.every((v) => !v);

  if (allMet) {
    return (
      <Badge
        variant="outline"
        className="flex w-fit items-center gap-1 border-transparent bg-state-done/10 text-xs text-state-done"
      >
        <CheckCircle2 className="size-3" aria-hidden="true" /> 充足
      </Badge>
    );
  }
  if (noneMet) {
    return (
      <Badge
        variant="outline"
        className="flex w-fit items-center gap-1 border-transparent bg-state-blocked/10 text-xs text-state-blocked"
      >
        <XCircle className="size-3" aria-hidden="true" /> 不足
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="flex w-fit items-center gap-1 border-transparent bg-state-confirm/10 text-xs text-state-confirm"
    >
      <AlertTriangle className="size-3" aria-hidden="true" /> 一部不足
    </Badge>
  );
}

function ExpiryCell({ expiryDate }: { expiryDate: string | null }) {
  if (!expiryDate) return <span className="text-xs text-muted-foreground">—</span>;

  const days = differenceInDays(parseISO(expiryDate), new Date());
  const formatted = format(parseISO(expiryDate), 'yyyy/MM/dd', { locale: ja });

  if (days < 0) {
    return (
      <span className="flex items-center gap-1 text-xs text-state-blocked">
        <XCircle className="size-3.5" aria-hidden="true" />
        {formatted}（期限切れ）
      </span>
    );
  }
  if (days <= 30) {
    return (
      <span className="flex items-center gap-1 text-xs text-state-blocked">
        <Bell className="size-3.5" aria-hidden="true" />
        {formatted}（残{days}日）
      </span>
    );
  }
  if (days <= 90) {
    return (
      <span className="flex items-center gap-1 text-xs text-state-confirm">
        <Bell className="size-3.5" aria-hidden="true" />
        {formatted}（残{days}日）
      </span>
    );
  }
  return <span className="text-xs text-muted-foreground">{formatted}</span>;
}

function ClaimStatusBadge({ status }: { status: FacilityStandard['claim_status'] }) {
  if (status === 'claimable') {
    return (
      <Badge variant="outline" className="border-transparent bg-state-done/10 text-state-done">
        算定可
      </Badge>
    );
  }
  if (status === 'blocked') {
    return <Badge variant="destructive">算定不可</Badge>;
  }
  return <Badge variant="outline">判定待ち</Badge>;
}

// --- Main ---

export function FacilityStandardsContent() {
  const orgId = useOrgId();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['facility-standards', orgId],
    queryFn: async () => {
      const res = await fetch('/api/admin/facility-standards', {
        headers: buildOrgHeaders(orgId),
      });
      return readApiJson<FacilityStandardsResponse>(res, '施設基準の取得に失敗しました');
    },
    enabled: !!orgId,
  });

  const standards = useMemo(() => data?.data ?? [], [data?.data]);
  const standardsMeta = data?.meta;
  const criteriaRows = useMemo(() => buildFacilityCriteriaRows(standards), [standards]);
  const criteriaSummary = useMemo(
    () => summarizeFacilityCriteriaRows(criteriaRows),
    [criteriaRows],
  );
  const totalStandardsCount = standardsMeta?.total_count ?? standards.length;
  const visibleStandardsCount = standardsMeta?.visible_count ?? standards.length;
  const hiddenStandardsCount =
    standardsMeta?.hidden_count ?? Math.max(totalStandardsCount - standards.length, 0);
  const isStandardsTruncated = Boolean(standardsMeta?.truncated || hiddenStandardsCount > 0);
  const standardsListSummary = data
    ? isStandardsTruncated
      ? `先頭${visibleStandardsCount.toLocaleString()}件を表示 / 他${hiddenStandardsCount.toLocaleString()}件`
      : `登録${totalStandardsCount.toLocaleString()}件`
    : null;
  const claimSummaryStatus: FacilityStandard['claim_status'] = isStandardsTruncated
    ? 'unknown'
    : criteriaSummary.statusTone === 'ok'
      ? 'claimable'
      : criteriaSummary.statusTone === 'missing'
        ? 'blocked'
        : 'unknown';

  // Alerts: expiry within 90 days
  const alertItems = standards.filter((s) => {
    if (!s.expiry_date) return false;
    const days = differenceInDays(parseISO(s.expiry_date), new Date());
    return days <= 90;
  });

  const columns = useMemo<ColumnDef<FacilityStandard>[]>(
    () => [
      {
        accessorKey: 'standard_type',
        header: '届出種別',
        cell: ({ row }) => (
          <span className="text-sm font-medium">{row.original.standard_type}</span>
        ),
      },
      {
        accessorKey: 'filed_date',
        header: '届出日',
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {format(parseISO(row.original.filed_date), 'yyyy/MM/dd', { locale: ja })}
          </span>
        ),
      },
      {
        id: 'requirements',
        header: '要件充足',
        cell: ({ row }) => getRequirementBadge(row.original.requirements_status),
      },
      {
        accessorKey: 'expiry_date',
        header: '有効期限',
        cell: ({ row }) => <ExpiryCell expiryDate={row.original.expiry_date} />,
      },
      {
        accessorKey: 'claim_status',
        header: '算定可否',
        cell: ({ row }) => <ClaimStatusBadge status={row.original.claim_status} />,
      },
    ],
    [],
  );

  if (isError) {
    // 取得失敗時は空データから誤った「判定」を出さず(false-judgement 回避)、再読み込み導線を示す。
    return (
      <div className="space-y-4">
        <ErrorState
          size="inline"
          description="施設基準を取得できませんでした。時間をおいて再読み込みしてください。"
          onRetry={() => void refetch()}
          retryLabel="再読み込み"
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section
        aria-label="施設基準の判定サマリー"
        className="rounded-lg border border-border/70 bg-card p-4"
      >
        <div className="flex flex-col gap-2 border-b border-border/60 pb-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-base font-bold text-foreground">今日の判定</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              届出一覧を開いた時点で、算定可否と足りない証跡を先に確認します。
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            className="min-h-11 w-full sm:w-auto"
            onClick={() => {
              document
                .querySelector('[data-testid="facility-criteria-checklist"]')
                ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
          >
            不足項目へ移動
          </Button>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-border/70 bg-background px-4 py-3">
            <p className="text-xs font-medium text-muted-foreground">算定可否</p>
            <div className="mt-2 flex items-center gap-2">
              <ClaimStatusBadge status={claimSummaryStatus} />
              <span className="text-lg font-bold text-foreground">
                {isLoading
                  ? '読込中'
                  : isStandardsTruncated
                    ? '表示中のみ判定'
                    : criteriaSummary.statusLabel}
              </span>
            </div>
          </div>

          <div className="rounded-lg border border-border/70 bg-background px-4 py-3">
            <p className="text-xs font-medium text-muted-foreground">不足・確認中</p>
            <p className="mt-2 text-lg font-bold text-foreground">
              {isLoading
                ? '確認しています'
                : criteriaSummary.missingCount > 0
                  ? `${criteriaSummary.missingCount}件不足`
                  : criteriaSummary.checkingCount > 0
                    ? `${criteriaSummary.checkingCount}件確認中`
                    : '不足なし'}
            </p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              OK {criteriaSummary.okCount}/{criteriaSummary.totalCount}
              {criteriaSummary.missingLabels.length > 0
                ? ` / ${criteriaSummary.missingLabels.join('、')}`
                : ''}
            </p>
          </div>

          <div className="rounded-lg border border-border/70 bg-background px-4 py-3">
            <p className="text-xs font-medium text-muted-foreground">次にすること</p>
            <p className="mt-2 text-sm leading-6 text-foreground">
              {isLoading
                ? '施設基準の届出を取得しています。'
                : isStandardsTruncated
                  ? `非表示の届出が${hiddenStandardsCount.toLocaleString()}件あります。表示中の届出だけで算定可否を判断しないでください。`
                  : criteriaSummary.nextAction}
            </p>
          </div>
        </div>
      </section>

      {/* Alert banner */}
      {(isStandardsTruncated ||
        alertItems.length > 0 ||
        standards.some((item) => item.claim_status === 'blocked')) && (
        <div className="flex items-start gap-3 rounded-md border-l-4 border-border/70 border-l-state-confirm bg-card px-4 py-3 text-sm text-state-confirm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-medium">確認が必要な施設基準届出があります</p>
            <ul className="mt-1 list-inside list-disc text-state-confirm">
              {isStandardsTruncated ? (
                <li>
                  {`非表示の届出が${hiddenStandardsCount.toLocaleString()}件あります。判定は表示中の届出に限定されています。`}
                </li>
              ) : null}
              {standards
                .filter((item) => item.claim_status === 'blocked')
                .map((item) => (
                  <li key={`${item.id}:blocked`}>
                    {item.standard_type} — 要件未達のため加算算定不可
                  </li>
                ))}
              {alertItems.map((s) => {
                const days = differenceInDays(parseISO(s.expiry_date!), new Date());
                return (
                  <li key={s.id}>
                    {s.standard_type} — {days < 0 ? '期限切れ' : `残${days}日`}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">届出一覧</CardTitle>
          {standardsListSummary ? (
            <p className="text-sm text-muted-foreground">{standardsListSummary}</p>
          ) : null}
        </CardHeader>
        <CardContent className="p-0">
          <DataTable
            columns={columns}
            data={standards}
            isLoading={isLoading}
            caption="施設基準届出一覧"
          />
        </CardContent>
      </Card>

      {/* p1_08: 施設基準チェック(要件達成状態の OK/不足/確認中)+足りないものガイド */}
      <FacilityCriteriaChecklist
        registrations={standards}
        onAddDocument={() => {
          document
            .querySelector('[data-testid="facility-standards-form"], form')
            ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }}
      />
    </div>
  );
}
