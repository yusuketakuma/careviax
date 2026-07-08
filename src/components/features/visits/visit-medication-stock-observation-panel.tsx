'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ClipboardCheck, LockKeyhole, RefreshCcw } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SkeletonRows } from '@/components/ui/loading';
import { readApiJson } from '@/lib/api/client-json';
import { buildOrgHeaders } from '@/lib/api/org-headers';
import { useNetworkOnline } from '@/lib/hooks/use-network-online';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { buildPatientMedicationStockApiPath } from '@/lib/patient/api-paths';
import { cn } from '@/lib/utils';
import type {
  MedicationStockRiskLevelDto,
  PatientMedicationStockItemDto,
  PatientMedicationStockSummaryResponse,
} from '@/types/medication-stock';

type VisitMedicationStockObservationPanelProps = {
  patientId: string | null | undefined;
  className?: string;
  itemLimit?: number;
};

const RISK_META = {
  ok: {
    label: '十分',
    className: 'border-transparent bg-state-done/10 text-state-done',
  },
  watch: {
    label: '確認',
    className: 'border-transparent bg-state-confirm/10 text-state-confirm',
  },
  shortage_expected: {
    label: '不足見込み',
    className: 'border-transparent bg-state-confirm/10 text-state-confirm',
  },
  urgent: {
    label: '至急',
    className: 'border-transparent bg-destructive/10 text-destructive',
  },
  unknown: {
    label: '不明',
    className: 'border-border text-muted-foreground',
  },
} satisfies Record<MedicationStockRiskLevelDto, { label: string; className: string }>;

const CATEGORY_LABELS: Record<string, string> = {
  prn: '頓服',
  topical: '外用',
  external: '外用',
  regular_leftover: '定期残薬',
  otc: 'OTC',
  other: 'その他',
};

const SOURCE_LABELS: Record<string, string> = {
  prescription: '処方',
  initial_leftover: '初回残薬',
  other_institution: '他院',
  otc: 'OTC',
  manual: '手入力',
  unknown: '不明',
};

const MANAGING_PARTY_LABELS: Record<string, string> = {
  patient: '患者管理',
  family: '家族管理',
  facility: '施設管理',
  pharmacy: '薬局管理',
  unknown: '管理者不明',
};

const dateTimeFormatter = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const dateFormatter = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  month: 'numeric',
  day: 'numeric',
});

function formatDateTime(value: string | null | undefined) {
  if (!value) return '未確認';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '未確認';
  return dateTimeFormatter.format(date);
}

function formatDate(value: string | null | undefined) {
  if (!value) return '推定不可';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '推定不可';
  return dateFormatter.format(date);
}

function formatQuantity(value: number | null | undefined, unit: string) {
  if (value == null) return '不明';
  return `${value}${unit}`;
}

function formatDailyUsage(value: number | null | undefined, unit: string) {
  if (value == null) return '不明';
  return `${value}${unit}/日`;
}

function buildMedicationStockPath(patientId: string, itemLimit: number) {
  const params = new URLSearchParams({
    item_limit: String(itemLimit),
    event_limit: '0',
  });
  return `${buildPatientMedicationStockApiPath(patientId)}?${params.toString()}`;
}

async function fetchMedicationStockSummary({
  patientId,
  orgId,
  itemLimit,
}: {
  patientId: string;
  orgId: string;
  itemLimit: number;
}) {
  const response = await fetch(buildMedicationStockPath(patientId, itemLimit), {
    headers: buildOrgHeaders(orgId),
  });
  return readApiJson<PatientMedicationStockSummaryResponse>(
    response,
    '患者の残数管理情報の取得に失敗しました',
  );
}

function MedicationStockRiskBadge({ riskLevel }: { riskLevel: MedicationStockRiskLevelDto }) {
  const meta = RISK_META[riskLevel] ?? RISK_META.unknown;
  return (
    <Badge variant="outline" className={cn('text-xs', meta.className)}>
      {meta.label}
    </Badge>
  );
}

function MedicationStockItemCard({ item }: { item: PatientMedicationStockItemDto }) {
  const snapshot = item.snapshot;
  const riskLevel = snapshot?.stock_risk_level ?? 'unknown';
  const categoryLabel = CATEGORY_LABELS[item.medication_category] ?? item.medication_category;
  const sourceLabel = SOURCE_LABELS[item.source_type] ?? item.source_type;
  const managingPartyLabel = MANAGING_PARTY_LABELS[item.managing_party] ?? item.managing_party;
  const quantityInputId = `visit-medication-stock-observation-${item.id}`;

  return (
    <div className="rounded-lg border border-border/70 bg-card p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-semibold text-foreground">{item.display_name}</h4>
            <MedicationStockRiskBadge riskLevel={riskLevel} />
            {!item.active ? (
              <Badge variant="outline" className="text-xs text-muted-foreground">
                停止中
              </Badge>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
            <span>{categoryLabel}</span>
            <span aria-hidden="true">/</span>
            <span>{sourceLabel}</span>
            <span aria-hidden="true">/</span>
            <span>{managingPartyLabel}</span>
            {item.route ? (
              <>
                <span aria-hidden="true">/</span>
                <span>{item.route}</span>
              </>
            ) : null}
          </div>
        </div>
        {item.equivalence_review_status !== 'none' ? (
          <Badge variant="outline" className="text-xs">
            名寄せ確認: {item.equivalence_review_status}
          </Badge>
        ) : null}
      </div>

      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-md bg-muted/40 p-2">
          <dt className="text-xs text-muted-foreground">現在推定残数</dt>
          <dd className="font-medium text-foreground">
            {snapshot ? formatQuantity(snapshot.current_quantity, item.unit) : 'snapshot未作成'}
          </dd>
        </div>
        <div className="rounded-md bg-muted/40 p-2">
          <dt className="text-xs text-muted-foreground">前回実測</dt>
          <dd className="font-medium text-foreground">
            {snapshot
              ? `${formatQuantity(snapshot.last_observed_quantity, item.unit)} / ${formatDateTime(
                  snapshot.last_observed_at,
                )}`
              : '未確認'}
          </dd>
        </div>
        <div className="rounded-md bg-muted/40 p-2">
          <dt className="text-xs text-muted-foreground">推定使用量</dt>
          <dd className="font-medium text-foreground">
            {snapshot ? formatDailyUsage(snapshot.estimated_daily_usage, item.unit) : '不明'}
          </dd>
        </div>
        <div className="rounded-md bg-muted/40 p-2">
          <dt className="text-xs text-muted-foreground">推定切れ日</dt>
          <dd className="font-medium text-foreground">
            {snapshot
              ? `${formatDate(snapshot.estimated_stockout_date)}${
                  snapshot.days_until_stockout != null
                    ? ` / あと${snapshot.days_until_stockout}日`
                    : ''
                }`
              : '推定不可'}
          </dd>
        </div>
      </dl>

      <div className="mt-3 grid gap-3 rounded-md border border-dashed border-border/80 bg-muted/20 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
        <div className="space-y-1.5">
          <Label htmlFor={quantityInputId} className="text-xs">
            今回確認した残数
          </Label>
          <Input
            id={quantityInputId}
            type="number"
            min={0}
            step={0.5}
            placeholder="DB連携レビュー待ち"
            disabled
            aria-describedby={`${quantityInputId}-description`}
            className="min-h-11"
          />
          <p id={`${quantityInputId}-description`} className="text-xs text-muted-foreground">
            この欄は正本DB連携の承認後に有効化します。
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${quantityInputId}-reason`} className="text-xs">
            未確認理由
          </Label>
          <select
            id={`${quantityInputId}-reason`}
            disabled
            className="min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60"
          >
            <option>DB連携レビュー待ち</option>
          </select>
        </div>
        <Button type="button" variant="outline" disabled className="min-h-11 gap-2">
          <LockKeyhole className="size-4" aria-hidden="true" />
          反映待ち
        </Button>
      </div>
    </div>
  );
}

function MedicationStockPanelSkeleton() {
  return (
    <div role="status" aria-label="残数管理情報を読み込み中" className="space-y-3">
      <SkeletonRows rows={2} cols={3} status={false} />
      <span className="sr-only">残数管理情報を読み込み中</span>
    </div>
  );
}

export function VisitMedicationStockObservationPanel({
  patientId,
  className,
  itemLimit = 20,
}: VisitMedicationStockObservationPanelProps) {
  const orgId = useOrgId();
  const isOnline = useNetworkOnline();
  const canFetch = Boolean(orgId && patientId && isOnline);
  const stockQuery = useQuery({
    queryKey: [
      'patient-medication-stock',
      patientId,
      orgId,
      itemLimit,
      'visit-record-observation-panel',
    ],
    queryFn: () => {
      if (!patientId || !orgId) {
        throw new Error('患者または薬局コンテキストを確認できません。');
      }
      return fetchMedicationStockSummary({
        patientId,
        orgId,
        itemLimit,
      });
    },
    enabled: canFetch,
    staleTime: 30_000,
    retry: false,
  });
  const summary = stockQuery.data;
  const items = summary?.data.items ?? [];
  const hiddenCount = summary?.meta.hidden_count ?? 0;
  const partialFailureCount = summary?.meta.partial_failures.length ?? 0;

  return (
    <Card className={cn('border-border/70 bg-card', className)}>
      <CardHeader className="space-y-3 pb-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <h3 className="flex items-center gap-2 font-heading text-sm leading-snug font-semibold text-foreground">
              <ClipboardCheck className="size-4 text-muted-foreground" aria-hidden="true" />
              外用・頓服 残数管理（参照のみ）
            </h3>
            <p className="text-xs leading-relaxed text-muted-foreground">
              残数管理APIの読取情報を訪問中の確認材料として表示します。訪問由来の残数観測登録はDB連携レビュー待ちです。
            </p>
          </div>
          <Badge variant="outline" className="w-fit gap-1 text-xs text-muted-foreground">
            <LockKeyhole className="size-3" aria-hidden="true" />
            登録無効
          </Badge>
        </div>

        <div className="rounded-md border border-state-confirm/30 bg-state-confirm/10 p-3 text-xs leading-relaxed text-state-confirm">
          下の入力欄は誤登録を防ぐため無効です。従来の残薬記録はこの下の「残薬記録」から引き続き訪問記録へ入力できます。
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {!patientId ? (
          <div className="rounded-md border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground">
            患者IDを確認できるまで残数管理情報は取得しません。
          </div>
        ) : !orgId ? (
          <div className="rounded-md border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground">
            薬局コンテキストを確認できるまで残数管理情報は取得しません。
          </div>
        ) : !isOnline && !summary ? (
          <div className="rounded-md border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground">
            オフライン中のため残数管理情報を取得できません。通信復帰後に再取得してください。
          </div>
        ) : stockQuery.isLoading ? (
          <MedicationStockPanelSkeleton />
        ) : stockQuery.isError ? (
          <ErrorState
            variant="server"
            size="inline"
            live="polite"
            title="残数管理情報を取得できませんでした"
            description={
              stockQuery.error instanceof Error
                ? stockQuery.error.message
                : '通信状態を確認して再試行してください。'
            }
            onRetry={() => void stockQuery.refetch()}
            retryLabel="残数情報を再取得"
            retryVariant="outline"
            className="py-6"
          />
        ) : items.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground">
            {hiddenCount > 0
              ? `表示可能な残数管理項目はありません。取得上限または権限により ${hiddenCount} 件が非表示です。`
              : '残数管理台帳に表示できる薬剤はまだありません。'}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>
                最終取得: {formatDateTime(summary?.meta.generated_at)}
                {stockQuery.isFetching ? '（更新中）' : ''}
              </span>
              {hiddenCount > 0 ? (
                <Badge variant="outline" className="text-xs text-muted-foreground">
                  他 {hiddenCount} 件
                </Badge>
              ) : null}
              {partialFailureCount > 0 ? (
                <Badge variant="outline" className="border-state-confirm/40 text-state-confirm">
                  一部取得失敗
                </Badge>
              ) : null}
              {!isOnline ? (
                <Badge variant="outline" className="gap-1 text-xs text-muted-foreground">
                  <RefreshCcw className="size-3" aria-hidden="true" />
                  オフライン表示
                </Badge>
              ) : null}
            </div>
            <div className="space-y-3">
              {items.map((item) => (
                <MedicationStockItemCard key={item.id} item={item} />
              ))}
            </div>
          </>
        )}

        <div className="flex items-start gap-2 rounded-md bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-state-confirm" aria-hidden="true" />
          <p>
            推定切れ日とリスクは残数管理snapshotの参考表示です。訪問記録保存時に残数観測としてはまだ登録されません。
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
