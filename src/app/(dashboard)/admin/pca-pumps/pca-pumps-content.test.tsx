// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
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

const { queryErrorKeysMock, queryRefetchMock, useOrgIdMock } = vi.hoisted(() => ({
  queryErrorKeysMock: new Set<string>(),
  queryRefetchMock: vi.fn(),
  useOrgIdMock: vi.fn(),
}));

const mutationMutateMock = vi.hoisted(() => vi.fn());

function queryState(key: string) {
  return {
    isError: queryErrorKeysMock.has(key),
    refetch: queryRefetchMock,
  };
}

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useMutation: () => ({
    mutate: mutationMutateMock,
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
        ...queryState('pca-pumps'),
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
          ...queryState('pca-pump-rentals:return-inspection-pending'),
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
        ...queryState('pca-pump-rentals'),
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
        ...queryState('prescriber-institutions'),
      };
    }
    return { data: undefined, isLoading: false, isError: false, refetch: queryRefetchMock };
  },
}));

vi.mock('@/components/ui/data-table', () => ({
  DataTable: ({
    data,
    errorMessage,
    onRetry,
  }: {
    data: Array<{ id: string; asset_code?: string; pump?: { asset_code: string } }>;
    errorMessage?: string;
    onRetry?: () => void;
  }) => (
    <div data-testid="data-table">
      {errorMessage ? (
        <div role="alert">
          <p>{errorMessage}</p>
          {onRetry ? (
            <button type="button" onClick={onRetry}>
              再読み込み
            </button>
          ) : null}
        </div>
      ) : null}
      {data.map((row) => (
        <div key={row.id}>{row.asset_code ?? row.pump?.asset_code}</div>
      ))}
    </div>
  ),
}));

vi.mock('@/components/ui/select', async () => {
  const React = await import('react');

  function collectItems(children: React.ReactNode): Array<{ value: string; label: string }> {
    const items: Array<{ value: string; label: string }> = [];
    React.Children.forEach(children, (child) => {
      if (!React.isValidElement(child)) return;
      const props = child.props as { value?: string; children?: React.ReactNode };
      if (props.value) {
        items.push({
          value: props.value,
          label: React.Children.toArray(props.children).join(''),
        });
      }
      items.push(...collectItems(props.children));
    });
    return items;
  }

  type TriggerProps = {
    id?: string;
    'aria-describedby'?: string;
    'aria-invalid'?: boolean;
    children?: React.ReactNode;
  };

  function findTriggerProps(children: React.ReactNode): TriggerProps | undefined {
    let triggerProps: TriggerProps | undefined;
    React.Children.forEach(children, (child) => {
      if (!React.isValidElement(child)) return;
      const props = child.props as TriggerProps;
      if (props.id) {
        triggerProps = props;
      }
      if (!triggerProps) triggerProps = findTriggerProps(props.children);
    });
    return triggerProps;
  }

  function MockSelect({
    value,
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange?: (value: string) => void;
    children: ReactNode;
  }) {
    const triggerProps = findTriggerProps(children);

    return (
      <select
        id={triggerProps?.id}
        aria-describedby={triggerProps?.['aria-describedby']}
        aria-invalid={triggerProps?.['aria-invalid']}
        value={value}
        onChange={(event) => onValueChange?.(event.target.value)}
      >
        {collectItems(children).map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>
    );
  }

  return {
    Select: MockSelect,
    SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
    SelectItem: ({ children }: { children: ReactNode }) => <>{children}</>,
    SelectTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
    SelectValue: ({ placeholder }: { placeholder?: string }) => <>{placeholder ?? null}</>,
  };
});

describe('PcaPumpsContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryErrorKeysMock.clear();
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
    expect(
      screen.getByRole('button', {
        name: /検品 PCA-RETURNED サンプル在宅クリニック 返却日 2026\/6\/8/,
      }),
    ).toBeTruthy();
  });

  it('prioritizes return inspections before the inventory table', () => {
    render(<PcaPumpsContent />);

    const returnInspectionTitle = screen.getByText('返却検品待ち');
    const inventoryTitle = screen.getByText('PCAポンプ台帳');
    expect(
      returnInspectionTitle.compareDocumentPosition(inventoryTitle) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    expect(
      screen.getByRole('button', {
        name: /検品 PCA-RETURNED サンプル在宅クリニック 返却日 2026\/6\/8/,
      }).className,
    ).toContain('h-11');
    expect(screen.getByRole('button', { name: '貸出登録' }).className).toContain('h-11');
    expect(screen.getByRole('button', { name: 'ポンプ登録' }).className).toContain('h-11');
    expect(screen.getByLabelText('検索').className).toContain('h-11');
  });

  it('passes pump inventory failures to DataTable instead of showing a false empty table', () => {
    queryErrorKeysMock.add('pca-pumps');

    render(<PcaPumpsContent />);

    expect(screen.getByRole('alert').textContent).toContain('PCAポンプ台帳を取得できませんでした');

    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }));

    expect(queryRefetchMock).toHaveBeenCalled();
  });

  it('passes rental list failures to DataTable instead of showing a false empty table', () => {
    queryErrorKeysMock.add('pca-pump-rentals');

    render(<PcaPumpsContent />);

    expect(screen.getByRole('alert').textContent).toContain(
      'PCAポンプ貸出一覧を取得できませんでした',
    );
  });

  it('surfaces rental required fields and date/fee blockers inline before mutation', () => {
    render(<PcaPumpsContent />);

    fireEvent.click(screen.getByRole('button', { name: '貸出登録' }));

    const pumpSelect = screen.getByLabelText('PCAポンプ') as HTMLSelectElement;
    const institutionSelect = screen.getByLabelText('貸出先医療機関') as HTMLSelectElement;
    const rentedAtInput = screen.getByLabelText('貸出日') as HTMLInputElement;
    const dueAtInput = screen.getByLabelText('返却予定日') as HTMLInputElement;
    const feeInput = screen.getByLabelText('請求予定額') as HTMLInputElement;
    const saveButton = screen.getAllByRole('button', { name: '貸出登録' }).at(-1) as
      | HTMLButtonElement
      | undefined;
    expect(saveButton).toBeTruthy();

    expect(saveButton!.disabled).toBe(true);
    expect(saveButton!.getAttribute('aria-describedby')).toBe('rental-save-blocker');
    expect(pumpSelect.getAttribute('aria-invalid')).toBe('true');
    expect(pumpSelect.getAttribute('aria-describedby')).toBe('rental-pump-help rental-pump-error');
    expect(institutionSelect.getAttribute('aria-invalid')).toBe('true');
    expect(institutionSelect.getAttribute('aria-describedby')).toBe(
      'rental-institution-help rental-institution-error',
    );
    expect(screen.getAllByText('PCAポンプを選択してください。')).toHaveLength(2);

    fireEvent.change(pumpSelect, { target: { value: 'pump_available' } });
    fireEvent.change(institutionSelect, { target: { value: 'institution_1' } });
    fireEvent.change(rentedAtInput, { target: { value: '2026-06-10' } });
    fireEvent.change(dueAtInput, { target: { value: '2026-06-09' } });
    fireEvent.change(feeInput, { target: { value: '12.5' } });

    expect(screen.getAllByText('返却予定日は貸出日以降の日付を指定してください。')).toHaveLength(2);
    expect(screen.getByText('請求予定額は0以上の整数で入力してください。')).toBeTruthy();
    expect(dueAtInput.min).toBe('2026-06-10');
    expect(dueAtInput.getAttribute('aria-invalid')).toBe('true');
    expect(feeInput.step).toBe('1');
    expect(feeInput.inputMode).toBe('numeric');
    expect(saveButton!.disabled).toBe(true);
    expect(saveButton!.getAttribute('aria-describedby')).toBe('rental-save-blocker');

    fireEvent.click(saveButton!);
    expect(mutationMutateMock).not.toHaveBeenCalled();
  });

  it('explains return inspection blockers and item errors before mutation', () => {
    render(<PcaPumpsContent />);

    fireEvent.click(
      screen.getByRole('button', {
        name: /検品 PCA-RETURNED サンプル在宅クリニック 返却日 2026\/6\/8/,
      }),
    );

    const saveButton = screen.getByRole('button', { name: '検品完了' }) as HTMLButtonElement;
    const pumpBodySelect = screen.getByLabelText('ポンプ本体') as HTMLSelectElement;
    const pumpBodyNote = screen.getByLabelText('ポンプ本体の検品メモ') as HTMLInputElement;

    expect(saveButton.disabled).toBe(true);
    expect(saveButton.getAttribute('aria-describedby')).toBe('return-inspection-save-blocker');
    expect(screen.getByText(/未確認の検品項目があります: ポンプ本体/)).toBeTruthy();
    expect(pumpBodySelect.getAttribute('aria-invalid')).toBe('true');
    expect(pumpBodySelect.getAttribute('aria-describedby')).toBe(
      'inspection-pump_body-status-error',
    );
    expect(screen.getAllByText('検品状態を選択してください。').length).toBeGreaterThanOrEqual(1);

    fireEvent.change(pumpBodySelect, { target: { value: 'missing' } });

    expect(pumpBodyNote.placeholder).toBe('不足・破損の詳細');
    expect(pumpBodyNote.getAttribute('aria-invalid')).toBe('true');
    expect(pumpBodyNote.getAttribute('aria-describedby')).toBe('inspection-pump_body-note-error');
    expect(screen.getByText('不足・破損の詳細メモを入力してください。')).toBeTruthy();

    fireEvent.click(saveButton);
    expect(mutationMutateMock).not.toHaveBeenCalled();

    for (const item of PCA_RETURN_INSPECTION_ITEMS) {
      fireEvent.change(screen.getByLabelText(item.label), { target: { value: 'ok' } });
    }

    expect(saveButton.disabled).toBe(false);
    expect(saveButton.getAttribute('aria-describedby')).toBeNull();
    fireEvent.click(saveButton);
    expect(mutationMutateMock).toHaveBeenCalledTimes(1);
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
