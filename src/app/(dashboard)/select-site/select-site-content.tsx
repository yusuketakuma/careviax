'use client';

import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/loading';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { cn } from '@/lib/utils';

/**
 * p0_02「薬局を選ぶ」: 所属サイトのカードから使う薬局を切り替える。
 * サイト切替(PUT /api/me/site)は監査ログ付きの既存 API を使う。
 */

type MySite = {
  id: string;
  name: string;
  todays_visit_count: number;
  has_home_visit: boolean;
  is_current: boolean;
};

async function fetchMySites(orgId: string): Promise<MySite[]> {
  const res = await fetch('/api/me/sites', { headers: buildOrgHeaders(orgId) });
  if (!res.ok) throw new Error('所属薬局の取得に失敗しました');
  const json = await res.json();
  return json.data;
}

export function SelectSiteContent() {
  const orgId = useOrgId();
  const router = useRouter();
  const queryClient = useQueryClient();

  const sitesQuery = useQuery({
    queryKey: ['me-sites', orgId],
    queryFn: () => fetchMySites(orgId),
    enabled: Boolean(orgId),
  });

  const switchMutation = useMutation({
    mutationFn: async (siteId: string) => {
      const res = await fetch('/api/me/site', {
        method: 'PUT',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify({ site_id: siteId }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(payload.message ?? '薬局の切り替えに失敗しました');
      }
    },
    onSuccess: async () => {
      toast.success('使う薬局を切り替えました');
      await queryClient.invalidateQueries({ queryKey: ['me-sites', orgId] });
      router.push('/dashboard');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '薬局の切り替えに失敗しました');
    },
  });

  const sites = sitesQuery.data ?? [];

  return (
    <div className="space-y-5" data-testid="select-site-page">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          使う薬局を選んでください
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">所属している薬局だけが表示されます。</p>
      </div>

      {!orgId || sitesQuery.isLoading ? (
        <div
          className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
          role="status"
          aria-label="薬局読み込み中"
        >
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-44 w-full rounded-lg" />
          ))}
        </div>
      ) : sitesQuery.isError ? (
        <div className="rounded-lg border border-border/70 bg-card p-4">
          <ErrorState
            variant="server"
            title="薬局一覧を表示できません"
            description="所属薬局の取得に失敗しました。再試行してください。"
            action={{ label: '再試行', onClick: () => void sitesQuery.refetch() }}
          />
        </div>
      ) : sites.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          所属している薬局がありません。管理者にお問い合わせください。
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {sites.map((site) => (
            <article
              key={site.id}
              data-testid="select-site-card"
              className={cn(
                'flex flex-col gap-3 rounded-lg border bg-card p-4',
                site.is_current ? 'border-primary ring-1 ring-primary/30' : 'border-border/70',
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-base font-bold text-foreground">{site.name}</h2>
                {site.is_current ? (
                  <span className="inline-flex shrink-0 items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                    選択中
                  </span>
                ) : null}
              </div>
              <p className="text-sm text-muted-foreground">本日訪問 {site.todays_visit_count}件</p>
              {site.has_home_visit ? (
                <span className="inline-flex w-fit items-center rounded-full bg-tag-info/10 px-2.5 py-0.5 text-xs font-semibold text-tag-info">
                  在宅あり
                </span>
              ) : null}
              <Button
                type="button"
                variant={site.is_current ? 'default' : 'outline'}
                className="mt-auto min-h-11 w-full"
                onClick={() => switchMutation.mutate(site.id)}
                disabled={switchMutation.isPending}
              >
                この薬局を使う
              </Button>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
