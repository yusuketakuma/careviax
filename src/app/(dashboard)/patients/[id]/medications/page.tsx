import { Metadata } from 'next';
import { Suspense } from 'react';
import Link from 'next/link';
import { FileText, Printer } from 'lucide-react';
import { Loading } from '@/components/ui/loading';
import { getPatientMedicationShortcutLinks } from '@/components/features/workflow/page-shortcut-presets';
import { PatientMcsSummarySection } from '@/components/patient-mcs/patient-mcs-summary-section';
import { WorkflowPageIntro } from '@/components/features/workflow/workflow-page-intro';
import { InterventionPanel } from '@/components/features/medications/intervention-panel';
import { PatientVisitBriefSection } from '@/components/visit-brief/patient-visit-brief-section';
import { MedicationsContent } from './medications-content';
import { PageScaffold } from '@/components/layout/page-scaffold';

const introActionLinkClassName =
  'inline-flex h-7 items-center justify-center gap-1 rounded-[min(var(--radius-md),12px)] border border-border bg-background px-2.5 text-[0.8rem] font-medium whitespace-nowrap transition-all outline-none hover:bg-muted hover:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50';

export const metadata: Metadata = {
  title: '服薬管理 — CareViaX',
};

export default async function MedicationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <PageScaffold>
      <WorkflowPageIntro
        backHref={`/patients/${id}`}
        backLabel="患者詳細へ戻る"
        eyebrow="Medication Management"
        title="服薬管理"
        description="服薬中薬剤・残薬記録を管理します"
        supportingContent={
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">最初に見るポイント</p>
            <p className="text-sm text-muted-foreground">
              処方要点、共有事項、残薬や介入ポイントを先に確認し、その後に個別薬剤を見ます。
            </p>
          </div>
        }
        shortcuts={getPatientMedicationShortcutLinks(id)}
        className="mb-6"
        actions={
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <Link
              href={`/api/patients/${id}/medications/pdf`}
              target="_blank"
              rel="noreferrer"
              className={introActionLinkClassName}
            >
              <FileText className="mr-1.5 size-4" aria-hidden="true" />
              PDFを開く
            </Link>
            <Link href={`/patients/${id}/medications/print`} className={introActionLinkClassName}>
              <Printer className="mr-1.5 size-4" aria-hidden="true" />
              印刷ビュー
            </Link>
          </div>
        }
      />

      <div className="space-y-6">
        <div className="grid gap-6 xl:grid-cols-2">
          <Suspense fallback={<Loading />}>
            <PatientMcsSummarySection
              patientId={id}
              title="MCS共有要点"
              description="他職種発信から、服薬確認や折返しが必要な共有事項を抽出しています。"
              compact
            />
          </Suspense>

          <Suspense fallback={<Loading />}>
            <PatientVisitBriefSection
              patientId={id}
              title="服薬管理サマリー"
              description="処方薬、調剤方法、直近共有を1画面で確認できます。"
            />
          </Suspense>
        </div>

        <Suspense fallback={<Loading />}>
          <MedicationsContent patientId={id} />
        </Suspense>

        <Suspense fallback={<Loading />}>
          <section className="rounded-lg border bg-card p-4">
            <InterventionPanel patientId={id} />
          </section>
        </Suspense>
      </div>
    </PageScaffold>
  );
}
