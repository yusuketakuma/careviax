import { Metadata } from 'next';
import { Suspense } from 'react';
import Link from 'next/link';
import { FileText, Printer } from 'lucide-react';
import { Skeleton, SkeletonRows } from '@/components/ui/loading';
import { buttonVariants } from '@/components/ui/button-variants';
import { getPatientMedicationShortcutLinks } from '@/components/features/workflow/page-shortcut-presets';
import { PatientMcsSummarySection } from '@/components/patient-mcs/patient-mcs-summary-section';
import { WorkflowPageIntro } from '@/components/features/workflow/workflow-page-intro';
import { InterventionPanel } from '@/components/features/medications/intervention-panel';
import { PatientVisitBriefSection } from '@/components/visit-brief/patient-visit-brief-section';
import { MedicationsContent } from './medications-content';
import { PageScaffold } from '@/components/layout/page-scaffold';

// 手組みの outline 風 class を共通 buttonVariants に寄せる。44px タッチターゲットと
// アイコン/テキスト間隔は className で維持する（共通化しても退化させない）。
const introActionLinkClassName = buttonVariants({
  variant: 'outline',
  size: 'sm',
  className: 'min-h-11 gap-1 whitespace-nowrap',
});

// Suspense fallback は「同形状の軽量スケルトン外枠」に限定し、子の内部 loading
// （client query 待ち）とは責務を分ける。空文言は置かず CLS と false-empty を防ぐ。
function MedicationsContentSkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-lg" />
        ))}
      </div>
      <div className="rounded-lg border bg-card p-4">
        <SkeletonRows rows={5} cols={4} />
      </div>
    </div>
  );
}

function SummaryCardSkeleton() {
  return (
    <div className="rounded-lg border bg-card p-4" aria-hidden="true">
      <Skeleton className="h-5 w-40" />
      <Skeleton className="mt-3 h-4 w-full" />
      <Skeleton className="mt-2 h-4 w-2/3" />
      <Skeleton className="mt-4 h-16 w-full rounded-md" />
    </div>
  );
}

function InterventionSkeleton() {
  return (
    <section className="rounded-lg border bg-card p-4" aria-hidden="true">
      <Skeleton className="h-5 w-32" />
      <Skeleton className="mt-3 h-4 w-full" />
      <Skeleton className="mt-2 h-16 w-full rounded-md" />
    </section>
  );
}

export const metadata: Metadata = {
  title: '服薬管理 — PH-OS',
};

export default async function MedicationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <PageScaffold>
      <WorkflowPageIntro
        backHref={`/patients/${id}`}
        backLabel="患者詳細へ戻る"
        eyebrow="服薬管理"
        title="服薬管理"
        description="服薬中薬剤・課題・残薬を患者単位で確認します"
        supportingContent={
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">最初に見るポイント</p>
            <p className="text-sm text-muted-foreground">
              服薬中薬剤と未解決課題を先に確認し、共有事項や残薬推移は後段で補足します。
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
        <Suspense fallback={<MedicationsContentSkeleton />}>
          <MedicationsContent patientId={id} />
        </Suspense>

        <div className="grid gap-6 xl:grid-cols-2">
          <Suspense fallback={<SummaryCardSkeleton />}>
            <PatientMcsSummarySection
              patientId={id}
              title="MCS共有要点"
              description="他職種発信から、服薬確認や折返しが必要な共有事項を抽出しています。"
              compact
            />
          </Suspense>

          <Suspense fallback={<SummaryCardSkeleton />}>
            <PatientVisitBriefSection
              patientId={id}
              title="服薬管理サマリー"
              description="処方薬、調剤方法、直近共有を1画面で確認できます。"
            />
          </Suspense>
        </div>

        <Suspense fallback={<InterventionSkeleton />}>
          <section className="rounded-lg border bg-card p-4">
            <InterventionPanel patientId={id} />
          </section>
        </Suspense>
      </div>
    </PageScaffold>
  );
}
