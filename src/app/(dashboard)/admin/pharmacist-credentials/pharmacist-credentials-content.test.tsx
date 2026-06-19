// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { PharmacistCredentialsContent } from './pharmacist-credentials-content';

setupDomTestEnv();

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

vi.mock('@tanstack/react-query', () => ({
  useMutation: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) => {
    const key = queryKey[0];

    if (key === 'pharmacist-credentials') {
      return { data: { data: [] }, isLoading: false };
    }

    if (key === 'pharmacist-options') {
      return {
        data: {
          data: [{ id: 'user_1', name: '山田 太郎', site_name: '本店', role: 'pharmacist' }],
        },
        isLoading: false,
      };
    }

    return { data: { data: [] }, isLoading: false };
  },
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
  }),
}));

vi.mock('@/components/ui/data-table', () => ({
  DataTable: () => <div data-testid="credentials-table" />,
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

describe('PharmacistCredentialsContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('associates credential dialog fields with visible labels', () => {
    render(<PharmacistCredentialsContent />);

    fireEvent.click(screen.getByRole('button', { name: '資格を登録' }));

    expect(screen.getByLabelText('対象スタッフ')).toBeTruthy();
    expect(screen.getByLabelText('認定種別')).toBeTruthy();
    expect(screen.getByLabelText('認定番号')).toBeTruthy();
    expect(screen.getByLabelText('交付日')).toBeTruthy();
    expect(screen.getByLabelText('有効期限')).toBeTruthy();
    expect(screen.getByLabelText('在籍年数')).toBeTruthy();
    expect(screen.getByLabelText('週勤務時間')).toBeTruthy();
  });
});
