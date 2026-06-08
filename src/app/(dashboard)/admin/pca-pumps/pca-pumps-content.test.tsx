// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import {
  buildPcaPumpStatusUpdatePayload,
  buildPcaReturnInspectionPayload,
  createDefaultPcaReturnInspectionChecklist,
  getPcaReturnInspectionMissingNoteLabels,
  getPcaReturnInspectionUncheckedLabels,
  PcaPumpsContent,
  PCA_RETURN_INSPECTION_ITEMS,
} from './pca-pumps-content';

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
              maintenance_events: [
                {
                  id: 'event_1',
                  event_type: 'maintenance_completed',
                  result: 'available',
                  performed_at: '2026-06-08T01:00:00.000Z',
                  performed_by: 'user_1',
                  notes: '整備完了',
                  next_maintenance_due_at: '2026-12-31',
                },
              ],
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
              maintenance_events: [],
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
      if (queryKey[2] === 'return-inspection-pending') {
        return {
          data: {
            data: [
              {
                id: 'rental_returned_pending',
                status: 'returned',
                rented_at: '2026-06-01',
                due_at: '2026-06-07',
                returned_at: '2026-06-08',
                return_inspection_status: 'pending',
                return_inspection_notes: null,
                accessory_checklist: null,
                inspected_at: null,
                inspected_by: null,
                rental_fee_yen: 12000,
                contact_name: '訪問看護師',
                contact_phone: '03-1234-0003',
                pump: {
                  id: 'pump_returned',
                  asset_code: 'PCA-RETURNED',
                  serial_number: 'PCASEED003',
                  model_name: 'E2E PCAポンプ',
                  status: 'maintenance',
                },
                institution: {
                  id: 'institution_1',
                  name: 'サンプル在宅クリニック',
                  institution_code: '1312345678',
                  phone: '03-1234-0001',
                  fax: '03-1234-0002',
                },
              },
            ],
          },
          isLoading: false,
        };
      }
      return {
        data: {
          data: [
            {
              id: 'rental_active',
              status: 'active',
              rented_at: '2026-06-01',
              due_at: '2026-06-30',
              returned_at: null,
              return_inspection_status: null,
              return_inspection_notes: null,
              accessory_checklist: null,
              inspected_at: null,
              inspected_by: null,
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
    expect(screen.getByText('返却検品待ち')).toBeTruthy();
    expect(screen.getByText('PCA-SEED-001')).toBeTruthy();
    expect(screen.getAllByText('PCA-SEED-002').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/PCA-RETURNED/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '検品' })).toBeTruthy();
  });

  it('starts return inspection items as unchecked', () => {
    const checklist = createDefaultPcaReturnInspectionChecklist();

    expect(getPcaReturnInspectionUncheckedLabels(checklist)).toContain('ポンプ本体');
    expect(() =>
      buildPcaReturnInspectionPayload({
        notes: '動作確認済み',
        checklist,
      }),
    ).toThrow('未確認の検品項目があります');
  });

  it('builds a passed return inspection payload when every checklist item is explicitly ok', () => {
    const checklist = createDefaultPcaReturnInspectionChecklist();
    for (const item of PCA_RETURN_INSPECTION_ITEMS) {
      checklist[item.key] = { status: 'ok', notes: '' };
    }

    expect(
      buildPcaReturnInspectionPayload({
        notes: '動作確認済み',
        checklist,
      }),
    ).toMatchObject({
      return_inspection_status: 'passed',
      return_inspection_notes: '動作確認済み',
      accessory_checklist: {
        pump_body: { status: 'ok', notes: null },
        operation_check: { status: 'ok', notes: null },
      },
    });
  });

  it('builds a maintenance payload and requires notes for missing or damaged items', () => {
    const checklist = createDefaultPcaReturnInspectionChecklist();
    for (const item of PCA_RETURN_INSPECTION_ITEMS) {
      checklist[item.key] = { status: 'ok', notes: '' };
    }
    checklist.power_adapter = { status: 'missing', notes: '' };
    checklist.operation_check = { status: 'damaged', notes: 'アラーム鳴動なし' };

    expect(getPcaReturnInspectionMissingNoteLabels(checklist)).toEqual(['ACアダプタ']);

    checklist.power_adapter.notes = '医療機関で紛失';
    expect(getPcaReturnInspectionMissingNoteLabels(checklist)).toEqual([]);
    expect(
      buildPcaReturnInspectionPayload({
        notes: '',
        checklist,
      }),
    ).toMatchObject({
      return_inspection_status: 'needs_maintenance',
      return_inspection_notes: null,
      accessory_checklist: {
        power_adapter: { status: 'missing', notes: '医療機関で紛失' },
        operation_check: { status: 'damaged', notes: 'アラーム鳴動なし' },
      },
    });
  });

  it('adds a maintenance completion event payload when marking a maintained pump available', () => {
    expect(
      buildPcaPumpStatusUpdatePayload({
        currentStatus: 'maintenance',
        nextStatus: 'available',
      }),
    ).toEqual({
      status: 'available',
      maintenance_event_type: 'maintenance_completed',
      maintenance_result: 'available',
      maintenance_notes: '整備完了（台帳操作）',
      maintenance_due_at: null,
    });
  });
});
