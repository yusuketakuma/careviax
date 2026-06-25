'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, BarChart3, ClipboardCheck, FileCheck2, ListChecks } from 'lucide-react';
import { z } from 'zod';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/error-state';
import { readApiJson } from '@/lib/api/client-json';
import { buildOrgHeaders } from '@/lib/api/org-headers';
import { useOrgId } from '@/lib/hooks/use-org-id';
import {
  STATISTICS_CATEGORIES,
  type StatisticsCategory,
  type StatisticsSurface,
} from './statistics-surfaces';

// V1 direct-fetch allowlist: the ONLY endpoint the hub fetches on load.
// /api/dashboard/dispensing-stats is org-scoped (withAuthContext + org_id=ctx.orgId),
// permission-gated (canViewDashboard), and returns aggregate counts only (no PHI).
const DISPENSING_STATS_URL = '/api/dashboard/dispensing-stats';

// NOTE: success() = NextResponse.json(data) (src/lib/api/response.ts) returns the RAW object,
// NOT a { data } envelope. So the schema validates the raw success body directly.
// The backing route emits Prisma count()/grouped-count values, so the counts MUST be
// non-negative integers — fail closed (render ErrorState) on impossible negative/decimal payloads
// rather than showing a fabricated KPI.
const nonNegativeCount = z.number().int().nonnegative();
const dispensingStatsSchema = z.object({
  pendingTasks: nonNegativeCount,
  auditPendingTasks: nonNegativeCount,
  completedToday: nonNegativeCount,
});

type DispensingKpiResult =
  | { locked: true }
  | { locked: false; data: z.infer<typeof dispensingStatsSchema> };

function KpiCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Icon className="size-4" aria-hidden="true" />
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-bold tabular-nums">{value.toLocaleString()}</p>
      </CardContent>
    </Card>
  );
}

function DispensingKpiStrip() {
  const orgId = useOrgId();

  const { data, isError, isLoading, refetch } = useQuery<DispensingKpiResult>({
    queryKey: ['statistics-dispensing-kpi', orgId],
    queryFn: async () => {
      const res = await fetch(DISPENSING_STATS_URL, { headers: buildOrgHeaders(orgId) });
      // 403 = no permission for this org: render a locked state, not a false-empty zero.
      if (res.status === 403) return { locked: true };
      const payload = await readApiJson(res, {
        schema: dispensingStatsSchema,
        fallbackMessage: '調剤指標を取得できませんでした。',
      });
      return { locked: false, data: payload };
    },
    enabled: !!orgId,
  });

  const hasData = data !== undefined;

  if (isError && !hasData) {
    return (
      <ErrorState
        variant="server"
        size="inline"
        title="調剤指標を取得できませんでした"
        description="時間をおいて再度お試しください。"
        action={{ label: '再読み込み', onClick: () => void refetch() }}
        live="assertive"
      />
    );
  }

  // While the org id is still hydrating (''), the query is disabled — show the loading
  // skeleton, not a blank area.
  if (!orgId || (isLoading && !hasData)) {
    return (
      <div role="status" aria-label="調剤指標を読み込み中" className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <Card key={index} size="sm">
            <CardContent className="py-8">
              <div className="h-8 w-20 animate-pulse rounded bg-muted" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (data?.locked) {
    return (
      <ErrorState
        variant="forbidden"
        size="inline"
        title="調剤指標は権限により表示できません"
        description="この組織のダッシュボード閲覧権限がありません。"
        live="polite"
      />
    );
  }

  if (!data || data.locked) return null;

  return (
    <div className="space-y-3">
      {isError && hasData && (
        <ErrorState
          variant="server"
          size="inline"
          description="最新の調剤指標を取得できませんでした。表示は前回取得した値です。"
          action={{
            label: '再読み込み',
            onClick: () => void refetch(),
            variant: 'outline',
            size: 'sm',
          }}
          live="polite"
        />
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard icon={ListChecks} label="調剤 未着手" value={data.data.pendingTasks} />
        <KpiCard icon={ClipboardCheck} label="鑑査待ち" value={data.data.auditPendingTasks} />
        <KpiCard icon={FileCheck2} label="本日完了" value={data.data.completedToday} />
      </div>
    </div>
  );
}

export function StatisticsContent({ surfaces }: { surfaces: StatisticsSurface[] }) {
  return (
    <div className="space-y-8">
      <section className="space-y-3" aria-labelledby="statistics-headline-heading">
        <h2
          id="statistics-headline-heading"
          className="flex items-center gap-2 text-base font-semibold"
        >
          <BarChart3 className="size-4 text-muted-foreground" aria-hidden="true" />
          今日の調剤指標
        </h2>
        <DispensingKpiStrip />
      </section>

      {STATISTICS_CATEGORIES.map((category) => {
        const categorySurfaces = surfaces.filter((surface) => surface.category === category);
        if (categorySurfaces.length === 0) return null;
        return (
          <StatisticsCategorySection
            key={category}
            category={category}
            surfaces={categorySurfaces}
          />
        );
      })}
    </div>
  );
}

function StatisticsCategorySection({
  category,
  surfaces,
}: {
  category: StatisticsCategory;
  surfaces: StatisticsSurface[];
}) {
  const headingId = `statistics-category-${category}`;
  return (
    <section className="space-y-3" aria-labelledby={headingId}>
      <h2 id={headingId} className="text-base font-semibold">
        {category}
      </h2>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {surfaces.map((surface) => (
          <Link
            key={surface.id}
            href={surface.href}
            className="group flex flex-col gap-1 rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/50 hover:bg-accent"
          >
            <span className="flex items-center justify-between gap-2 text-sm font-medium">
              {surface.label}
              <ArrowRight
                className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </span>
            <span className="text-xs leading-5 text-muted-foreground">{surface.description}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
