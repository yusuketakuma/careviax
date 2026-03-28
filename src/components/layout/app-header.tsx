'use client';

import { useMemo } from 'react';
import { usePathname } from 'next/navigation';
import { Menu } from 'lucide-react';
import { Breadcrumb, type BreadcrumbItem } from '@/components/layout/breadcrumb';
import { NotificationBell } from '@/components/features/notifications/notification-bell';
import { Button } from '@/components/ui/button';
import { useUIStore } from '@/lib/stores/ui-store';

const SEGMENT_LABELS: Record<string, string> = {
  admin: '管理',
  analytics: '分析',
  audit: '監査',
  'audit-logs': '監査ログ',
  auditing: '鑑査',
  billing: '請求',
  candidates: '候補',
  communications: '連携',
  conferences: 'カンファレンス',
  consent: '同意',
  dashboard: 'ダッシュボード',
  dispensing: '調剤',
  'drug-masters': '医薬品マスタ',
  external: '外部共有',
  'facility-standards': '施設基準',
  login: 'ログイン',
  medications: '服薬中薬剤',
  'medication-calendar': '服薬カレンダー',
  'medication-sets': 'セット',
  new: '新規',
  notifications: '通知',
  patients: '患者',
  performance: '性能',
  pharmacists: '薬剤師',
  prescriptions: '処方履歴',
  realtime: 'リアルタイム',
  referrals: '紹介',
  reports: '報告',
  schedules: 'スケジュール',
  settings: '設定',
  share: '共有',
  shifts: 'シフト',
  uat: 'UAT',
  visits: '訪問',
  workflow: 'ワークフロー',
};

function labelForSegment(segment: string, previous?: string): string {
  if (SEGMENT_LABELS[segment]) return SEGMENT_LABELS[segment];
  if (segment.startsWith('D')) return 'デザイン';
  if (!previous) return '詳細';
  if (previous === 'patients') return '患者詳細';
  if (previous === 'visits') return '訪問詳細';
  if (previous === 'reports') return '報告詳細';
  if (previous === 'dispensing') return '調剤詳細';
  if (previous === 'auditing') return '鑑査詳細';
  if (previous === 'medication-sets') return 'セット詳細';
  return '詳細';
}

export function AppHeader() {
  const pathname = usePathname();
  const { setSidebarOpen } = useUIStore();

  const breadcrumbs = useMemo(() => {
    const segments = pathname.split('/').filter(Boolean);
    const items: BreadcrumbItem[] = [];

    segments.forEach((segment, index) => {
      if (index === 0 && segment === 'dashboard') return;
      const href =
        index < segments.length - 1 ? `/${segments.slice(0, index + 1).join('/')}` : undefined;

      items.push({
        label: labelForSegment(segment, segments[index - 1]),
        href,
      });
    });

    return items;
  }, [pathname]);

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
      <div className="flex min-h-14 items-center justify-between gap-3 px-4 md:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="xl:hidden"
            onClick={() => setSidebarOpen(true)}
            aria-label="メニューを開く"
          >
            <Menu className="size-4" aria-hidden="true" />
          </Button>
          <Breadcrumb items={breadcrumbs} />
        </div>
        <div className="shrink-0">
          <NotificationBell />
        </div>
      </div>
    </header>
  );
}
