'use client';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { PatientOverview } from './patient-detail.types';

export function PatientRiskCard({
  riskSummary,
}: {
  riskSummary: PatientOverview['risk_summary'];
}) {
  const levelLabel =
    riskSummary?.level === 'high' ? '高' : riskSummary?.level === 'watch' ? '注意' : '安定';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">患者リスク</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">総合判定</span>
          <Badge variant={riskSummary?.level === 'high' ? 'destructive' : 'outline'}>
            {levelLabel}
            {riskSummary ? ` / ${riskSummary.score}` : ''}
          </Badge>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
          <span>自己申告 {riskSummary?.unresolved_self_reports ?? 0}</span>
          <span>課題 {riskSummary?.open_issues ?? 0}</span>
          <span>未完了タスク {riskSummary?.open_tasks ?? 0}</span>
          <span>報告待ち {riskSummary?.pending_reports ?? 0}</span>
        </div>
        {(riskSummary?.reasons.length ?? 0) === 0 ? (
          <p className="text-muted-foreground">大きなリスクシグナルはありません。</p>
        ) : (
          <div className="space-y-2">
            {riskSummary?.reasons.slice(0, 4).map((reason) => (
              <div key={reason} className="rounded-lg border border-border p-2 text-xs">
                {reason}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
