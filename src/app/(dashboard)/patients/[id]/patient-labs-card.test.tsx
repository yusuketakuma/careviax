// @vitest-environment jsdom

import * as React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
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

  const SelectItem = ({ children }: ItemProps) => <>{children}</>;
  const SelectTrigger = ({ children }: TriggerProps) => <>{children}</>;
  const SelectValue = () => null;
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
  ): TriggerProps | null {
    let triggerProps: TriggerProps | null = null;
    React.Children.forEach(node, (child) => {
      if (!React.isValidElement(child)) return;
      if (child.type === SelectTrigger) {
        triggerProps = child.props as TriggerProps;
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
      const nested = collect((child.props as { children?: React.ReactNode }).children, items);
      if (nested) triggerProps = nested;
    });
    return triggerProps;
  }

  const Select = ({ value, onValueChange, children }: SelectProps) => {
    const items: Array<{ value: string; label: string; className?: string }> = [];
    const triggerProps = collect(children, items) ?? {};
    capturedSelectTriggers.push({
      id: triggerProps.id,
      className: triggerProps.className,
      ariaLabel: triggerProps['aria-label'],
      ariaLabelledBy: triggerProps['aria-labelledby'],
    });

    return (
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
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
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
      { headers: { 'x-org-id': 'org_1' } },
    );
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain('/api/patients/patient/a b');
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
