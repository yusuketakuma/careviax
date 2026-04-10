'use client';

import { startTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { mergeSearchParams } from './search-params';

type Patch = Record<string, string | null | undefined>;

export function useReplaceSearchParams() {
  const router = useRouter();
  const pathname = usePathname();

  return (next: URLSearchParams) => {
    startTransition(() => {
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    });
  };
}

export function useSyncedSearchParams() {
  const searchParams = useSearchParams();
  const replaceSearchParams = useReplaceSearchParams();

  return (patch: Patch) => {
    const next = mergeSearchParams({
      params: new URLSearchParams(searchParams.toString()),
      patch,
    });
    replaceSearchParams(next);
  };
}
