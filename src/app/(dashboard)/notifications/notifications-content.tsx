'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { Bell, BellOff, CheckCheck, ExternalLink, AlertTriangle, Info, Clock, Cpu } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useOrgId } from '@/lib/hooks/use-org-id';

// --- Types ---

type NotificationType = 'urgent' | 'business' | 'reminder' | 'system';

type Notification = {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  link: string | null;
  is_read: boolean;
  created_at: string;
};

// --- Constants ---

const TYPE_CONFIG: Record<NotificationType, { label: string; icon: React.ElementType; badgeClass: string }> = {
  urgent: { label: '緊急', icon: AlertTriangle, badgeClass: 'bg-red-100 text-red-800 border-red-200' },
  business: { label: '業務', icon: Bell, badgeClass: 'bg-blue-100 text-blue-800 border-blue-200' },
  reminder: { label: 'リマインダー', icon: Clock, badgeClass: 'bg-orange-100 text-orange-800 border-orange-200' },
  system: { label: 'システム', icon: Cpu, badgeClass: 'bg-gray-100 text-gray-700 border-gray-200' },
};

// --- Helpers ---

function NotificationCard({
  notification,
  onRead,
}: {
  notification: Notification;
  onRead: (id: string) => void;
}) {
  const cfg = TYPE_CONFIG[notification.type] ?? TYPE_CONFIG.system;
  const Icon = cfg.icon;

  const timeAgo = formatDistanceToNow(parseISO(notification.created_at), {
    addSuffix: true,
    locale: ja,
  });

  return (
    <Card className={notification.is_read ? 'opacity-70' : 'border-blue-200 bg-blue-50/30'}>
      <CardContent className="flex items-start gap-3 p-4">
        <div className={`mt-0.5 rounded-full p-1.5 ${notification.is_read ? 'bg-muted' : 'bg-blue-100'}`}>
          <Icon
            className={`size-4 ${notification.is_read ? 'text-muted-foreground' : 'text-blue-700'}`}
            aria-hidden="true"
          />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className={`text-[10px] ${cfg.badgeClass}`}
            >
              {cfg.label}
            </Badge>
            {!notification.is_read && (
              <span className="inline-block size-2 rounded-full bg-blue-600" aria-label="未読" />
            )}
          </div>
          <p className="mt-1 text-sm font-medium text-foreground">{notification.title}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{notification.message}</p>
          <div className="mt-2 flex items-center gap-3">
            <span className="text-xs text-muted-foreground">{timeAgo}</span>
            {notification.link && (
              <Link
                href={notification.link}
                className="flex items-center gap-1 text-xs text-blue-700 hover:underline"
              >
                詳細を見る
                <ExternalLink className="size-3" aria-hidden="true" />
              </Link>
            )}
            {!notification.is_read && (
              <button
                onClick={() => onRead(notification.id)}
                className="text-xs text-muted-foreground hover:text-foreground underline"
              >
                既読にする
              </button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// --- Main ---

export function NotificationsContent() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'unread' | 'all'>('unread');

  const { data: unreadData, isLoading: unreadLoading } = useQuery({
    queryKey: ['notifications', orgId, 'unread'],
    queryFn: async () => {
      const res = await fetch('/api/notifications?is_read=false&limit=50', {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('通知の取得に失敗しました');
      return res.json() as Promise<{ data: Notification[] }>;
    },
    enabled: !!orgId,
  });

  const { data: allData, isLoading: allLoading } = useQuery({
    queryKey: ['notifications', orgId, 'all'],
    queryFn: async () => {
      const res = await fetch('/api/notifications?limit=50', {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('通知の取得に失敗しました');
      return res.json() as Promise<{ data: Notification[] }>;
    },
    enabled: !!orgId && tab === 'all',
  });

  const markReadMutation = useMutation({
    mutationFn: async ({ ids, all }: { ids?: string[]; all?: boolean }) => {
      const res = await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify({ ids, all }),
      });
      if (!res.ok) throw new Error('既読更新に失敗しました');
      return res.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['notifications', orgId] });
      if (variables.all) {
        toast.success('全て既読にしました');
      }
    },
    onError: () => toast.error('既読更新に失敗しました'),
  });

  const unreadNotifications = unreadData?.data ?? [];
  const allNotifications = allData?.data ?? [];

  function handleRead(id: string) {
    markReadMutation.mutate({ ids: [id] });
  }

  function handleReadAll() {
    markReadMutation.mutate({ all: true });
  }

  const currentList = tab === 'unread' ? unreadNotifications : allNotifications;
  const isLoading = tab === 'unread' ? unreadLoading : allLoading;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Tabs value={tab} onValueChange={(v) => setTab(v as 'unread' | 'all')}>
          <TabsList>
            <TabsTrigger value="unread">
              未読
              {unreadNotifications.length > 0 && (
                <Badge className="ml-1.5 h-4 min-w-[1rem] px-1 text-[10px] bg-blue-600">
                  {unreadNotifications.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="all">すべて</TabsTrigger>
          </TabsList>
        </Tabs>

        {unreadNotifications.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={handleReadAll}
            disabled={markReadMutation.isPending}
          >
            <CheckCheck className="mr-1.5 size-3.5" aria-hidden="true" />
            全て既読
          </Button>
        )}
      </div>

      {isLoading && (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      )}

      {!isLoading && currentList.length === 0 && (
        <div className="flex min-h-[200px] flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border text-center">
          <BellOff className="size-8 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">
            {tab === 'unread' ? '未読の通知はありません' : '通知はありません'}
          </p>
        </div>
      )}

      <div className="space-y-2">
        {currentList.map((notification) => (
          <NotificationCard
            key={notification.id}
            notification={notification}
            onRead={handleRead}
          />
        ))}
      </div>
    </div>
  );
}
