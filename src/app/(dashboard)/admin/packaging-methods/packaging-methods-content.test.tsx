// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { PackagingMethodsContent } from './packaging-methods-content';

setupDomTestEnv();

const useOrgIdMock = vi.hoisted(() => vi.fn());
const invalidateQueriesMock = vi.hoisted(() => vi.fn());
const mutateMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({
    data: {
      data: [
        {
          id: 'method_1',
          name: '一包化',
          description: '1回ごとの分包',
          icon_key: 'package',
          sort_order: 1,
          is_active: true,
        },
      ],
    },
  }),
  useMutation: () => ({
    mutate: mutateMock,
    isPending: false,
  }),
  useQueryClient: () => ({
    invalidateQueries: invalidateQueriesMock,
  }),
}));

describe('PackagingMethodsContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOrgIdMock.mockReturnValue('org_1');
  });

  it('renders packaging method master form and existing methods', () => {
    render(<PackagingMethodsContent />);

    expect(screen.getByText('配薬方法を追加')).toBeTruthy();
    expect(screen.getByText('登録済み配薬方法')).toBeTruthy();
    expect(screen.getByRole('switch', { name: '有効' })).toBeTruthy();
    expect(screen.getByText('一包化')).toBeTruthy();
    expect(screen.getByText('1回ごとの分包')).toBeTruthy();
  });

  it('loads an existing method into the form for editing', () => {
    render(<PackagingMethodsContent />);

    fireEvent.click(screen.getByRole('button', { name: /一包化/ }));

    expect(screen.getByText('配薬方法を編集')).toBeTruthy();
    expect((screen.getByLabelText('名称') as HTMLInputElement).value).toBe('一包化');
  });
});
