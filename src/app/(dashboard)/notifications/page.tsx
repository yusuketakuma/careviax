import { Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '@/components/ui/loading';
import { NotificationsContent } from './notifications-content';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { readNotificationsState } from './notifications-query-state';

export const metadata: Metadata = {
  title: 'お知らせ — PH-OS',
};

type NotificationsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function NotificationsPage({ searchParams }: NotificationsPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const initialState = readNotificationsState(resolvedSearchParams);

  return (
    <PageScaffold>
      <Suspense fallback={<Loading />}>
        <NotificationsContent initialCategory={initialState.initialCategory} />
      </Suspense>
    </PageScaffold>
  );
}
