// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { IncidentsContent } from './incidents-content';

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

setupDomTestEnv();

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('IncidentsContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 })),
    );
  });

  it('connects the empty-list disabled reason to memo controls and blocks direct submit', async () => {
    render(<IncidentsContent />, { wrapper: createWrapper() });

    // 空一覧は共通 EmptyState で表示される(タイトルに句点なし)
    expect(await screen.findByText('ヒヤリハット記録はまだありません')).toBeTruthy();

    const disabledReason = screen.getByText('記録一覧に記録がないため入力できません。');
    const whatHappenedInput = screen.getByLabelText('起きたこと');
    const processSelect = screen.getByTestId('incident-related-process');
    const saveButton = screen.getByRole('button', { name: '不足ありで保存' });

    expect(whatHappenedInput).toHaveProperty('disabled', true);
    expect(whatHappenedInput.getAttribute('aria-describedby')).toBe(disabledReason.id);
    expect(processSelect.getAttribute('aria-describedby')).toBe(disabledReason.id);
    expect(saveButton).toHaveProperty('disabled', true);
    expect(saveButton.getAttribute('aria-describedby')).toBe(disabledReason.id);
    expect(disabledReason.textContent).not.toMatch(/patient_|incident_|山田|太郎/);

    fireEvent.submit(screen.getByTestId('incident-memo-form'));

    await waitFor(() => {
      expect(
        vi
          .mocked(fetch)
          .mock.calls.some(
            ([input, init]) =>
              String(input).startsWith('/api/incident-reports/') && init?.method === 'PATCH',
          ),
      ).toBe(false);
    });
  });
});
