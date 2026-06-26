'use client';

import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { useUIStore } from '@/lib/stores/ui-store';
import { cn } from '@/lib/utils';

/**
 * p0_03「使い方を選ぶ」: 今日の入口(薬剤師 / 事務サポート / 管理)を選ぶ。
 * 選択は PATCH /api/me/preferences の work_mode に永続化し、
 * モードのランディング(薬剤師=ダッシュボード / 事務=事務サポート / 管理=管理画面)へ遷移する。
 */

export type WorkModeOption = {
  mode: 'pharmacist' | 'clerk_support' | 'management';
  title: string;
  description: string;
  note: string;
  firstView: string;
  actionLabel: string;
  landingHref: string;
  titleClass: string;
  primary: boolean;
};

export const WORK_MODE_OPTIONS: WorkModeOption[] = [
  {
    mode: 'pharmacist',
    title: '薬剤師モード',
    description: '薬の確認・監査・訪問・報告を進めます',
    note: '患者安全に関わる未完了作業を優先します',
    firstView: '今日の運用・鑑査・訪問準備',
    actionLabel: '薬剤師として入る',
    landingHref: '/dashboard',
    titleClass: 'text-blue-600',
    primary: true,
  },
  {
    mode: 'clerk_support',
    title: '事務サポートモード',
    description: '受付・送付先確認・日程確認を進めます',
    note: '連絡待ちと送付先確認を先に片付けます',
    firstView: '受付・配送・日程確認',
    actionLabel: '事務として入る',
    landingHref: '/clerk-support',
    titleClass: 'text-violet-600',
    primary: false,
  },
  {
    mode: 'management',
    title: '管理モード',
    description: '詰まり・件数・スタッフ負荷を見ます',
    note: '止まっている業務と負荷の偏りを見ます',
    firstView: '詰まり・件数・スタッフ負荷',
    actionLabel: '管理画面へ',
    landingHref: '/admin',
    titleClass: 'text-emerald-600',
    primary: false,
  },
];

export function SelectModeContent() {
  const orgId = useOrgId();
  const router = useRouter();
  const setWorkMode = useUIStore((state) => state.setWorkMode);

  const selectMutation = useMutation({
    mutationFn: async (option: WorkModeOption) => {
      const res = await fetch('/api/me/preferences', {
        method: 'PATCH',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify({ work_mode: option.mode }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(payload.message ?? 'モードの切り替えに失敗しました');
      }
      return option;
    },
    onSuccess: (option) => {
      setWorkMode(option.mode);
      router.push(option.landingHref);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'モードの切り替えに失敗しました');
    },
  });

  return (
    <div
      className="mx-auto w-full max-w-6xl space-y-5 px-3 py-4 md:px-6"
      data-testid="select-mode-page"
    >
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          今日はどの画面から始めますか?
        </h1>
        <p className="hidden text-sm leading-6 text-muted-foreground md:block">
          選んだモードに合わせて、最初に見る作業と通知の優先順を切り替えます。
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {WORK_MODE_OPTIONS.map((option) => (
          <article
            key={option.mode}
            data-testid="select-mode-card"
            className="flex flex-col gap-2 rounded-lg border border-border/70 bg-card p-3 md:gap-3 md:p-4"
          >
            <h2 className={cn('text-lg font-bold', option.titleClass)}>{option.title}</h2>
            <p className="text-sm leading-5 text-foreground">{option.description}</p>
            <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-sm">
              <p className="font-semibold text-foreground">最初に見る: {option.firstView}</p>
              <p className="mt-1 leading-5 text-muted-foreground">{option.note}</p>
            </div>
            <Button
              type="button"
              variant={option.primary ? 'default' : 'outline'}
              className={cn('mt-auto !h-auto !min-h-11 w-full', !option.primary && 'text-primary')}
              onClick={() => selectMutation.mutate(option)}
              disabled={selectMutation.isPending}
            >
              {option.actionLabel}
            </Button>
          </article>
        ))}
      </div>
    </div>
  );
}
