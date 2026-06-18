import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Loading } from '@/components/ui/loading';
import { PageScaffold } from '@/components/layout/page-scaffold';
import { SearchContent } from './search-content';
import type { SearchCategory } from './search-result-builders';

export const metadata: Metadata = {
  title: '全体検索 — PH-OS',
};

const VALID_CATEGORIES: SearchCategory[] = [
  'patient',
  'proposal',
  'prescription',
  'medicationDeadline',
  'drug',
  'facility',
  'report',
  'contact',
];

function isSearchCategory(value: unknown): value is SearchCategory {
  return typeof value === 'string' && VALID_CATEGORIES.includes(value as SearchCategory);
}

type SearchPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const resolved = searchParams ? await searchParams : {};
  const q = typeof resolved.q === 'string' ? resolved.q : '';
  const rawCategory = typeof resolved.category === 'string' ? resolved.category : '';
  const initialCategory: SearchCategory = isSearchCategory(rawCategory) ? rawCategory : 'patient';

  return (
    <PageScaffold>
      {/* useSearchParams を内部で使うため Suspense で包む */}
      <Suspense fallback={<Loading />}>
        <SearchContent initialQuery={q} initialCategory={initialCategory} />
      </Suspense>
    </PageScaffold>
  );
}
