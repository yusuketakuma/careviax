'use client';

import Link from 'next/link';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  MAIN_WORKFLOW_STEPS,
  type MainWorkflowStepKey,
} from './main-workflow-route';

export type WorkflowIntegrationHandoff = {
  from: MainWorkflowStepKey;
  to: MainWorkflowStepKey;
  title: string;
  dataRefs: string[];
  userCheck: string;
};

export const WORKFLOW_INTEGRATION_HANDOFFS: readonly WorkflowIntegrationHandoff[] = [
  {
    from: 'prescriptions',
    to: 'dispensing',
    title: '処方情報を調剤キューへ渡す',
    dataRefs: ['MedicationCycle', 'PrescriptionIntake', 'PrescriptionLine', 'DispenseTask'],
    userCheck: '処方登録後に調剤待ちタスクが生成され、処方差分が調剤画面で確認できる',
  },
  {
    from: 'dispensing',
    to: 'auditing',
    title: '調剤結果を監査へ渡す',
    dataRefs: ['DispenseTask', 'DispenseResult', 'DispenseAudit'],
    userCheck: '調剤完了後に監査待ちへ進み、差戻し・確認事項が監査画面で止まる',
  },
  {
    from: 'auditing',
    to: 'medication_sets',
    title: '監査済みサイクルからセット計画へ進む',
    dataRefs: ['MedicationCycle.status=audited', 'SetPlan', 'PatientPackagingProfile'],
    userCheck: '監査済み処方だけをセット対象にし、処方変更があればセット画面で再確認できる',
  },
  {
    from: 'medication_sets',
    to: 'set_audit',
    title: 'セット内容をセット監査へ渡す',
    dataRefs: ['SetPlan', 'SetBatch', 'SetAudit'],
    userCheck: 'セット作成後にセット監査で承認・差戻し・期限切れを確認できる',
  },
  {
    from: 'set_audit',
    to: 'schedules',
    title: '持参内容確定後に訪問予定へ接続する',
    dataRefs: ['VisitSchedule', 'carry_items_status', 'route_order'],
    userCheck: 'セット監査後の持参確認がスケジュール上の出発可否・持参警告に反映される',
  },
  {
    from: 'schedules',
    to: 'visits',
    title: '訪問予定を現地モバイル記録へ渡す',
    dataRefs: ['VisitSchedule.id', 'VisitPreparationPack', 'facility_visit_context'],
    userCheck: 'スケジュールから訪問記録を開くと、同時訪問患者・準備情報・ケアチームが見える',
  },
  {
    from: 'visits',
    to: 'reports',
    title: '訪問記録を報告書へ展開する',
    dataRefs: ['VisitRecord', 'StructuredSOAP', 'CareReport', 'DeliveryRecord'],
    userCheck: '訪問後にSOAP・残薬・連携メモから算定要件チェック付き報告書を生成できる',
  },
] as const;

function stepByKey(key: MainWorkflowStepKey) {
  const step = MAIN_WORKFLOW_STEPS.find((item) => item.key === key);
  if (!step) {
    throw new Error(`Unknown workflow step: ${key}`);
  }
  return step;
}

export function WorkflowIntegrationMap({
  title = '全機能連動マトリクス',
  description = '各工程が次工程へ渡すデータと、ユーザーが画面上で確認できる連動点を固定化しています。',
}: {
  title?: string;
  description?: string;
}) {
  return (
    <Card className="border-border/70" data-testid="workflow-integration-map">
      <CardHeader className="space-y-1">
        <CardTitle className="text-base">{title}</CardTitle>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent>
        <ol className="grid gap-3 xl:grid-cols-2" aria-label="主業務工程間のデータ連動">
          {WORKFLOW_INTEGRATION_HANDOFFS.map((handoff) => {
            const from = stepByKey(handoff.from);
            const to = stepByKey(handoff.to);

            return (
              <li
                key={`${handoff.from}-${handoff.to}`}
                className="rounded-2xl border border-border/70 bg-muted/[0.06] p-3"
              >
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Link href={from.href} className="font-semibold text-foreground hover:text-primary">
                    {from.title}
                  </Link>
                  <ArrowRight className="size-4 text-muted-foreground" aria-hidden="true" />
                  <Link href={to.href} className="font-semibold text-foreground hover:text-primary">
                    {to.title}
                  </Link>
                </div>
                <p className="mt-2 text-sm font-medium text-foreground">{handoff.title}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {handoff.dataRefs.map((dataRef) => (
                    <Badge key={dataRef} variant="outline" className="bg-background">
                      {dataRef}
                    </Badge>
                  ))}
                </div>
                <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-muted-foreground">
                  <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
                  {handoff.userCheck}
                </p>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
