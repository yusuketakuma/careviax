import type { Metadata } from 'next';
import { WorkflowPageIntro } from '@/components/features/workflow/workflow-page-intro';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { ResidualAdjustmentContent } from './residual-adjustment-content';

export const metadata: Metadata = {
  title: '残薬調整 — PH-OS',
};

export default async function ResidualAdjustmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // 他の患者サブページ(medications/prescriptions/mcs/consent/share)と同様に
  // 「患者詳細へ戻る + 現在地 + 可視 h1」を Intro で統一し、現在地喪失下の誤操作を防ぐ。
  // content は 3 カラムのカード grid を自前で持つため variant=bare とし、カードの二重枠を避ける。
  return (
    <PageScaffold variant="bare">
      <WorkflowPageIntro
        backHref={`/patients/${id}`}
        backLabel="患者詳細へ戻る"
        eyebrow="Residual Adjustment"
        title="残薬調整"
        description="残薬の確認から調整案の確定まで"
        supportingContent={
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">確認順序</p>
            <p className="text-sm text-muted-foreground">残薬 → 医師指示 → 調整案確定</p>
          </div>
        }
      />
      <ResidualAdjustmentContent patientId={id} />
    </PageScaffold>
  );
}
