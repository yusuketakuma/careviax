'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/loading';
import { readApiJson } from '@/lib/api/client-json';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import {
  COMMENTS_API_PATH,
  buildCommentApiPath,
  buildCommentsApiPath,
} from '@/lib/comments/api-paths';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { useRealtimeQuery } from '@/lib/hooks/use-realtime-query';
import { messageFromError } from '@/lib/utils/error-message';
import { MentionInput } from './mention-input';

type Comment = {
  id: string;
  author_id: string;
  author_name: string;
  content: string;
  mentions: string[];
  created_at: string;
};

type CommentThreadProps = {
  entityType: string;
  entityId: string;
  /**
   * 'card'(既定): 自前の Card + 「コメント」見出しで囲む単独配置用。
   * 'bare': 外側の Card/見出しを描画せず、呼び出し側のセクション内へ素のまま埋め込む。
   *   p1_13「コメント・確認」列のように、列側が既に枠と見出しを持つ場合に使う。
   */
  variant?: 'card' | 'bare';
};

export function CommentThread({ entityType, entityId, variant = 'card' }: CommentThreadProps) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [content, setContent] = useState('');
  const [mentions, setMentions] = useState<string[]>([]);

  const queryKey = ['comments', orgId, entityType, entityId];

  const { data, isError, isPending, refetch } = useRealtimeQuery<{ data: Comment[] }>({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({ entity_type: entityType, entity_id: entityId });
      const res = await fetch(buildCommentsApiPath(params), {
        headers: buildOrgHeaders(orgId),
      });
      return readApiJson<{ data: Comment[] }>(res, 'コメントの取得に失敗しました');
    },
    enabled: !!orgId && !!entityId,
    invalidateOn: ['comment_refresh'],
    fallbackRefetchInterval: 30_000,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(COMMENTS_API_PATH, {
        method: 'POST',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify({
          entity_type: entityType,
          entity_id: entityId,
          content,
          mentions,
        }),
      });
      return readApiJson(res, 'コメントの投稿に失敗しました');
    },
    onSuccess: () => {
      setContent('');
      setMentions([]);
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: (err: Error) => {
      toast.error(messageFromError(err, 'コメントの投稿に失敗しました'));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (commentId: string) => {
      const res = await fetch(buildCommentApiPath(commentId), {
        method: 'DELETE',
        headers: buildOrgHeaders(orgId),
      });
      return readApiJson(res, 'コメントの削除に失敗しました');
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: (err: Error) => {
      toast.error(messageFromError(err, 'コメントの削除に失敗しました'));
    },
  });

  const comments = data?.data ?? [];

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;
    createMutation.mutate();
  }

  const body = (
    <div className="space-y-4">
      <div className="max-h-80 space-y-3 overflow-y-auto">
        {isError ? (
          <div role="alert" className="space-y-1.5 text-sm text-destructive">
            <p>コメントを取得できませんでした。</p>
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0 text-sm"
              onClick={() => void refetch()}
            >
              再試行
            </Button>
          </div>
        ) : isPending ? (
          <div role="status" aria-label="コメントを読み込み中" className="space-y-2 py-1">
            {Array.from({ length: 2 }).map((_, index) => (
              <div key={index} className="flex gap-3">
                <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3 w-1/4" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
              </div>
            ))}
            <span className="sr-only">コメントを読み込み中</span>
          </div>
        ) : comments.length === 0 ? (
          <p className="text-sm text-muted-foreground">コメントはまだありません。</p>
        ) : null}
        {comments.map((comment) => (
          <div key={comment.id} className="flex gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
              {comment.author_name.charAt(0)}
            </span>
            <div className="flex-1 space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{comment.author_name}</span>
                <span className="text-xs text-muted-foreground">
                  {new Date(comment.created_at).toLocaleString('ja-JP', {
                    month: 'numeric',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
                <button
                  type="button"
                  className="ml-auto rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-destructive group-hover:opacity-100 [div:hover>&]:opacity-100"
                  onClick={() => deleteMutation.mutate(comment.id)}
                  disabled={deleteMutation.isPending}
                  aria-label="コメントを削除"
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                </button>
              </div>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                {comment.content}
              </p>
            </div>
          </div>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="space-y-2 border-t border-border pt-3">
        <MentionInput
          value={content}
          onChange={setContent}
          mentions={mentions}
          onMentionsChange={setMentions}
        />
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={!content.trim() || createMutation.isPending}>
            {createMutation.isPending ? '送信中...' : '送信'}
          </Button>
        </div>
      </form>
    </div>
  );

  if (variant === 'bare') {
    return body;
  }

  return (
    <Card className="border-border shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageSquare className="size-4" aria-hidden="true" />
          コメント
          {comments.length > 0 && (
            <span className="text-sm font-normal text-muted-foreground">({comments.length})</span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}
