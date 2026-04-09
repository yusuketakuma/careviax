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
  pharmacist_name: string;
  proposed_date: string;
  route_order: number;
  score: number;
  travel_summary: string;
  assignment_mode?: string;
  care_relationship?: string;
  score_breakdown?: Record<string, number>;
  time_window_start?: string | Date;
  time_window_end?: string | Date;
};

type RejectedDiagnostic = {
  pharmacist_id: string;
  pharmacist_name: string;
  proposed_date: string;
  reason_code?: string;
  reason_label: string;
  detail: string;
};

export type ProposalGenerationDiagnosticsCardData = {
  accepted: AcceptedDiagnostic[];
  rejected: RejectedDiagnostic[];
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
      map.set(item.reason_label, (map.get(item.reason_label) ?? 0) + 1);
      return map;
    }, new Map<string, number>())
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
          {rejectionSummary.map(([label, count]) => (
            <Badge
              key={label}
              variant="outline"
              className="border-amber-200 bg-amber-50 text-amber-800"
            >
              {label} {count}
            </Badge>
          ))}
        </div>

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
                  ([, value]) => value !== 0
                );
                return (
                  <div
                    key={`${item.pharmacist_id}-${item.proposed_date}-${item.route_order}`}
                    className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-emerald-950">
                          {item.pharmacist_name} / {item.proposed_date}
                        </p>
                        <p className="mt-1 text-xs text-emerald-900">
                          順路 {item.route_order} / スコア {item.score.toFixed(1)} /{' '}
                          {item.travel_summary}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {item.assignment_mode ? (
                          <Badge variant="outline" className="border-emerald-300 bg-white/80">
                            {item.assignment_mode === 'fallback' ? '代替担当' : '主担当'}
                          </Badge>
                        ) : null}
                        {item.care_relationship ? (
                          <Badge variant="outline" className="border-emerald-300 bg-white/80">
                            {item.care_relationship}
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                    {item.time_window_start || item.time_window_end ? (
                      <p className="text-xs text-emerald-900">
                        候補時間 {formatTimeValue(item.time_window_start) ?? '未定'} -{' '}
                        {formatTimeValue(item.time_window_end) ?? '未定'}
                      </p>
                    ) : null}
                    {scoreBreakdown.length > 0 ? (
                      <>
                        <Separator className="bg-emerald-200/80" />
                        <div className="flex flex-wrap gap-2">
                          {scoreBreakdown.map(([key, value]) => (
                            <Badge
                              key={key}
                              variant="outline"
                              className="border-emerald-300 bg-white/80 text-emerald-950"
                            >
                              {(SCORE_BREAKDOWN_LABELS[key] ?? key)} {formatSignedNumber(value)}
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
                  className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium text-amber-950">
                      {item.pharmacist_name} / {item.proposed_date}
                    </p>
                    <Badge variant="outline" className="border-amber-300 bg-white/80">
                      {item.reason_label}
                    </Badge>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-amber-900">{item.detail}</p>
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
