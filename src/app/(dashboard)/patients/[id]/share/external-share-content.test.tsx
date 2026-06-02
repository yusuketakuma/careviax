// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const useMutationMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const useOrgIdMock = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-query', () => ({
  useMutation: useMutationMock,
  useQuery: useQueryMock,
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

import { ExternalShareContent } from './external-share-content';

setupDomTestEnv();

describe('ExternalShareContent', () => {
  it('renders share setup and history with semantic section headings', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useQueryMock.mockReturnValue({
      data: {
        external_shares: [
          {
            id: 'share_1',
            granted_to_name: '田中ケアマネジャー',
            expires_at: '2026-06-03T00:00:00.000Z',
            accessed_at: null,
          },
        ],
        self_reports: [
          {
            id: 'report_1',
            subject: '疼痛の相談',
            created_at: '2026-06-01T00:00:00.000Z',
            status: 'open',
          },
        ],
      },
      isLoading: false,
    });

    render(<ExternalShareContent patientId="patient_1" />);

    expect(screen.getByRole('heading', { level: 2, name: '共有設定' }).tagName).toBe('H2');
    expect(
      screen.getByRole('heading', { level: 2, name: '共有済みリンクと連絡文脈' }).tagName,
    ).toBe('H2');
    expect(screen.getByRole('button', { name: /共有リンクを発行/ })).toBeTruthy();
    expect(screen.getByText('田中ケアマネジャー')).toBeTruthy();
    expect(screen.getByText('疼痛の相談')).toBeTruthy();
  });
});
