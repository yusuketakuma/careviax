import { Metadata } from 'next';
import { Suspense } from 'react';
import { PageShortcutLinks } from '@/components/features/workflow/page-shortcut-links';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { Loading } from '@/components/ui/loading';
import { HandoffBoard } from '@/components/features/handoff/handoff-board';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { HandoffWorkspace } from './handoff-workspace';
import { readHandoffState } from './handoff-query-state';

export const metadata: Metadata = {
  title: 'ハンドオフ — PH-OS',
};

type HandoffPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * /handoff。ビューポート最上部は new_12_handoff のハンドオフ(責任の移動)ボード
 * (私が渡した / 私に来た + 3点セットのルール帯 + 右レール)。
 * 旧申し送りボード(日付指定・全て/未読フィルタ・確認済み管理)は機能温存のため
 * ビューポート下部(#handoff-classic-board)へ残置する。
 */
export default async function HandoffPage({ searchParams }: HandoffPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const initialState = readHandoffState(resolvedSearchParams);

  return (
    <PageScaffold variant="bare">
      {/* 新デザイン領域: 旧機能はこの下(ビューポート外)に温存する */}
      <div className="xl:min-h-[calc(100vh-4rem)]">
        <HandoffWorkspace />
      </div>

      <section
        id="handoff-classic-board"
        aria-label="申し送り履歴(日付指定・未読管理)"
        className="space-y-4"
      >
        <div className="rounded-xl border border-border/70 bg-[radial-gradient(circle_at_top_left,rgba(34,113,177,0.10),transparent_35%),radial-gradient(circle_at_top_right,rgba(16,185,129,0.10),transparent_24%),linear-gradient(180deg,rgba(248,250,252,0.98),rgba(255,255,255,1))] px-5 py-5 shadow-sm sm:px-6 sm:py-6">
          <WorkflowPageHeader
            eyebrow="Shift Handoff"
            title="申し送り履歴"
            description="日付を指定して過去のハンドオフ・申し送りを確認し、未読の確認状態を管理します。"
            supportingContent={
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">最初に見るポイント</p>
                <p className="text-sm text-muted-foreground">
                  未読の申し送り、今日処理が必要な引き継ぎ、訪問やタスクへの戻り先を先に確認します。
                </p>
              </div>
            }
            mainWorkflowSteps={['visits']}
            mainWorkflowDescription="申し送りは訪問後の派生確認として扱い、訪問工程の延長にあることを固定表示します。"
            childrenLabel="関連導線"
          >
            <PageShortcutLinks
              links={[
                { href: '/tasks', label: 'タスク' },
                { href: '/visits', label: '訪問' },
              ]}
            />
          </WorkflowPageHeader>
        </div>

        <Suspense fallback={<Loading />}>
          <HandoffBoard
            initialDate={initialState.initialDate}
            initialFilter={initialState.initialFilter}
            initialContext={initialState.initialContext}
          />
        </Suspense>
      </section>
    </PageScaffold>
  );
}
