// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { VehiclesContent } from './vehicles-content';

setupDomTestEnv();

const { useOrgIdMock } = vi.hoisted(() => ({
  useOrgIdMock: vi.fn(),
}));

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useMutation: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
  }),
  useQuery: () => ({
    data: {
      data: [
        {
          id: 'vehicle_1',
          site_id: 'site_1',
          label: '軽バン1号',
          vehicle_code: 'VEH-DEMO-001',
          travel_mode: 'DRIVE',
          max_stops: 8,
          max_route_duration_minutes: null,
          available: true,
          notes: '点検期限 6/21',
          site: { id: 'site_1', name: '本店' },
        },
        {
          id: 'vehicle_2',
          site_id: 'site_1',
          label: '電動自転車1号',
          vehicle_code: 'VEH-DEMO-007',
          travel_mode: 'BICYCLE',
          max_stops: 4,
          max_route_duration_minutes: null,
          available: false,
          notes: null,
          site: { id: 'site_1', name: '本店' },
        },
      ],
    },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

describe('VehiclesContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOrgIdMock.mockReturnValue('org_1');
  });

  it('renders the three columns of the vehicle master', () => {
    render(<VehiclesContent />);

    expect(screen.getByText('カテゴリ')).toBeTruthy();
    expect(screen.getByText('車両 一覧')).toBeTruthy();
    expect(screen.getByText('詳細を編集')).toBeTruthy();
  });

  it('links categories to existing master pages and marks vehicles as current', () => {
    render(<VehiclesContent />);

    expect(screen.getByRole('link', { name: '薬剤' }).getAttribute('href')).toBe(
      '/admin/drug-masters',
    );
    expect(screen.getByRole('link', { name: '医療機関' }).getAttribute('href')).toBe(
      '/admin/institutions',
    );
    expect(screen.getByRole('link', { name: '施設' }).getAttribute('href')).toBe(
      '/admin/facilities',
    );
    expect(screen.getByRole('link', { name: 'スタッフ' }).getAttribute('href')).toBe(
      '/admin/staff',
    );
    expect(screen.getByRole('link', { name: '帳票' }).getAttribute('href')).toBe(
      '/admin/document-templates',
    );

    // 車両は現在地(リンクではなく薄青の現在地表示)。
    expect(screen.queryByRole('link', { name: '車両' })).toBeNull();
    expect(screen.getByText('車両').getAttribute('aria-current')).toBe('page');

    // タグは準備中(リンクなし)。
    expect(screen.queryByRole('link', { name: 'タグ' })).toBeNull();
    expect(screen.getByText('準備中')).toBeTruthy();
  });

  it('lists vehicles with availability labels', () => {
    render(<VehiclesContent />);

    expect(screen.getByRole('button', { name: /軽バン1号/ })).toBeTruthy();
    expect(screen.getByText('有効')).toBeTruthy();
    expect(screen.getByText('停止中')).toBeTruthy();
  });

  it('preselects the first vehicle in the editor', () => {
    render(<VehiclesContent />);

    const firstRow = screen.getByRole('button', { name: /軽バン1号/ });
    expect(firstRow.getAttribute('aria-pressed')).toBe('true');

    const labelInput = screen.getByLabelText('名称') as HTMLInputElement;
    expect(labelInput.value).toBe('軽バン1号');
    const codeInput = screen.getByLabelText('コード') as HTMLInputElement;
    expect(codeInput.value).toBe('VEH-DEMO-001');
    expect(screen.getByLabelText('注意ポイント')).toBeTruthy();
    expect(screen.getByLabelText('稼働状態')).toBeTruthy();
    expect(screen.getByLabelText('最大訪問件数')).toBeTruthy();
    expect(screen.getByRole('button', { name: '保存する' })).toBeTruthy();
  });
});
