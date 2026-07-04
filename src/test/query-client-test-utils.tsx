import { QueryClient, QueryClientProvider, type QueryClientConfig } from '@tanstack/react-query';
import type { ReactNode } from 'react';

export function createTestQueryClient(config: QueryClientConfig = {}) {
  const { defaultOptions, ...rest } = config;

  return new QueryClient({
    ...rest,
    defaultOptions: {
      ...defaultOptions,
      queries: {
        retry: false,
        ...defaultOptions?.queries,
      },
      mutations: {
        retry: false,
        ...defaultOptions?.mutations,
      },
    },
  });
}

export function createQueryClientWrapper(queryClient = createTestQueryClient()) {
  return function QueryClientTestWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}
