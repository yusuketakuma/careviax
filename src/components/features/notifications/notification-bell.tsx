'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Bell } from 'lucide-react';
import { useOrgId } from '@/lib/hooks/use-org-id';

type Notification = {
  id: string;
  type: string;
  message: string;
  created_at: string;
  is_read: boolean;
};

export function NotificationBell() {
  const orgId = useOrgId();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // SSE connection via fetch (EventSource does not support custom headers)
  useEffect(() => {
    if (!orgId) return;
    const controller = new AbortController();
    abortRef.current = controller;

    (async () => {
      try {
        const res = await fetch('/api/notifications/stream', {
          headers: { 'x-org-id': orgId },
          signal: controller.signal,
        });
        if (!res.body) return;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n\n');
          buffer = lines.pop() ?? '';
          for (const chunk of lines) {
            if (chunk.startsWith('data: ')) {
              const json = chunk.slice(6);
              try {
                const items = JSON.parse(json) as Notification[];
                setNotifications((prev) => {
                  const merged = [...items, ...prev];
                  const unique = merged.filter(
                    (n, i, a) => a.findIndex((x) => x.id === n.id) === i
                  );
                  return unique.slice(0, 50);
                });
              } catch {
                // Ignore malformed JSON chunks
              }
            }
          }
        }
      } catch {
        // Connection closed or aborted — expected on unmount
      }
    })();

    return () => controller.abort();
  }, [orgId]);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const markAllRead = useCallback(async () => {
    if (!orgId) return;
    const ids = notifications.filter((n) => !n.is_read).map((n) => n.id);
    if (!ids.length) return;
    await fetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
      body: JSON.stringify({ ids }),
    });
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
  }, [orgId, notifications]);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative rounded-md p-2 hover:bg-accent"
        aria-label={`通知${unreadCount > 0 ? ` ${unreadCount}件の未読` : ''}`}
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <Bell className="size-5" aria-hidden="true" />
        {unreadCount > 0 && (
          <span
            className="absolute -right-0.5 -top-0.5 flex size-4.5 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground"
            aria-hidden="true"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-label="通知一覧"
          className="absolute right-0 top-full z-50 mt-2 w-80 rounded-lg border bg-popover shadow-lg"
        >
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-sm font-semibold">通知</span>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                全て既読にする
              </button>
            )}
          </div>
          <div className="max-h-64 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                通知はありません
              </div>
            ) : (
              notifications.slice(0, 10).map((n) => (
                <div
                  key={n.id}
                  className={`border-b px-3 py-2 text-sm last:border-0 ${n.is_read ? 'opacity-60' : ''}`}
                >
                  <p className="text-foreground">{n.message}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {new Date(n.created_at).toLocaleString('ja-JP')}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
