'use client';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const deviceSupportRows = [
  {
    screen: 'ダッシュボード',
    desktop: '◎フル',
    tablet: '◎フル',
    mobile: '○簡易版',
  },
  {
    screen: 'スケジュールカレンダー',
    desktop: '◎月/週/日',
    tablet: '○週/日',
    mobile: '○日+リスト',
  },
  {
    screen: '本日の訪問',
    desktop: '◎',
    tablet: '◎',
    mobile: '◎主要画面',
  },
  {
    screen: '訪問記録(SOAP)',
    desktop: '◎',
    tablet: '◎主要入力',
    mobile: '○最小入力',
  },
  {
    screen: '調剤キュー/鑑査',
    desktop: '◎',
    tablet: '○',
    mobile: '×非対応',
  },
  {
    screen: '処方エディタ',
    desktop: '◎',
    tablet: '○',
    mobile: '×非対応',
  },
  {
    screen: '管理設定',
    desktop: '◎',
    tablet: '○',
    mobile: '×非対応',
  },
] as const;

function SupportBadge({ value }: { value: string }) {
  const tone = value.startsWith('◎')
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : value.startsWith('○')
      ? 'bg-amber-50 text-amber-700 border-amber-200'
      : 'bg-slate-100 text-slate-600 border-slate-200';

  return (
    <Badge variant="outline" className={cn('justify-start font-medium', tone)}>
      {value}
    </Badge>
  );
}

export function DeviceSupportMatrix() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>デバイス対応マトリクス</CardTitle>
        <CardDescription>
          現行 breakpoint 実装に合わせた推奨端末です。モバイルは訪問運用に集中し、調剤系と管理設定は desktop/tablet を前提にします。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="hidden overflow-x-auto lg:block">
          <table className="w-full border-separate border-spacing-0 overflow-hidden rounded-lg border text-sm">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>
                <th className="border-b px-4 py-3 font-medium">画面</th>
                <th className="border-b px-4 py-3 font-medium">デスクトップ</th>
                <th className="border-b px-4 py-3 font-medium">タブレット</th>
                <th className="border-b px-4 py-3 font-medium">モバイル</th>
              </tr>
            </thead>
            <tbody>
              {deviceSupportRows.map((row) => (
                <tr key={row.screen} className="odd:bg-white even:bg-slate-50/60">
                  <td className="border-b px-4 py-3 font-medium text-foreground">{row.screen}</td>
                  <td className="border-b px-4 py-3"><SupportBadge value={row.desktop} /></td>
                  <td className="border-b px-4 py-3"><SupportBadge value={row.tablet} /></td>
                  <td className="border-b px-4 py-3"><SupportBadge value={row.mobile} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid gap-3 lg:hidden">
          {deviceSupportRows.map((row) => (
            <div key={row.screen} className="rounded-lg border p-4">
              <h3 className="text-sm font-semibold text-foreground">{row.screen}</h3>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">デスクトップ</p>
                  <SupportBadge value={row.desktop} />
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">タブレット</p>
                  <SupportBadge value={row.tablet} />
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">モバイル</p>
                  <SupportBadge value={row.mobile} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
