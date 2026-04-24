'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { HelpPopover } from '@/components/ui/help-popover';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { useAuthStore } from '@/lib/stores/auth-store';
import { badgeToneClass } from '@/lib/ui/badge-semantics';
import { resolveHandoffEntityAction } from './handoff-board.helpers';
import type { HandoffFilter } from '@/lib/dashboard/home-link-builders';
import { useSyncedSearchParams } from '@/lib/navigation/use-synced-search-params';

type HandoffItem = {
  id: string;
  content: string;
  priority: string;
  entity_type: string | null;
  entity_id: string | null;
  read_by: string[];
  created_by: string;
  created_by_name: string;
  created_at: string;
};

type HandoffBoardData = {
  id: string;
  shift_date: string;
  items: HandoffItem[];
};

const PRIORITY_CONFIG: Record<string, { label: string; className: string }> = {
  urgent: {
    label: '緊急',
    className: badgeToneClass('urgent'),
  },
  high: {
    label: '高',
    className: badgeToneClass('attention'),
  },
  normal: {
    label: '通常',
    className: badgeToneClass('neutral'),
  },
};

const PRIORITY_ORDER = ['urgent', 'high', 'normal'];

type HandoffBoardProps = {
  initialDate?: string;
  initialFilter?: HandoffFilter;
  initialContext?: string | null;
};

function InlineFilterButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        'inline-flex min-h-[36px] items-center rounded-full border px-3 py-1 text-xs font-medium transition-colors',
        active
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-border/70 bg-background text-muted-foreground',
      ].join(' ')}
    >
      {label}
    </button>
  );
}

export function HandoffBoard({
  initialDate,
  initialFilter = 'all',
  initialContext,
}: HandoffBoardProps = {}) {
  const replaceHandoffUrl = useSyncedSearchParams();
  const orgId = useOrgId();
  const userId = useAuthStore((s) => s.currentUser.id);
  const queryClient = useQueryClient();
  const [selectedDate, setSelectedDate] = useState(() => {
    if (initialDate) return initialDate;
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  });
  const [filter, setFilter] = useState<HandoffFilter>(initialFilter);
  const [newContent, setNewContent] = useState('');
  const [newPriority, setNewPriority] = useState('normal');

  const queryKey = ['handoff-board', selectedDate];

  const { data, isLoading } = useQuery<{ data: HandoffBoardData }>({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({ date: selectedDate });
      const res = await fetch(`/api/handoff-board?${params}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('申し送りボードの取得に失敗しました');
      return res.json();
    },
    enabled: !!orgId,
    refetchInterval: 30_000,
  });

  const addItemMutation = useMutation({
    mutationFn: async () => {
      const boardId = data?.data?.id;
      if (!boardId) throw new Error('ボードが見つかりません');
      const res = await fetch('/api/handoff-board/items', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({
          board_id: boardId,
          content: newContent,
          priority: newPriority,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.message ?? '項目の追加に失敗しました');
      }
      return res.json();
    },
    onSuccess: () => {
      setNewContent('');
      setNewPriority('normal');
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const markReadMutation = useMutation({
    mutationFn: async (itemId: string) => {
      const res = await fetch(`/api/handoff-board/items/${itemId}/read`, {
        method: 'PATCH',
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.message ?? '既読処理に失敗しました');
      }
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const board = data?.data;
  const items = board?.items ?? [];
  const contextSummary =
    initialContext === 'dashboard_home'
      ? filter === 'unread'
        ? 'ホームから未読の申し送りにフォーカスして開いています。'
        : 'ホームから申し送り一覧にフォーカスして開いています。'
      : null;

  const sortedItems = [...items].sort((a, b) => {
    const aPriority = PRIORITY_ORDER.indexOf(a.priority);
    const bPriority = PRIORITY_ORDER.indexOf(b.priority);
    if (aPriority !== bPriority) return aPriority - bPriority;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });
  const visibleItems =
    filter === 'unread' && userId
      ? sortedItems.filter((item) => !item.read_by.includes(userId))
      : sortedItems;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!newContent.trim()) return;
    addItemMutation.mutate();
  }

  return (
    <div className="space-y-6">
      {contextSummary ? (
        <Alert className="border-sky-200 bg-sky-50 text-sky-900" data-testid="handoff-context-banner">
          <Clock className="size-4 text-sky-700" aria-hidden="true" />
          <AlertDescription className="text-sky-800">{contextSummary}</AlertDescription>
        </Alert>
      ) : null}
      <SectionIntro
        title="対象日の選択"
        description="まず対象日を選び、その日の申し送りだけに集中できるようにします。"
      />
      <div className="flex flex-wrap items-center gap-4">
        <input
          type="date"
          value={selectedDate}
          onChange={(e) => {
            setSelectedDate(e.target.value);
            replaceHandoffUrl({ date: e.target.value });
          }}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <div className="flex flex-wrap gap-2">
          <InlineFilterButton
            active={filter === 'all'}
            label="全て"
            onClick={() => {
              setFilter('all');
              replaceHandoffUrl({ filter: null });
            }}
          />
          <InlineFilterButton
            active={filter === 'unread'}
            label="未読のみ"
            onClick={() => {
              setFilter('unread');
              replaceHandoffUrl({ filter: 'unread' });
            }}
          />
        </div>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">読み込み中...</p>}

      {!isLoading && visibleItems.length === 0 && (
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="py-8 text-center">
            <p className="text-sm text-muted-foreground">
              {filter === 'unread' ? 'この日の未読申し送りはありません。' : 'この日の申し送り項目はありません。'}
            </p>
          </CardContent>
        </Card>
      )}

      <SectionIntro
        title="申し送り一覧"
        description="優先度順に並んだ申し送りを確認し、関連業務へそのまま移動できます。"
      />
      <div className="space-y-3">
        {visibleItems.map((item) => {
          const isRead = userId ? item.read_by.includes(userId) : false;
          const config = PRIORITY_CONFIG[item.priority] ?? PRIORITY_CONFIG.normal;
          const entityAction = resolveHandoffEntityAction(item);

          return (
            <Card
              key={item.id}
              className={`border-slate-200 shadow-sm ${!isRead ? 'bg-blue-50/50' : ''}`}
            >
              <CardContent className="py-4">
                <div className="flex items-start gap-3">
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={`text-xs ${config.className}`}>
                        {config.label}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{item.created_by_name}</span>
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="size-3" aria-hidden="true" />
                        {new Date(item.created_at).toLocaleString('ja-JP', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                      {item.content}
                    </p>
                    {entityAction && (
                      <Link
                        href={entityAction.href}
                        className="inline-flex min-h-[32px] items-center gap-1 text-xs font-medium text-primary hover:underline"
                      >
                        {entityAction.label}
                        <ArrowRight className="size-3" aria-hidden="true" />
                      </Link>
                    )}
                  </div>
                  <div className="shrink-0">
                    {isRead ? (
                      <Badge
                        variant="outline"
                        className="border-green-300 bg-green-50 text-green-700 text-xs"
                      >
                        <CheckCircle2 className="mr-1 size-3" aria-hidden="true" />
                        確認済み
                      </Badge>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => markReadMutation.mutate(item.id)}
                        disabled={markReadMutation.isPending}
                        className="min-h-[44px] text-xs"
                      >
                        確認済み
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <SectionIntro
        title="新規追加"
        description="必要な引き継ぎ事項を優先度付きで追加し、次シフトへ確実に残します。"
      />
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">新規追加</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-3">
            <Textarea
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              placeholder="申し送り内容を入力..."
              rows={3}
              className="resize-none text-sm"
            />
            <div className="flex items-center gap-3">
              <Select
                value={newPriority}
                onValueChange={(v) => {
                  if (v) setNewPriority(v);
                }}
              >
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="normal">通常</SelectItem>
                  <SelectItem value="high">高</SelectItem>
                  <SelectItem value="urgent">緊急</SelectItem>
                </SelectContent>
              </Select>
              <Button
                type="submit"
                size="sm"
                disabled={!newContent.trim() || addItemMutation.isPending}
                className="min-h-[44px]"
              >
                {addItemMutation.isPending ? '追加中...' : '追加'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function SectionIntro({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex items-center gap-2">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      <HelpPopover title={title} description={description} />
    </div>
  );
}
