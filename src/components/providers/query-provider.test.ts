import { describe, expect, it } from 'vitest';

import { createCareViaxQueryClient } from './query-provider';

describe('createCareViaxQueryClient', () => {
  it('uses conservative app-wide refetch defaults', () => {
    const queryClient = createCareViaxQueryClient();

    expect(queryClient.getDefaultOptions().queries).toMatchObject({
      staleTime: 60_000,
      gcTime: 300_000,
      retry: 1,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    });
  });
});
