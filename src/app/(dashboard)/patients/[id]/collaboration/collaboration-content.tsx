'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/loading';
import { WorkflowBackLink } from '@/components/features/workflow/workflow-back-link';
import { CommentThread } from '@/components/features/comments/comment-thread';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { usePresenceUsers } from '@/lib/hooks/use-presence-users';
import { usePresenceHeartbeat } from '@/lib/hooks/use-presence-heartbeat';
import { buildOrgHeaders } from '@/lib/api/org-headers';
import { buildPatientApiPath } from '@/lib/patient/api-paths';
import { buildPatientHref } from '@/lib/patient/navigation';
import { useAuthStore } from '@/lib/stores/auth-store';
import type { PatientOverview } from '../patient-detail.types';
import {
  buildCollaborationDemoData,
  buildPresenceViews,
  PATIENT_PRESENCE_ENTITY_TYPE,
  type CollaborationDemoData,
} from './collaboration.shared';

/**
 * p1_13 今だれが見ているか(design/images/P1/p1_13_realtime_collaboration_presence.png)。
 * 3 カラム構成: 左「同じカードを見ている人」(presence)→ 中央「コメント・確認」(書き込み可能な
 * 双方向スレッド = CommentThread, /api/comments の entity_type='patient')→
 * 右「重複を防ぐ」(最新を読み込む = presence と overview の refetch)。
 * presence は既存基盤(/api/presence + ポーリング + SSE invalidate)へ patient エンティティで接続する。
 */

function CollaborationSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,17fr)_minmax(0,22fr)_minmax(240px,10fr)] xl:grid-cols-[minmax(0,17fr)_minmax(0,22fr)_minmax(280px,10fr)]">
      {[0, 1, 2].map((column) => (
        <div key={column} className="space-y-4 rounded-lg border border-border/70 bg-card p-4">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ))}
    </div>
  );
}

export function CollaborationContent({ patientId }: { patientId: string }) {
  const orgId = useOrgId();
  const selfUserId = useAuthStore((state) => state.currentUser.id);
  const queryClient = useQueryClient();

  // 撮影・動作確認用デモ(dev 限定 window フックで注入)。null のときは実データを表示
  const [demoData, setDemoData] = useState<CollaborationDemoData | null>(null);

  // 自分の滞在を共有(他のスタッフの画面に「連携ビュー」として出る)
  usePresenceHeartbeat({
    entityType: PATIENT_PRESENCE_ENTITY_TYPE,
    entityId: patientId,
    activeField: 'collaboration',
  });

  const presenceQuery = usePresenceUsers({
    entityType: PATIENT_PRESENCE_ENTITY_TYPE,
    entityId: patientId,
  });

  // 患者名・ローディング/エラー表示と「最新を読み込む」の refetch 対象(card-workspace とキャッシュ共有)
  const overviewQueryKey = ['patient-overview', patientId, orgId];
  const overviewQuery = useQuery<PatientOverview>({
    queryKey: overviewQueryKey,
    queryFn: async () => {
      const res = await fetch(buildPatientApiPath(patientId, '/overview'), {
        headers: buildOrgHeaders(orgId),
      });
      if (!res.ok) throw new Error('患者情報の取得に失敗しました');
      return res.json();
    },
    enabled: Boolean(orgId),
  });

  // 撮影・動作確認用のデモ注入(dev 限定)
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    const target = window;
    target.__phosSeedPresenceDemo = () => {
      setDemoData(buildCollaborationDemoData());
    };
    return () => {
      delete target.__phosSeedPresenceDemo;
    };
  }, []);

  // 「最新を読み込む」= presence と overview を実際に refetch する
  const refreshMutation = useMutation({
    mutationFn: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: presenceQuery.queryKey }),
        queryClient.invalidateQueries({ queryKey: overviewQueryKey }),
      ]);
    },
    onSuccess: () => {
      toast.success('最新の情報を読み込みました');
    },
    onError: () => {
      toast.error('最新の情報の読み込みに失敗しました');
    },
  });

  const presenceViews = demoData?.presence ?? buildPresenceViews(presenceQuery.users, selfUserId);

  // デモ注入時(撮影・動作確認の __phosSeedPresenceDemo)は overview の読み込みを
  // 待たずに presence を表示する。本番では demoData は常に null のため挙動は不変。
  const isLoading = !demoData && (!orgId || overviewQuery.isLoading);
  const patientName = overviewQuery.data?.name;

  return (
    <section aria-label="今だれが見ているか" data-testid="patient-collaboration">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-xl font-bold text-foreground">今だれが見ているか</h2>
          <p className="text-sm text-muted-foreground">
            {patientName
              ? `${patientName}さんのカードを同時に見ている人と直近の動きを共有します`
              : '同じカードを同時に見ている人と直近の動きを共有します'}
          </p>
        </div>
        <WorkflowBackLink href={buildPatientHref(patientId)} label="カードへ戻る" />
      </div>

      <div className="mt-4">
        {isLoading ? (
          <CollaborationSkeleton />
        ) : overviewQuery.isError ? (
          <div className="rounded-lg border border-border/70 bg-card p-4">
            <ErrorState
              variant="server"
              title="今だれが見ているかを表示できません"
              description="患者情報の取得に失敗しました。再試行してください。"
              detail={
                overviewQuery.error instanceof Error ? overviewQuery.error.message : undefined
              }
              action={{ label: '再試行', onClick: () => void overviewQuery.refetch() }}
            />
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,17fr)_minmax(0,22fr)_minmax(240px,10fr)] xl:grid-cols-[minmax(0,17fr)_minmax(0,22fr)_minmax(280px,10fr)]">
            <section
              aria-labelledby="collaboration-presence-heading"
              className="rounded-lg border border-border/70 bg-card p-4 xl:min-h-[600px]"
              data-testid="collaboration-presence"
            >
              <h3
                id="collaboration-presence-heading"
                className="text-base font-semibold text-foreground"
              >
                同じカードを見ている人
              </h3>
              {presenceViews.length === 0 ? (
                <p className="mt-4 text-sm leading-6 text-muted-foreground">
                  いまこのカードを見ているのはあなただけです。
                </p>
              ) : (
                <ul className="mt-4 space-y-4" role="list">
                  {presenceViews.map((user) => (
                    <li
                      key={user.userId}
                      className="rounded-lg border border-border/70 bg-card p-4"
                      data-testid="presence-user-card"
                    >
                      <p className="text-[15px] font-bold leading-6 text-foreground">
                        {user.displayName}
                      </p>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">
                        {user.locationLabel}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section
              aria-labelledby="collaboration-comments-heading"
              className="rounded-lg border border-border/70 bg-card p-4 xl:min-h-[600px]"
              data-testid="collaboration-comments"
            >
              <h3
                id="collaboration-comments-heading"
                className="text-base font-semibold text-foreground"
              >
                コメント・確認
              </h3>
              {/*
                書き込み可能な双方向スレッド(/api/comments, entity_type='patient')。
                列側が既に枠と見出しを持つため variant='bare' で素のまま埋め込む。
              */}
              <div className="mt-4">
                {demoData ? (
                  <div className="space-y-3" data-testid="collaboration-demo-comments">
                    {demoData.comments.map((comment) => (
                      <div key={comment.id} className="flex gap-3">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
                          {comment.author.charAt(0)}
                        </span>
                        <div className="flex-1 space-y-1">
                          <p className="text-sm font-medium text-foreground">{comment.author}</p>
                          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                            {comment.text}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <CommentThread
                    entityType={PATIENT_PRESENCE_ENTITY_TYPE}
                    entityId={patientId}
                    variant="bare"
                  />
                )}
              </div>
            </section>

            <section
              aria-labelledby="collaboration-guard-heading"
              className="rounded-lg border border-border/70 bg-card p-4 xl:min-h-[600px]"
              data-testid="collaboration-guard"
            >
              <h3
                id="collaboration-guard-heading"
                className="text-base font-semibold text-foreground"
              >
                重複を防ぐ
              </h3>
              <p className="mt-4 text-sm leading-6 text-muted-foreground">
                他のスタッフが編集中の場所は、上書き前に確認します
              </p>
              <Button
                type="button"
                className="mt-5 min-h-[44px] w-full"
                onClick={() => refreshMutation.mutate()}
                disabled={refreshMutation.isPending}
                data-testid="collaboration-refresh"
              >
                {refreshMutation.isPending ? '読み込み中…' : '最新を読み込む'}
              </Button>
            </section>
          </div>
        )}
      </div>
    </section>
  );
}
