// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { PcaPumpsContent } from './pca-pumps-content';

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
  useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) => {
    const key = queryKey[0];
    if (key === 'pca-pumps') {
      return {
        data: {
          data: [
            {
              id: 'pump_available',
              asset_code: 'PCA-SEED-001',
              serial_number: 'PCASEED001',
              model_name: 'E2E PCAポンプ',
              manufacturer: 'PH-OS Demo',
              status: 'available',
              maintenance_due_at: '2026-12-31',
              notes: null,
              rentals: [],
            },
            {
              id: 'pump_rented',
              asset_code: 'PCA-SEED-002',
              serial_number: 'PCASEED002',
              model_name: 'E2E PCAポンプ',
              manufacturer: 'PH-OS Demo',
              status: 'rented',
              maintenance_due_at: '2026-12-31',
              notes: null,
              rentals: [
                {
                  id: 'rental_active',
                  status: 'active',
                  due_at: '2026-06-30',
                  institution: {
                    id: 'institution_1',
                    name: 'サンプル在宅クリニック',
                    institution_code: '1312345678',
                  },
                },
              ],
            },
          ],
        },
        isLoading: false,
      };
    }
    if (key === 'pca-pump-rentals') {
      return {
        data: {
          data: [
            {
              id: 'rental_active',
              status: 'active',
              rented_at: '2026-06-01',
              due_at: '2026-06-30',
              returned_at: null,
              rental_fee_yen: 12000,
              contact_name: '訪問看護師',
              contact_phone: '03-1234-0003',
              pump: {
                id: 'pump_rented',
                asset_code: 'PCA-SEED-002',
                serial_number: 'PCASEED002',
                model_name: 'E2E PCAポンプ',
                status: 'rented',
              },
              institution: {
                id: 'institution_1',
                name: 'サンプル在宅クリニック',
                institution_code: '1312345678',
                phone: '03-1234-0001',
                fax: '03-1234-0002',
              },
            },
            {
              id: 'rental_returned',
              status: 'returned',
              rented_at: '2026-05-01',
              due_at: '2026-05-31',
              returned_at: '2026-05-20',
              rental_fee_yen: 8000,
              contact_name: null,
              contact_phone: null,
              pump: {
                id: 'pump_returned',
                asset_code: 'PCA-RETURNED',
                serial_number: null,
                model_name: '返却済みポンプ',
                status: 'available',
              },
              institution: {
                id: 'institution_1',
                name: 'サンプル在宅クリニック',
                institution_code: '1312345678',
                phone: null,
                fax: null,
              },
            },
          ],
        },
        isLoading: false,
      };
    }
    if (key === 'prescriber-institutions') {
      return {
        data: {
          data: [
            {
              id: 'institution_1',
              name: 'サンプル在宅クリニック',
              institution_code: '1312345678',
            },
          ],
        },
        isLoading: false,
      };
    }
    return { data: undefined, isLoading: false };
  },
}));

vi.mock('@/components/ui/data-table', () => ({
  DataTable: ({
    data,
  }: {
    data: Array<{ id: string; asset_code?: string; pump?: { asset_code: string } }>;
  }) => (
    <div data-testid="data-table">
      {data.map((row) => (
        <div key={row.id}>{row.asset_code ?? row.pump?.asset_code}</div>
      ))}
    </div>
  ),
}));

describe('PcaPumpsContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOrgIdMock.mockReturnValue('org_1');
  });

  it('shows pump inventory and only open rental rows from seeded PCA data', () => {
    render(<PcaPumpsContent />);

    expect(screen.getByText('PCAポンプ台帳')).toBeTruthy();
    expect(screen.getByText('貸出中・対応待ち')).toBeTruthy();
    expect(screen.getByText('PCA-SEED-001')).toBeTruthy();
    expect(screen.getAllByText('PCA-SEED-002').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('PCA-RETURNED')).toBeNull();
  });
});
