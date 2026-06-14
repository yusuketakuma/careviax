import { Metadata } from 'next';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { ConflictResolutionContent } from './conflict-resolution-content';

export const metadata: Metadata = {
  title: '予定の重なりを直す — PH-OS',
};

type ConflictsPageProps = {
  searchParams?: Promise<{ date?: string }>;
};

/**
 * /schedules/conflicts(p0_19)。当日の訪問予定から、同一薬剤師の時間帯重複と
 * 同一社用車の同時使用を検知し、重なり一覧と調整案 A/B/C を提示する。
 */
export default async function ConflictsPage({ searchParams }: ConflictsPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const initialDate =
    resolvedSearchParams?.date && /^\d{4}-\d{2}-\d{2}$/.test(resolvedSearchParams.date)
      ? resolvedSearchParams.date
      : undefined;

  return (
    <PageScaffold variant="bare">
      <ConflictResolutionContent initialDate={initialDate} />
    </PageScaffold>
  );
}
