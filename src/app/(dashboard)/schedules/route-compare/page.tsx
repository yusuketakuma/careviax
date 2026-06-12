import { Metadata } from 'next';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { RouteCompareContent } from './route-compare-content';

export const metadata: Metadata = {
  title: 'ルート案を比べる — PH-OS',
};

type RouteComparePageProps = {
  searchParams?: Promise<{ date?: string }>;
};

/**
 * /schedules/route-compare(p1_12)。本日の訪問予定から合成した 3 つのルート案を
 * 横並びで比較し、採用案を route_order へ反映する。
 */
export default async function RouteComparePage({ searchParams }: RouteComparePageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const initialDate =
    resolvedSearchParams?.date && /^\d{4}-\d{2}-\d{2}$/.test(resolvedSearchParams.date)
      ? resolvedSearchParams.date
      : undefined;

  return (
    <PageScaffold variant="bare">
      <RouteCompareContent initialDate={initialDate} />
    </PageScaffold>
  );
}
