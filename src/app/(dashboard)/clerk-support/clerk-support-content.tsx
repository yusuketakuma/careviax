'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/loading';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { buildOrgHeaders } from '@/lib/api/org-headers';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { cn } from '@/lib/utils';
import type { ClerkSupportKpis, ClerkSupportResponse } from '@/types/clerk-support';

/**
 * p0_25「事務サポート」: 事務でできることの件数と着手リスト。
 * 構成: 見出し → KPI チップ 6 種 → [作業テーブル | 薬剤師に相談が必要]。
 * 薬剤師の判断が必要な境界は右カードに常時掲示する(迷わず相談へ回す)。
 */

async function fetchClerkSupport(orgId: string): Promise<ClerkSupportResponse> {
  const res = await fetch('/api/dashboard/clerk-support', {
    headers: buildOrgHeaders(orgId),
  });
  if (!res.ok) throw new Error('事務サポート集計の取得に失敗しました');
  const json = await res.json();
  return json.data;
}

// KPI 件数は単一エンティティの状態でもカテゴリ識別色でもないため、状態色を塗らない
// (赤=危険等の偽シグナル回避)。区別はラベル＋空間分離で行う。件数は foreground 強調、
// ゼロ件は muted で弱調にする（色ではなく明度コントラスト）。
const KPI_DEFS: Array<{
  key: keyof ClerkSupportKpis;
  label: string;
}> = [
  { key: 'intake_pending', label: '処方受付' },
  { key: 'delivery_target_missing', label: '送付先未設定' },
  { key: 'schedule_confirmation', label: '日程確認' },
  { key: 'document_drafts', label: '文書記録' },
  { key: 'reply_pending', label: '返信待ち' },
  { key: 'pharmacist_review', label: '薬剤師確認' },
];

export function ClerkSupportContent() {
  const orgId = useOrgId();
  const query = useQuery({
    queryKey: ['clerk-support', orgId],
    queryFn: () => fetchClerkSupport(orgId),
    staleTime: 30_000,
    enabled: Boolean(orgId),
  });

  const data = query.data ?? null;

  return (
    <div className="space-y-5" data-testid="clerk-support-page">
      {/* ハブ系トップ階層ヘッダは WorkflowPageHeader で統一(戻り導線なし)。 */}
      {/* 事務向けの『迷ったら相談へ』ガイダンスは運用上の指示なので、help-popover に */}
      {/* 隠さず supportingContent で常時可視に保つ(description は help 用に同文を渡す)。 */}
      <WorkflowPageHeader
        title="事務でできること"
        description="薬剤師の判断が必要なものは、迷わず相談へ回します。"
        supportingContent={
          <p className="text-sm leading-6 text-muted-foreground">
            薬剤師の判断が必要なものは、迷わず相談へ回します。
          </p>
        }
      />

      {!orgId || query.isLoading ? (
        <div className="space-y-4" role="status" aria-label="事務サポート読み込み中">
          <Skeleton className="h-20 w-full rounded-lg" />
          <Skeleton className="h-64 w-full rounded-lg" />
        </div>
      ) : query.isError || !data ? (
        <div className="rounded-lg border border-border/70 bg-card p-4">
          <ErrorState
            variant="server"
            title="事務サポートを表示できません"
            description="集計の取得に失敗しました。再試行してください。"
            action={{ label: '再試行', onClick: () => void query.refetch() }}
          />
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6" data-testid="clerk-kpi-grid">
            {KPI_DEFS.map((def) => {
              const count = data.kpis[def.key];
              return (
                <div key={def.key} className="rounded-lg border border-border/70 bg-card px-4 py-3">
                  <p className="text-sm font-medium text-foreground">{def.label}</p>
                  <p
                    className={cn(
                      'mt-1 text-2xl font-bold tabular-nums',
                      count === 0 ? 'text-muted-foreground' : 'text-foreground',
                    )}
                  >
                    {count}
                    <span className="ml-0.5 text-sm font-medium">件</span>
                  </p>
                </div>
              );
            })}
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
            <section
              aria-label="事務の作業リスト"
              className="rounded-lg border border-border/70 bg-card"
              data-testid="clerk-task-section"
            >
              {/* デスクトップ: 走査性重視の表。モバイルは横溢れするため sm 以上で表示。 */}
              <div className="hidden sm:block" data-testid="clerk-task-table">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-28">内容</TableHead>
                      <TableHead>患者さん</TableHead>
                      <TableHead>次にやること</TableHead>
                      <TableHead className="w-28">期限</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.tasks.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-sm text-muted-foreground">
                          いま事務側で止まっている作業はありません。
                        </TableCell>
                      </TableRow>
                    ) : (
                      data.tasks.map((task) => (
                        // 医療データテーブルの走査性: 行数が増えても目で追えるよう zebra stripe(SSOT)
                        <TableRow key={task.id} className="even:bg-muted/30">
                          <TableCell className="font-medium text-foreground">
                            {task.kind_label}
                          </TableCell>
                          <TableCell>{task.patient_name}</TableCell>
                          <TableCell>
                            <Link href={task.href} className="text-primary hover:underline">
                              {task.next_action}
                            </Link>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {task.due_label ?? '—'}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
              {/* モバイル: 同一 source order の縦カード。横スクロールを避け次アクションを明示。 */}
              <ul
                className="divide-y divide-border/70 sm:hidden"
                role="list"
                data-testid="clerk-task-mobile-list"
              >
                {data.tasks.length === 0 ? (
                  <li className="px-4 py-3 text-sm text-muted-foreground">
                    いま事務側で止まっている作業はありません。
                  </li>
                ) : (
                  data.tasks.map((task) => (
                    <li
                      key={task.id}
                      className="px-4 py-3"
                      data-testid={`clerk-task-mobile-card-${task.id}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-foreground">
                          {task.kind_label}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {task.due_label ?? '—'}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-foreground">{task.patient_name}</p>
                      <Link
                        href={task.href}
                        className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-primary hover:underline"
                      >
                        {task.next_action}
                      </Link>
                    </li>
                  ))
                )}
              </ul>
            </section>

            <section
              aria-labelledby="clerk-consult-heading"
              className="h-fit rounded-lg border border-border/70 bg-card p-4"
              data-testid="clerk-consult-card"
            >
              <h2 id="clerk-consult-heading" className="text-base font-bold text-foreground">
                薬剤師に相談が必要
              </h2>
              <ul className="mt-3 space-y-2.5" role="list">
                {data.consult_items.map((item) => (
                  <li key={item} className="text-sm leading-5 text-foreground">
                    ・{item}
                  </li>
                ))}
              </ul>
              {/* 気づき(掲示)から実際の起票へ繋ぐ。ハンドオフの相談起票で薬剤師に渡す。 */}
              <Link
                href="/handoff"
                className="mt-4 inline-flex min-h-[44px] items-center gap-1 rounded-md border border-border/70 px-3 py-2 text-sm font-semibold text-primary hover:bg-muted/50"
                data-testid="clerk-consult-handoff-link"
              >
                ハンドオフで薬剤師に相談する →
              </Link>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
