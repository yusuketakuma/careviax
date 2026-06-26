import { Metadata } from 'next';
import { Suspense } from 'react';
import { CollaborationWorkflowPanel } from '@/components/features/workflow/collaboration-workflow-panel';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { Loading } from '@/components/ui/loading';
import { ExternalViewerContent } from './external-viewer-content';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { readExternalState } from './external-query-state';

export const metadata: Metadata = {
  title: '外部連携ビュー — PH-OS',
};

type ExternalViewerPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ExternalViewerPage({ searchParams }: ExternalViewerPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const initialState = readExternalState(resolvedSearchParams);
  const relatedLinks = [
    { href: '/dashboard', label: 'ダッシュボード' },
    { href: '/conferences', label: '多職種連携' },
    { href: '/communications/requests', label: '依頼・照会' },
    { href: '/notifications', label: '通知' },
  ];

  return (
    <PageScaffold>
      <WorkflowPageHeader
        eyebrow="External Collaboration"
        title="外部連携ビュー"
        description="外部連携者（ケアマネジャー・医師等）向けの閲覧専用ビュー"
      />
      <Suspense fallback={<Loading />}>
        <ExternalViewerContent
          initialFocus={initialState.initialFocus}
          initialContext={initialState.initialContext}
        />
      </Suspense>

      <CollaborationWorkflowPanel
        focus="external"
        description="外部共有、自己申告、地域活動フォローを、訪問時と報告書工程へ戻す横断画面として整理しています。"
      />

      <section
        className="rounded-lg border border-border/70 bg-card p-4"
        aria-labelledby="external-related-links-heading"
      >
        <p id="external-related-links-heading" className="text-sm font-semibold text-foreground">
          関連導線
        </p>
        <div className="mt-3">
          <PageShortcutLinks links={relatedLinks} />
        </div>
      </section>
    </PageScaffold>
  );
}
