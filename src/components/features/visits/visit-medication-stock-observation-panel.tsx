'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  CloudOff,
  LockKeyhole,
  RefreshCcw,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SkeletonRows } from '@/components/ui/loading';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { readApiJson } from '@/lib/api/client-json';
import { buildOrgHeaders } from '@/lib/api/org-headers';
import { useNetworkOnline } from '@/lib/hooks/use-network-online';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { createClientIdempotencyKey } from '@/lib/idempotency/client-key';
import { buildPatientMedicationStockApiPath } from '@/lib/patient/api-paths';
import { cn } from '@/lib/utils';
import type {
  MedicationStockRiskLevelDto,
  PatientMedicationStockItemDto,
  PatientMedicationStockSummaryResponse,
  VisitMedicationStockObservationDraft,
  VisitMedicationStockObservationDraftErrors,
  VisitMedicationStockObservationKindDto,
  VisitMedicationStockObservationSourcePreset,
  VisitMedicationStockUnobservedReasonCode,
} from '@/types/medication-stock';

type VisitMedicationStockObservationPanelProps = {
  patientId: string | null | undefined;
  className?: string;
  itemLimit?: number;
  writeEnabled?: boolean;
  drafts?: readonly VisitMedicationStockObservationDraft[];
  onDraftsChange?: (drafts: VisitMedicationStockObservationDraft[]) => void;
  validationErrors?: VisitMedicationStockObservationDraftErrors;
  submissionState?: VisitMedicationStockObservationSubmissionState;
  onRetrySubmission?: () => void;
};

export type VisitMedicationStockObservationSubmissionState = {
  status: 'idle' | 'saving' | 'error' | 'conflict' | 'unavailable';
  message?: string;
};

const SUMMARY_FRESHNESS_MS = 5 * 60 * 1000;

const OBSERVATION_KIND_LABELS: Record<VisitMedicationStockObservationKindDto, string> = {
  observed_absolute: '今回残数',
  usage_delta: '使用量',
  usage_frequency: '使用頻度',
  not_observed: '未確認',
  refill_request: '補充依頼',
};

const SOURCE_PRESET_LABELS: Record<VisitMedicationStockObservationSourcePreset, string> = {
  pharmacist_counted: '薬剤師が直接確認',
  patient_reported: '患者本人から申告',
  caregiver_reported: '家族・介護者から申告',
  facility_staff_reported: '施設職員から申告',
  other_institution_record: '他院記録で確認',
};

const UNOBSERVED_REASON_LABELS: Record<VisitMedicationStockUnobservedReasonCode, string> = {
  patient_refused: '患者が確認を希望しなかった',
  caregiver_unavailable: '家族・介護者が不在',
  storage_inaccessible: '保管場所を確認できなかった',
  medication_not_present: '薬剤がその場になかった',
  identity_uncertain: '薬剤を特定できなかった',
  visit_time_limited: '訪問時間内に確認できなかった',
  safety_priority: '他の安全対応を優先した',
  other_institution_unconfirmed: '他院薬の確認が取れなかった',
  unknown: '理由を特定できなかった',
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
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const dateFormatter = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
});

const quantityDifferenceFormatter = new Intl.NumberFormat('ja-JP', {
  maximumFractionDigits: 4,
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
  if (value == null || !Number.isFinite(value)) return '不明';
  return `${value}${unit}`;
}

function formatDailyUsage(value: number | null | undefined, unit: string) {
  if (value == null || !Number.isFinite(value)) return '不明';
  return `${value}${unit}/日`;
}

export function formatStockLedgerDifference(
  currentQuantity: number | null | undefined,
  priorRecordedQuantity: number | null | undefined,
  unit: string,
) {
  if (
    currentQuantity == null ||
    priorRecordedQuantity == null ||
    !Number.isFinite(currentQuantity) ||
    !Number.isFinite(priorRecordedQuantity)
  ) {
    return '算出不可';
  }

  const difference = Math.round((currentQuantity - priorRecordedQuantity) * 10_000) / 10_000;
  const magnitude = `${quantityDifferenceFormatter.format(Math.abs(difference))}${unit}`;
  if (difference > 0) return `+${magnitude}（増加）`;
  if (difference < 0) return `-${magnitude}（減少）`;
  return `${magnitude}（変化なし）`;
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

function createObservationDraft(
  item: PatientMedicationStockItemDto,
  kind: VisitMedicationStockObservationKindDto,
): VisitMedicationStockObservationDraft {
  return {
    client_observation_id: createClientIdempotencyKey('vso'),
    stock_item_id: item.id,
    unit: item.unit,
    kind,
    quantity_input: '',
    used_quantity_input: '',
    usage_quantity_input: '',
    usage_period_days_input: '',
    last_used_date: '',
    unobserved_reason_code: '',
    source_preset: '',
  };
}

function resetKindFields(
  draft: VisitMedicationStockObservationDraft,
  kind: VisitMedicationStockObservationKindDto,
): VisitMedicationStockObservationDraft {
  return {
    ...draft,
    kind,
    quantity_input: '',
    used_quantity_input: '',
    usage_quantity_input: '',
    usage_period_days_input: '',
    last_used_date: kind === 'not_observed' ? '' : draft.last_used_date,
    unobserved_reason_code: '',
  };
}

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null;
  return (
    <p id={id} className="text-xs text-destructive" role="alert">
      {message}
    </p>
  );
}

function MedicationStockItemCard({
  item,
  draft,
  errors,
  disabledReason,
  removalDisabled,
  onDraftChange,
  onDraftRemove,
}: {
  item: PatientMedicationStockItemDto;
  draft: VisitMedicationStockObservationDraft | undefined;
  errors: VisitMedicationStockObservationDraftErrors[string] | undefined;
  disabledReason: string | null;
  removalDisabled: boolean;
  onDraftChange: (draft: VisitMedicationStockObservationDraft) => void;
  onDraftRemove: () => void;
}) {
  const snapshot = item.snapshot;
  const riskLevel = snapshot?.stock_risk_level ?? 'unknown';
  const categoryLabel = CATEGORY_LABELS[item.medication_category] ?? item.medication_category;
  const sourceLabel = SOURCE_LABELS[item.source_type] ?? item.source_type;
  const managingPartyLabel = MANAGING_PARTY_LABELS[item.managing_party] ?? item.managing_party;
  const editorId = `visit-medication-stock-observation-${item.id}`;
  const controlsDisabled = Boolean(disabledReason);

  function updateDraft(patch: Partial<VisitMedicationStockObservationDraft>) {
    if (!draft) return;
    onDraftChange({ ...draft, ...patch });
  }

  function changeKind(value: VisitMedicationStockObservationKindDto | 'none') {
    if (value === 'none') {
      onDraftRemove();
      return;
    }
    onDraftChange(draft ? resetKindFields(draft, value) : createObservationDraft(item, value));
  }

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

      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <div className="rounded-md bg-muted/40 p-2">
          <dt className="text-xs text-muted-foreground">前回の記録残数</dt>
          <dd className="font-medium tabular-nums text-foreground">
            {snapshot
              ? `${formatQuantity(snapshot.last_observed_quantity, item.unit)} / ${formatDateTime(
                  snapshot.last_observed_at,
                )}`
              : '未確認'}
          </dd>
        </div>
        <div className="rounded-md bg-muted/40 p-2">
          <dt className="text-xs text-muted-foreground">台帳計算残数（参考）</dt>
          <dd className="font-medium tabular-nums text-foreground">
            {snapshot ? formatQuantity(snapshot.current_quantity, item.unit) : 'snapshot未作成'}
          </dd>
          <p className="mt-1 text-xs text-muted-foreground">
            算出日時:{' '}
            <span className="tabular-nums">{formatDateTime(snapshot?.calculated_at)}</span>
          </p>
        </div>
        <div className="rounded-md bg-muted/40 p-2">
          <dt className="text-xs text-muted-foreground">前回記録以降の台帳差分</dt>
          <dd className="font-medium tabular-nums text-foreground">
            {snapshot
              ? formatStockLedgerDifference(
                  snapshot.current_quantity,
                  snapshot.last_observed_quantity,
                  item.unit,
                )
              : '算出不可'}
          </dd>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            台帳計算残数 − 前回の記録残数。今回の実測ではありません。
          </p>
        </div>
        <div className="rounded-md bg-muted/40 p-2">
          <dt className="text-xs text-muted-foreground">推定使用量</dt>
          <dd className="font-medium tabular-nums text-foreground">
            {snapshot ? formatDailyUsage(snapshot.estimated_daily_usage, item.unit) : '不明'}
          </dd>
        </div>
        <div className="rounded-md bg-muted/40 p-2">
          <dt className="text-xs text-muted-foreground">推定切れ日</dt>
          <dd className="font-medium tabular-nums text-foreground">
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

      <div className="mt-3 space-y-3 rounded-md border border-border/80 bg-muted/20 p-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 flex-1 space-y-1.5">
            <Label htmlFor={`${editorId}-kind`} className="text-xs">
              今回の観測
            </Label>
            <Select
              value={draft?.kind ?? 'none'}
              onValueChange={(value) =>
                changeKind(value as VisitMedicationStockObservationKindDto | 'none')
              }
              disabled={controlsDisabled}
            >
              <SelectTrigger
                id={`${editorId}-kind`}
                className="min-h-11 w-full sm:max-w-xs"
                aria-describedby={disabledReason ? `${editorId}-disabled-reason` : undefined}
              >
                <SelectValue>
                  {draft ? OBSERVATION_KIND_LABELS[draft.kind] : '記録しない'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent align="start">
                <SelectItem value="none" className="min-h-11">
                  記録しない
                </SelectItem>
                {Object.entries(OBSERVATION_KIND_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value} className="min-h-11">
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {draft ? (
            <Button
              type="button"
              variant="outline"
              className="min-h-11 shrink-0"
              disabled={removalDisabled}
              onClick={onDraftRemove}
            >
              入力を取り消す
            </Button>
          ) : null}
        </div>

        {disabledReason ? (
          <p id={`${editorId}-disabled-reason`} className="text-xs text-muted-foreground">
            {disabledReason}
          </p>
        ) : !draft ? (
          <p className="text-xs text-muted-foreground">
            観測種別を選ぶと入力欄が開きます。選択した項目だけを訪問記録保存後に登録します。
          </p>
        ) : null}

        {draft ? (
          <div className="space-y-3 border-t border-border/70 pt-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {draft.kind === 'observed_absolute' ? (
                <div className="space-y-1.5">
                  <Label htmlFor={`${editorId}-quantity`} className="text-xs">
                    今回残数（{item.unit}）
                  </Label>
                  <Input
                    id={`${editorId}-quantity`}
                    type="number"
                    min={0}
                    step="any"
                    inputMode="decimal"
                    value={draft.quantity_input}
                    onChange={(event) => updateDraft({ quantity_input: event.target.value })}
                    disabled={controlsDisabled}
                    aria-invalid={Boolean(errors?.quantity_input)}
                    aria-describedby={
                      errors?.quantity_input ? `${editorId}-quantity-error` : undefined
                    }
                    className="min-h-11"
                  />
                  <FieldError id={`${editorId}-quantity-error`} message={errors?.quantity_input} />
                </div>
              ) : null}

              {draft.kind === 'usage_delta' ? (
                <div className="space-y-1.5">
                  <Label htmlFor={`${editorId}-used-quantity`} className="text-xs">
                    今回使用量（{item.unit}）
                  </Label>
                  <Input
                    id={`${editorId}-used-quantity`}
                    type="number"
                    min={0}
                    step="any"
                    inputMode="decimal"
                    value={draft.used_quantity_input}
                    onChange={(event) => updateDraft({ used_quantity_input: event.target.value })}
                    disabled={controlsDisabled}
                    aria-invalid={Boolean(errors?.used_quantity_input)}
                    aria-describedby={
                      errors?.used_quantity_input ? `${editorId}-used-quantity-error` : undefined
                    }
                    className="min-h-11"
                  />
                  <FieldError
                    id={`${editorId}-used-quantity-error`}
                    message={errors?.used_quantity_input}
                  />
                </div>
              ) : null}

              {draft.kind === 'usage_frequency' ? (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor={`${editorId}-usage-quantity`} className="text-xs">
                      使用量（{item.unit}）
                    </Label>
                    <Input
                      id={`${editorId}-usage-quantity`}
                      type="number"
                      min={0}
                      step="any"
                      inputMode="decimal"
                      value={draft.usage_quantity_input}
                      onChange={(event) =>
                        updateDraft({ usage_quantity_input: event.target.value })
                      }
                      disabled={controlsDisabled}
                      aria-invalid={Boolean(errors?.usage_quantity_input)}
                      aria-describedby={
                        errors?.usage_quantity_input
                          ? `${editorId}-usage-quantity-error`
                          : undefined
                      }
                      className="min-h-11"
                    />
                    <FieldError
                      id={`${editorId}-usage-quantity-error`}
                      message={errors?.usage_quantity_input}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`${editorId}-usage-days`} className="text-xs">
                      使用期間（日）
                    </Label>
                    <Input
                      id={`${editorId}-usage-days`}
                      type="number"
                      min={1}
                      max={366}
                      step={1}
                      inputMode="numeric"
                      value={draft.usage_period_days_input}
                      onChange={(event) =>
                        updateDraft({ usage_period_days_input: event.target.value })
                      }
                      disabled={controlsDisabled}
                      aria-invalid={Boolean(errors?.usage_period_days_input)}
                      aria-describedby={
                        errors?.usage_period_days_input ? `${editorId}-usage-days-error` : undefined
                      }
                      className="min-h-11"
                    />
                    <FieldError
                      id={`${editorId}-usage-days-error`}
                      message={errors?.usage_period_days_input}
                    />
                  </div>
                </>
              ) : null}

              {draft.kind === 'not_observed' ? (
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor={`${editorId}-unobserved-reason`} className="text-xs">
                    未確認理由
                  </Label>
                  <Select
                    value={draft.unobserved_reason_code || null}
                    onValueChange={(value) =>
                      updateDraft({
                        unobserved_reason_code: value as VisitMedicationStockUnobservedReasonCode,
                      })
                    }
                    disabled={controlsDisabled}
                  >
                    <SelectTrigger
                      id={`${editorId}-unobserved-reason`}
                      className="min-h-11 w-full"
                      aria-invalid={Boolean(errors?.unobserved_reason_code)}
                      aria-describedby={
                        errors?.unobserved_reason_code
                          ? `${editorId}-unobserved-reason-error`
                          : undefined
                      }
                    >
                      <SelectValue>
                        {draft.unobserved_reason_code
                          ? UNOBSERVED_REASON_LABELS[draft.unobserved_reason_code]
                          : '理由を選択'}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent align="start">
                      {Object.entries(UNOBSERVED_REASON_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value} className="min-h-11">
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldError
                    id={`${editorId}-unobserved-reason-error`}
                    message={errors?.unobserved_reason_code}
                  />
                </div>
              ) : null}

              {draft.kind !== 'not_observed' ? (
                <div className="space-y-1.5">
                  <Label htmlFor={`${editorId}-last-used-date`} className="text-xs">
                    最終使用日（任意）
                  </Label>
                  <Input
                    id={`${editorId}-last-used-date`}
                    type="date"
                    value={draft.last_used_date}
                    onChange={(event) => updateDraft({ last_used_date: event.target.value })}
                    disabled={controlsDisabled}
                    aria-invalid={Boolean(errors?.last_used_date)}
                    aria-describedby={
                      errors?.last_used_date ? `${editorId}-last-used-date-error` : undefined
                    }
                    className="min-h-11"
                  />
                  <FieldError
                    id={`${editorId}-last-used-date-error`}
                    message={errors?.last_used_date}
                  />
                </div>
              ) : null}

              <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
                <Label htmlFor={`${editorId}-source`} className="text-xs">
                  確認元
                </Label>
                <Select
                  value={draft.source_preset || null}
                  onValueChange={(value) =>
                    updateDraft({
                      source_preset: value as VisitMedicationStockObservationSourcePreset,
                    })
                  }
                  disabled={controlsDisabled}
                >
                  <SelectTrigger
                    id={`${editorId}-source`}
                    className="min-h-11 w-full"
                    aria-invalid={Boolean(errors?.source_preset)}
                    aria-describedby={
                      errors?.source_preset ? `${editorId}-source-error` : undefined
                    }
                  >
                    <SelectValue>
                      {draft.source_preset
                        ? SOURCE_PRESET_LABELS[draft.source_preset]
                        : '確認元を選択'}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent align="start">
                    {Object.entries(SOURCE_PRESET_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value} className="min-h-11">
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError id={`${editorId}-source-error`} message={errors?.source_preset} />
              </div>
            </div>

            {draft.kind === 'refill_request' ? (
              <p className="rounded-md border border-state-confirm/30 bg-state-confirm/10 p-3 text-xs text-state-confirm">
                補充依頼として記録します。数量は自動加算せず、残数不足の確認タスクへ接続します。
              </p>
            ) : null}
          </div>
        ) : null}
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
  writeEnabled = false,
  drafts = [],
  onDraftsChange,
  validationErrors = {},
  submissionState = { status: 'idle' },
  onRetrySubmission,
}: VisitMedicationStockObservationPanelProps) {
  const orgId = useOrgId();
  const isOnline = useNetworkOnline();
  const [now, setNow] = useState(() => Date.now());
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
  const generatedAtTime = summary?.meta.generated_at
    ? new Date(summary.meta.generated_at).getTime()
    : Number.NaN;
  const summaryIsStale = Boolean(
    summary && (!Number.isFinite(generatedAtTime) || now - generatedAtTime > SUMMARY_FRESHNESS_MS),
  );
  const submissionLocked = submissionState.status !== 'idle';

  useEffect(() => {
    if (!summary) return;
    const interval = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, [summary]);

  function replaceDraft(nextDraft: VisitMedicationStockObservationDraft) {
    if (!onDraftsChange) return;
    const existingIndex = drafts.findIndex(
      (draft) => draft.stock_item_id === nextDraft.stock_item_id,
    );
    if (existingIndex < 0) {
      onDraftsChange([...drafts, nextDraft]);
      return;
    }
    onDraftsChange(drafts.map((draft, index) => (index === existingIndex ? nextDraft : draft)));
  }

  function removeDraft(stockItemId: string) {
    onDraftsChange?.(drafts.filter((draft) => draft.stock_item_id !== stockItemId));
  }

  const panelDisabledReason =
    !writeEnabled || !onDraftsChange
      ? '正本DBの適用・検証が完了し、この環境の書き込みゲートが有効になるまで登録できません。'
      : submissionLocked
        ? '訪問記録と残数観測を保存中、または同じ内容での再試行待ちです。結果を確認するまで入力を変更できません。'
        : !isOnline
          ? '残数観測はオフライン同期に未対応です。通信復帰後に残数情報を再取得して登録してください。'
          : stockQuery.isLoading || stockQuery.isError || !summary
            ? '残数情報を正常に取得できるまで登録できません。'
            : partialFailureCount > 0
              ? '残数情報が一部取得失敗のため登録できません。再取得してください。'
              : summaryIsStale
                ? '残数情報が古いため登録できません。最新情報を再取得してください。'
                : null;

  const headerStatus = !writeEnabled ? (
    <Badge variant="outline" className="w-fit gap-1 text-xs text-muted-foreground">
      <LockKeyhole className="size-3" aria-hidden="true" />
      登録無効
    </Badge>
  ) : !isOnline ? (
    <Badge variant="outline" className="w-fit gap-1 text-xs text-muted-foreground">
      <CloudOff className="size-3" aria-hidden="true" />
      オフライン送信不可
    </Badge>
  ) : panelDisabledReason ? (
    <Badge
      variant="outline"
      className="w-fit gap-1 border-state-confirm/40 text-xs text-state-confirm"
    >
      <AlertTriangle className="size-3" aria-hidden="true" />
      登録前確認
    </Badge>
  ) : (
    <Badge variant="outline" className="w-fit gap-1 border-state-done/40 text-xs text-state-done">
      <CheckCircle2 className="size-3" aria-hidden="true" />
      訪問記録と同時登録
    </Badge>
  );

  return (
    <Card
      id="visit-medication-stock-observation-panel"
      className={cn('border-border/70 bg-card', className)}
    >
      <CardHeader className="space-y-3 pb-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <h3 className="flex items-center gap-2 font-heading text-sm leading-snug font-semibold text-foreground">
              <ClipboardCheck className="size-4 text-muted-foreground" aria-hidden="true" />
              外用・頓服 残数観測
            </h3>
            <p className="text-xs leading-relaxed text-muted-foreground">
              現在の残数情報を根拠に観測内容を入力し、訪問記録の保存後に正本の残数台帳へ登録します。
            </p>
          </div>
          {headerStatus}
        </div>

        <div
          className={cn(
            'rounded-md border p-3 text-xs leading-relaxed',
            panelDisabledReason
              ? 'border-state-confirm/30 bg-state-confirm/10 text-state-confirm'
              : 'border-border/70 bg-muted/30 text-muted-foreground',
          )}
        >
          {panelDisabledReason ??
            '観測種別と確認元を入力してください。選択した観測だけを訪問記録保存後に登録し、登録完了後に画面遷移します。'}
          {!writeEnabled ? (
            <span className="mt-1 block">
              従来の残薬記録はこの下の「残薬記録」から引き続き入力できます。
            </span>
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {submissionState.status !== 'idle' ? (
          <div
            className={cn(
              'flex flex-col gap-3 rounded-md border p-3 text-sm sm:flex-row sm:items-center sm:justify-between',
              submissionState.status === 'saving'
                ? 'border-border bg-muted/30 text-muted-foreground'
                : 'border-destructive/40 bg-destructive/5 text-destructive',
            )}
            role={submissionState.status === 'saving' ? 'status' : 'alert'}
            aria-live={submissionState.status === 'saving' ? 'polite' : undefined}
          >
            <div className="flex min-w-0 items-start gap-2">
              {submissionState.status === 'saving' ? (
                <RefreshCcw className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              ) : (
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              )}
              <p>
                {submissionState.message ??
                  (submissionState.status === 'saving'
                    ? '訪問記録と残数観測を保存しています。'
                    : '残数観測を登録できませんでした。入力内容を保持しています。')}
              </p>
            </div>
            {submissionState.status !== 'saving' && onRetrySubmission ? (
              <Button
                type="button"
                variant="outline"
                className="min-h-11 shrink-0"
                disabled={!isOnline}
                onClick={onRetrySubmission}
              >
                同じ内容で再試行
              </Button>
            ) : null}
          </div>
        ) : null}

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
              {summaryIsStale ? (
                <Badge variant="outline" className="border-state-confirm/40 text-state-confirm">
                  5分以上前の情報
                </Badge>
              ) : null}
              {!isOnline ? (
                <Badge variant="outline" className="gap-1 text-xs text-muted-foreground">
                  <RefreshCcw className="size-3" aria-hidden="true" />
                  オフライン表示
                </Badge>
              ) : null}
              {(summaryIsStale || partialFailureCount > 0) && isOnline ? (
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 gap-2"
                  disabled={stockQuery.isFetching}
                  onClick={() => void stockQuery.refetch()}
                >
                  <RefreshCcw className="size-4" aria-hidden="true" />
                  最新情報を取得
                </Button>
              ) : null}
            </div>
            <div className="space-y-3">
              {items.map((item) => {
                const draft = drafts.find((candidate) => candidate.stock_item_id === item.id);
                const draftErrors = draft
                  ? (validationErrors[draft.client_observation_id] ?? validationErrors[item.id])
                  : validationErrors[item.id];
                const itemDisabledReason = !item.active
                  ? '停止中の残数管理対象には観測を登録できません。'
                  : item.equivalence_review_status !== 'none'
                    ? '薬剤の名寄せ確認が完了するまで観測を登録できません。'
                    : panelDisabledReason;
                return (
                  <MedicationStockItemCard
                    key={item.id}
                    item={item}
                    draft={draft}
                    errors={draftErrors}
                    disabledReason={itemDisabledReason}
                    removalDisabled={submissionLocked}
                    onDraftChange={replaceDraft}
                    onDraftRemove={() => removeDraft(item.id)}
                  />
                );
              })}
            </div>
          </>
        )}

        <div className="flex items-start gap-2 rounded-md bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-state-confirm" aria-hidden="true" />
          <p>
            推定切れ日とリスクは残数管理snapshotの参考表示です。残数観測は訪問記録本体とは別のappend-only記録として登録し、失敗時は訪問記録が保存済みで残数観測が未登録であることを明示して、この画面で再試行を求めます。
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
