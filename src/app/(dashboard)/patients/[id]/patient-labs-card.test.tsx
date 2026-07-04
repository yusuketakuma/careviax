// @vitest-environment jsdom

import * as React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { jsonResponse } from '@/test/fetch-test-utils';
import { buildOrgHeaders } from '@/lib/api/org-headers';
import { buildPatientApiPath } from '@/lib/patient/api-paths';
import { PatientLabsCard } from './patient-labs-card';

setupDomTestEnv();

const useQueryMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() => vi.fn());
const useQueryClientMock = vi.hoisted(() => vi.fn());
const mutateMock = vi.hoisted(() => vi.fn());

type QueryOptions = {
  queryKey: unknown[];
  queryFn: () => Promise<unknown>;
  enabled?: boolean;
};

type MutationOptions<TInput = void> = {
  mutationFn: (input: TInput) => Promise<unknown>;
  onSuccess?: () => Promise<void> | void;
};

type LabFixture = {
  id: string;
  analyte_code: string;
  measured_at: string;
  value_numeric: number | null;
  value_text: string | null;
  unit: string | null;
  abnormal_flag: string | null;
  reference_low: number | null;
  reference_high: number | null;
  source_type: 'manual' | 'visit_record' | 'import';
  source_visit_record_id: string | null;
  note: string | null;
  created_at: string;
};

const capturedSelectItems: Array<{
  value: string;
  label: string;
  className?: string;
}> = [];

const capturedSelectTriggers: Array<{
  id?: string;
  className?: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
}> = [];

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
  useMutation: useMutationMock,
  useQueryClient: useQueryClientMock,
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/lib/patient/api-paths', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/patient/api-paths')>();
  return { ...actual, buildPatientApiPath: vi.fn(actual.buildPatientApiPath) };
});

vi.mock('@/components/ui/select', async () => {
  type SelectProps = {
    value?: string;
    onValueChange?: (value: string) => void;
    children?: React.ReactNode;
  };
  type TriggerProps = {
    id?: string;
    className?: string;
    'aria-label'?: string;
    'aria-labelledby'?: string;
    children?: React.ReactNode;
  };
  type ItemProps = {
    value: string;
    className?: string;
    children?: React.ReactNode;
  };

  type SelectValueProps = {
    children?: React.ReactNode | ((value: unknown) => React.ReactNode);
  };

  const SelectItem = ({ children }: ItemProps) => <>{children}</>;
  const SelectTrigger = ({ children }: TriggerProps) => <>{children}</>;
  // 閉じた SelectTrigger のラベル契約を担うマーカー。children(value→label) は Select 側で解決する。
  const SelectValue: React.FC<SelectValueProps> = () => null;
  const SelectContent = ({ children }: { children?: React.ReactNode }) => <>{children}</>;

  function flattenText(node: React.ReactNode): string {
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(flattenText).join('');
    if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
      return flattenText(node.props.children);
    }
    return '';
  }

  function collect(
    node: React.ReactNode,
    items: Array<{ value: string; label: string; className?: string }>,
    found: { selectValue?: SelectValueProps['children'] },
  ): TriggerProps | null {
    let triggerProps: TriggerProps | null = null;
    React.Children.forEach(node, (child) => {
      if (!React.isValidElement(child)) return;
      if (child.type === SelectTrigger) {
        triggerProps = child.props as TriggerProps;
      }
      if (child.type === SelectValue && found.selectValue === undefined) {
        found.selectValue = (child.props as SelectValueProps).children;
      }
      if (child.type === SelectItem) {
        const props = child.props as ItemProps;
        const item = {
          value: props.value,
          label: flattenText(props.children),
          className: props.className,
        };
        items.push(item);
        capturedSelectItems.push(item);
      }
      const nested = collect(
        (child.props as { children?: React.ReactNode }).children,
        items,
        found,
      );
      if (nested) triggerProps = nested;
    });
    return triggerProps;
  }

  const Select = ({ value, onValueChange, children }: SelectProps) => {
    const items: Array<{ value: string; label: string; className?: string }> = [];
    const found: { selectValue?: SelectValueProps['children'] } = {};
    const triggerProps = collect(children, items, found) ?? {};
    capturedSelectTriggers.push({
      id: triggerProps.id,
      className: triggerProps.className,
      ariaLabel: triggerProps['aria-label'],
      ariaLabelledBy: triggerProps['aria-labelledby'],
    });

    // 閉じトリガーの表示ラベルを Base UI 契約どおりに再現する:
    // children が関数なら value に適用、静的なら children、bare(未指定)なら生 value にフォールバック。
    const resolver = found.selectValue;
    const displayLabel =
      typeof resolver === 'function' ? resolver(value) : resolver !== undefined ? resolver : value;

    return (
      <>
        <span data-slot="select-value-display" data-trigger-id={triggerProps.id}>
          {displayLabel as React.ReactNode}
        </span>
        <select
          id={triggerProps.id}
          className={triggerProps.className}
          aria-label={triggerProps['aria-label']}
          aria-labelledby={triggerProps['aria-labelledby']}
          value={value}
          onChange={(event) => onValueChange?.(event.target.value)}
        >
          {items.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </>
    );
  };

  return {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
  };
});

const baseLab: LabFixture = {
  id: 'lab_1',
  analyte_code: 'egfr',
  measured_at: '2026-04-10T09:30:00.000Z',
  value_numeric: 42.1,
  value_text: null,
  unit: 'mL/min/1.73m2',
  abnormal_flag: null,
  reference_low: null,
  reference_high: null,
  source_type: 'manual',
  source_visit_record_id: null,
  note: null,
  created_at: '2026-04-10T09:40:00.000Z',
};

const invalidateQueriesMock = vi.fn();
const fetchMock = vi.fn();

function setupComponent({
  patientId = 'patient_1',
  orgId = 'org_1',
  labs = [],
}: {
  patientId?: string;
  orgId?: string;
  labs?: LabFixture[];
} = {}) {
  const queryOptions: QueryOptions[] = [];
  const mutationOptions: Array<MutationOptions<unknown>> = [];

  useQueryClientMock.mockReturnValue({
    invalidateQueries: invalidateQueriesMock,
  });
  useQueryMock.mockImplementation((options: QueryOptions) => {
    queryOptions.push(options);
    return {
      data: { data: labs },
      isLoading: false,
      error: null,
    };
  });
  useMutationMock.mockImplementation((options: MutationOptions<unknown>) => {
    mutationOptions.push(options);
    return {
      isPending: false,
      mutate: mutateMock,
    };
  });

  const view = render(<PatientLabsCard patientId={patientId} orgId={orgId} />);
  return { ...view, queryOptions, mutationOptions };
}

function latestCreateMutation(options: Array<MutationOptions<unknown>>) {
  return options.at(-2) as MutationOptions<void>;
}

function latestUpdateMutation(options: Array<MutationOptions<unknown>>) {
  return options.at(-1) as MutationOptions<string>;
}

describe('PatientLabsCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedSelectItems.length = 0;
    capturedSelectTriggers.length = 0;
    fetchMock.mockResolvedValue(jsonResponse({ data: [] }));
    vi.stubGlobal('fetch', fetchMock);
  });

  it('opens a create form and submits a manual lab draft', () => {
    setupComponent();

    expect(screen.getByRole('heading', { level: 2, name: '検査値' }).tagName).toBe('H2');
    fireEvent.click(screen.getByRole('button', { name: '検査値を追加' }));
    expect(screen.getByRole('heading', { level: 3, name: 'new-lab' }).tagName).toBe('H3');
    fireEvent.change(screen.getByLabelText('測定日時'), {
      target: { value: '2026-04-10T09:30' },
    });
    fireEvent.change(screen.getByLabelText('数値'), {
      target: { value: '42.1' },
    });
    fireEvent.click(screen.getByRole('button', { name: '登録する' }));

    expect(mutateMock).toHaveBeenCalled();
  });

  it('encodes the patient id only in the GET URL while preserving raw query identity', async () => {
    const hostilePatientId = 'patient/a b?x=1#frag';
    const { queryOptions } = setupComponent({ patientId: hostilePatientId });

    const query = queryOptions.at(-1);
    expect(query?.queryKey).toEqual(['patient-labs', 'org_1', hostilePatientId]);

    await query?.queryFn();

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/patients/${encodeURIComponent(hostilePatientId)}/labs?limit=30`,
      { headers: buildOrgHeaders('org_1') },
    );
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain('/api/patients/patient/a b');
  });

  it('surfaces API error messages when lab reads fail', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: '検査値の閲覧権限がありません' }, 403));
    const { queryOptions } = setupComponent();

    await expect(queryOptions.at(-1)?.queryFn()).rejects.toThrow('検査値の閲覧権限がありません');
    expect(fetchMock).toHaveBeenCalledWith('/api/patients/patient_1/labs?limit=30', {
      headers: buildOrgHeaders('org_1'),
    });
  });

  it('encodes POST paths and keeps raw cache invalidation identity', async () => {
    const hostilePatientId = 'patient/a b?x=1#frag';
    const { mutationOptions } = setupComponent({ patientId: hostilePatientId });

    fireEvent.click(screen.getByRole('button', { name: '検査値を追加' }));
    fireEvent.change(screen.getByLabelText('項目'), { target: { value: 'hb' } });
    fireEvent.change(screen.getByLabelText('測定日時'), {
      target: { value: '2026-04-10T09:30' },
    });
    fireEvent.change(screen.getByLabelText('数値'), {
      target: { value: '12.3' },
    });

    const create = latestCreateMutation(mutationOptions);
    await create.mutationFn();

    const [, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe(
      `/api/patients/${encodeURIComponent(hostilePatientId)}/labs`,
    );
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      'x-org-id': 'org_1',
    });
    expect(JSON.parse(String(init.body))).toMatchObject({
      analyte_code: 'hb',
      value_numeric: 12.3,
    });

    await act(async () => {
      await create.onSuccess?.();
    });

    expect(invalidateQueriesMock).toHaveBeenCalledWith({
      queryKey: ['patient-labs', 'org_1', hostilePatientId],
    });
  });

  it('encodes PATCH patient and lab path segments while preserving raw cache identity', async () => {
    const hostilePatientId = 'patient/a b?x=1#frag';
    const hostileLabId = 'lab/a b?x=1#frag';
    const { mutationOptions } = setupComponent({
      patientId: hostilePatientId,
      labs: [{ ...baseLab, id: hostileLabId }],
    });

    fireEvent.click(screen.getByRole('button', { name: '補正' }));
    const update = latestUpdateMutation(mutationOptions);
    await update.mutationFn(hostileLabId);

    const [, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe(
      `/api/patients/${encodeURIComponent(hostilePatientId)}/labs/${encodeURIComponent(hostileLabId)}`,
    );
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      'x-org-id': 'org_1',
    });

    await act(async () => {
      await update.onSuccess?.();
    });

    expect(invalidateQueriesMock).toHaveBeenCalledWith({
      queryKey: ['patient-labs', 'org_1', hostilePatientId],
    });
  });

  it('routes lab reads and writes through the shared patient API path helper', async () => {
    const patientId = 'patient_1';
    const labId = 'lab_1';
    vi.mocked(buildPatientApiPath)
      .mockReturnValueOnce('/api/patients/__helper_get__/labs')
      .mockReturnValueOnce('/api/patients/__helper_post__/labs')
      .mockReturnValueOnce('/api/patients/__helper_patch__/labs/lab_1');

    const { queryOptions, mutationOptions } = setupComponent({
      patientId,
      labs: [{ ...baseLab, id: labId }],
    });

    await queryOptions.at(-1)?.queryFn();
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe('/api/patients/__helper_get__/labs?limit=30');

    fireEvent.click(screen.getByRole('button', { name: '検査値を追加' }));
    fireEvent.change(screen.getByLabelText('測定日時'), {
      target: { value: '2026-04-10T09:30' },
    });
    const create = latestCreateMutation(mutationOptions);
    await create.mutationFn();
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe('/api/patients/__helper_post__/labs');

    fireEvent.click(screen.getByRole('button', { name: '補正' }));
    const update = latestUpdateMutation(mutationOptions);
    await update.mutationFn(labId);
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe('/api/patients/__helper_patch__/labs/lab_1');

    expect(buildPatientApiPath).toHaveBeenNthCalledWith(1, patientId, '/labs');
    expect(buildPatientApiPath).toHaveBeenNthCalledWith(2, patientId, '/labs');
    expect(buildPatientApiPath).toHaveBeenNthCalledWith(3, patientId, '/labs/lab_1');
    expect(fetchMock).not.toHaveBeenCalledWith(
      `/api/patients/${patientId}/labs`,
      expect.anything(),
    );
  });

  it.each(['.', '..'])('fails before fetch for dot-segment patient ids (%s)', async (patientId) => {
    const { queryOptions } = setupComponent({ patientId });

    await expect(queryOptions.at(-1)?.queryFn()).rejects.toThrow(RangeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['.', '..'])('fails before fetch for dot-segment lab ids (%s)', async (labId) => {
    const { mutationOptions } = setupComponent({ labs: [baseLab] });

    fireEvent.click(screen.getByRole('button', { name: '補正' }));
    const update = latestUpdateMutation(mutationOptions);

    await expect(update.mutationFn(labId)).rejects.toThrow(RangeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('routes visit-record source links through an encoded /visits href', () => {
    const hostileVisitId = 'visit/a b?x=1#frag';
    setupComponent({
      labs: [
        {
          ...baseLab,
          source_type: 'visit_record',
          source_visit_record_id: hostileVisitId,
        },
      ],
    });

    const link = screen.getByRole('link', { name: '訪問記録由来' });
    expect(link.getAttribute('href')).toBe(`/visits/${encodeURIComponent(hostileVisitId)}`);
    expect(link.getAttribute('href')).not.toContain('?x=1');
    expect(link.getAttribute('href')).not.toContain('#frag');
    expect(link.getAttribute('href')).not.toContain('%25');
  });

  it('shows the analyte label, not the raw code, in the closed select trigger', () => {
    // bare <SelectValue /> は既定値 'egfr' の生コードを初期表示で漏らす。
    // 明示 children(value→label) で常に表示ラベル('eGFR')を出すことを固定する(SSR enum 漏れ封止)。
    const { container } = setupComponent();

    fireEvent.click(screen.getByRole('button', { name: '検査値を追加' }));

    const display = container.querySelector(
      '[data-slot="select-value-display"][data-trigger-id="new-lab-analyte"]',
    );
    expect(display?.textContent).toContain('eGFR');
    expect(display?.textContent).not.toContain('egfr');
  });

  it('keeps the analyte select accessible and 44px at trigger and item level', () => {
    setupComponent();

    fireEvent.click(screen.getByRole('button', { name: '検査値を追加' }));

    const analyteSelect = screen.getByLabelText('項目');
    expect(analyteSelect.getAttribute('id')).toBe('new-lab-analyte');

    const trigger = capturedSelectTriggers.find((item) => item.id === 'new-lab-analyte');
    expect(trigger?.className).toContain('min-h-[44px]');
    expect(trigger?.className).toContain('sm:min-h-[44px]');

    const egfr = capturedSelectItems.find((item) => item.value === 'egfr');
    const hb = capturedSelectItems.find((item) => item.value === 'hb');
    expect(egfr?.className).toContain('min-h-[44px]');
    expect(hb?.className).toContain('min-h-[44px]');
    expect(capturedSelectItems.every((item) => item.className?.includes('min-h-[44px]'))).toBe(
      true,
    );
  });
});
