'use client';

import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';

export type ProposalDiagnosticsAction = {
  label: string;
  onClick: () => void;
  variant?: 'default' | 'outline';
};

type AcceptedDiagnostic = {
  pharmacist_id: string;
  pharmacist_name?: string;
  proposed_date: string;
  route_order?: number;
  score?: number;
  travel_summary?: string;
  vehicle_resource_id?: string | null;
  vehicle_resource_label?: string | null;
  vehicle_load?: number | null;
  assignment_mode?: string;
  care_relationship?: string;
  score_breakdown?: Record<string, number>;
  time_window_start?: string | Date;
  time_window_end?: string | Date;
};

type RejectedDiagnostic = {
  pharmacist_id?: string;
  pharmacist_name?: string;
  proposed_date: string;
  reason_code?: string;
  reason_label?: string;
  detail?: string;
  availability_reason_code?: string;
};

export type ProposalGenerationDiagnosticsCardData = {
  accepted: AcceptedDiagnostic[];
  rejected: RejectedDiagnostic[];
  deadline_policy?: Array<{
    code: string;
    site_id: string | null;
    date_key?: string;
    from_date_key?: string;
    to_date_key?: string;
    value?: string | number | boolean;
  }>;
  billing_constraint_count?: number;
};

type ProposalDiagnosticsCardProps = {
  diagnostics: ProposalGenerationDiagnosticsCardData;
  title?: string;
  description?: string;
  actions?: ProposalDiagnosticsAction[];
  className?: string;
  maxRejectedItems?: number;
};

const SCORE_BREAKDOWN_LABELS: Record<string, string> = {
  geocodePenalty: '座標補正',
  facilityBonus: '施設集約',
  workloadPenalty: '担当件数',
  slackPenalty: '余白',
  lockPenalty: '固定予定',
  cadencePenalty: '算定制約',
  vehiclePenalty: '車両負荷',
  specialtyPenalty: '専門対応',
};

const DEADLINE_POLICY_LABELS: Record<string, string> = {
  deadline_raw: '服薬期限',
  deadline_adjusted_to_operating_day: '営業日へ補正',
  deadline_buffer_applied: '準備日数を確保',
  deadline_overdue_asap: '期限超過のため最短提案',
  deadline_visitability_policy_missing: '訪問可能日規則未設定',
  deadline_buffer_scan_exhausted: '準備日数内に訪問可能日なし',
  deadline_no_candidates: '期限内候補なし',
  locked_date_deadline_violation: '固定日が期限超過',
};

const AVAILABILITY_REASON_LABELS: Record<string, string> = {
  pharmacy_holiday: '薬局休業日',
  pharmacy_regular_closed: '薬局定休日',
  invalid_pharmacy_operating_window: '営業時間設定不備',
  outside_pharmacy_operating_window: '営業時間外',
  pharmacist_shift_missing: '薬剤師シフトなし',
  pharmacist_shift_site_missing: 'シフト拠点未設定',
  pharmacist_shift_site_mismatch: 'シフト拠点不一致',
  pharmacist_unavailable: '薬剤師不在',
  invalid_pharmacist_shift_window: 'シフト時間設定不備',
  invalid_visit_window: '訪問時間設定不備',
  outside_pharmacist_shift_window: 'シフト時間外',
};

function formatSignedNumber(value: number) {
  return value > 0 ? `+${value}` : `${value}`;
}

function formatTimeValue(value: string | Date | null | undefined) {
  if (!value) return null;
  if (value instanceof Date) {
    return format(value, 'HH:mm', { locale: ja });
  }
  if (/^\d{2}:\d{2}$/.test(value)) {
    return value;
  }
  try {
    return format(parseISO(value), 'HH:mm', { locale: ja });
  } catch {
    return value;
  }
}

function formatDeadlinePolicyValue(value: string | number | boolean | undefined) {
  if (typeof value === 'number') return `${value}日`;
  if (typeof value === 'boolean') return value ? '有効' : '無効';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return null;
}

function formatDeadlinePolicyDiagnostic(
  item: NonNullable<ProposalGenerationDiagnosticsCardData['deadline_policy']>[number],
) {
  const label = DEADLINE_POLICY_LABELS[item.code] ?? item.code;
  const dateParts = [
    item.date_key,
    item.from_date_key && item.to_date_key ? `${item.from_date_key}→${item.to_date_key}` : null,
  ]
    .filter(Boolean)
    .join(' / ');
  const value = formatDeadlinePolicyValue(item.value);
  return [label, dateParts || null, value].filter(Boolean).join(' ');
}

export function VisitProposalDiagnosticsCard({
  diagnostics,
  title = '提案生成 diagnostics',
  description = '採用候補と採用外理由を一覧で確認できます。',
  actions = [],
  className,
  maxRejectedItems = 8,
}: ProposalDiagnosticsCardProps) {
  const rejectionSummary = Array.from(
    diagnostics.rejected.reduce((map, item) => {
      const label = item.reason_label ?? item.reason_code ?? '採用外';
      map.set(label, (map.get(label) ?? 0) + 1);
      return map;
    }, new Map<string, number>()),
  ).sort((left, right) => right[1] - left[1]);
  const deadlinePolicy = diagnostics.deadline_policy ?? [];
  const availabilitySummary = Array.from(
    diagnostics.rejected.reduce((map, item) => {
      const code = item.availability_reason_code ?? item.reason_code;
      if (!code || !(code in AVAILABILITY_REASON_LABELS)) return map;
      const label = AVAILABILITY_REASON_LABELS[code] ?? code;
      map.set(label, (map.get(label) ?? 0) + 1);
      return map;
    }, new Map<string, number>()),
  ).sort((left, right) => right[1] - left[1]);

  return (
    <Card className={['border-border/70 bg-card/95', className].filter(Boolean).join(' ')}>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-base">{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          {actions.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {actions.map((action) => (
                <Button
                  key={action.label}
                  type="button"
                  size="sm"
                  variant={action.variant ?? 'outline'}
                  onClick={action.onClick}
                >
                  {action.label}
                </Button>
              ))}
            </div>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2 text-sm">
          <Badge variant="outline">採用 {diagnostics.accepted.length} 件</Badge>
          <Badge variant="outline">採用外 {diagnostics.rejected.length} 件</Badge>
          {deadlinePolicy.length > 0 ? (
            <Badge variant="outline">期限診断 {deadlinePolicy.length} 件</Badge>
          ) : null}
          {rejectionSummary.map(([label, count]) => (
            <Badge
              key={label}
              variant="outline"
              className="border-transparent bg-state-confirm/10 text-state-confirm"
            >
              {label} {count}
            </Badge>
          ))}
        </div>

        {deadlinePolicy.length > 0 || availabilitySummary.length > 0 ? (
          <div className="space-y-3 rounded-md border border-border/70 bg-background/70 px-3 py-3 text-sm">
            {deadlinePolicy.length > 0 ? (
              <div className="space-y-2">
                <p className="font-medium text-foreground">期限診断</p>
                <div className="flex flex-wrap gap-2">
                  {deadlinePolicy.map((item, index) => (
                    <Badge
                      key={`${item.code}-${item.date_key ?? item.from_date_key ?? index}`}
                      variant="outline"
                      className="border-state-confirm/30 bg-state-confirm/10 text-state-confirm"
                    >
                      {formatDeadlinePolicyDiagnostic(item)}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}
            {availabilitySummary.length > 0 ? (
              <div className="space-y-2">
                <p className="font-medium text-foreground">休業日・シフト理由</p>
                <div className="flex flex-wrap gap-2">
                  {availabilitySummary.map(([label, count]) => (
                    <Badge
                      key={label}
                      variant="outline"
                      className="border-state-confirm/30 bg-state-confirm/10 text-state-confirm"
                    >
                      {label} {count}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="grid gap-4 xl:grid-cols-2">
          <div className="space-y-3">
            <p className="text-sm font-medium text-foreground">
              採用候補 {diagnostics.accepted.length} 件
            </p>
            {diagnostics.accepted.length === 0 ? (
              <p className="text-sm text-muted-foreground">採用候補はありません。</p>
            ) : (
              diagnostics.accepted.map((item) => {
                const scoreBreakdown = Object.entries(item.score_breakdown ?? {}).filter(
                  ([, value]) => value !== 0,
                );
                return (
                  <div
                    key={`${item.pharmacist_id}-${item.proposed_date}-${item.route_order}`}
                    className="space-y-3 rounded-xl border border-state-done/30 bg-state-done/5 px-3 py-3 text-sm"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-foreground">
                          {item.pharmacist_name ?? item.pharmacist_id} / {item.proposed_date}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          順路 {item.route_order ?? '未割当'} / スコア{' '}
                          {item.score != null ? item.score.toFixed(1) : '未計算'} /{' '}
                          {item.travel_summary ?? '移動時間未計算'}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {item.assignment_mode ? (
                          <Badge variant="outline" className="border-state-done/30 bg-background">
                            {item.assignment_mode === 'fallback' ? '代替担当' : '主担当'}
                          </Badge>
                        ) : null}
                        {item.care_relationship ? (
                          <Badge variant="outline" className="border-state-done/30 bg-background">
                            {item.care_relationship}
                          </Badge>
                        ) : null}
                        {item.vehicle_resource_label ? (
                          <Badge variant="outline" className="border-state-done/30 bg-background">
                            車両 {item.vehicle_resource_label}
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                    {item.time_window_start || item.time_window_end ? (
                      <p className="text-xs text-muted-foreground">
                        候補時間 {formatTimeValue(item.time_window_start) ?? '未定'} -{' '}
                        {formatTimeValue(item.time_window_end) ?? '未定'}
                      </p>
                    ) : null}
                    {item.vehicle_resource_label || item.vehicle_load != null ? (
                      <p className="text-xs text-muted-foreground">
                        社用車 {item.vehicle_resource_label ?? '自動割当'} / 当日同車両{' '}
                        {item.vehicle_load ?? '未計算'} 件目
                      </p>
                    ) : null}
                    {scoreBreakdown.length > 0 ? (
                      <>
                        <Separator className="bg-state-done/20" />
                        <div className="flex flex-wrap gap-2">
                          {scoreBreakdown.map(([key, value]) => (
                            <Badge
                              key={key}
                              variant="outline"
                              className="border-state-done/30 bg-background text-foreground"
                            >
                              {SCORE_BREAKDOWN_LABELS[key] ?? key} {formatSignedNumber(value)}
                            </Badge>
                          ))}
                        </div>
                      </>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium text-foreground">
              採用外 {diagnostics.rejected.length} 件
            </p>
            {diagnostics.rejected.length === 0 ? (
              <p className="text-sm text-muted-foreground">採用外候補はありません。</p>
            ) : (
              diagnostics.rejected.slice(0, maxRejectedItems).map((item) => (
                <div
                  key={`${item.pharmacist_id}-${item.proposed_date}-${item.reason_code ?? item.reason_label}`}
                  className="rounded-xl border border-state-confirm/30 bg-state-confirm/5 px-3 py-3 text-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium text-foreground">
                      {item.pharmacist_name ?? item.pharmacist_id ?? '担当未指定'} /{' '}
                      {item.proposed_date}
                    </p>
                    <Badge
                      variant="outline"
                      className="border-transparent bg-state-confirm/10 text-state-confirm"
                    >
                      {item.reason_label ?? item.reason_code ?? '採用外'}
                    </Badge>
                  </div>
                  {item.availability_reason_code &&
                  item.availability_reason_code in AVAILABILITY_REASON_LABELS ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Badge
                        variant="outline"
                        className="border-state-confirm/30 bg-background text-state-confirm"
                      >
                        訪問可否: {AVAILABILITY_REASON_LABELS[item.availability_reason_code]}
                      </Badge>
                    </div>
                  ) : null}
                  {item.detail ? (
                    <p className="mt-2 text-xs leading-5 text-muted-foreground">{item.detail}</p>
                  ) : null}
                </div>
              ))
            )}
            {diagnostics.rejected.length > maxRejectedItems ? (
              <p className="text-xs text-muted-foreground">
                残り {diagnostics.rejected.length - maxRejectedItems} 件は同じ条件で採用外です。
              </p>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
