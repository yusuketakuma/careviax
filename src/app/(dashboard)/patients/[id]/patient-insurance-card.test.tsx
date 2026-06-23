// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { PatientInsuranceCard } from './patient-insurance-card';

setupDomTestEnv();

const useQueryMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() => vi.fn());
const useQueryClientMock = vi.hoisted(() => vi.fn());
const mutateMock = vi.hoisted(() => vi.fn());

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

describe('PatientInsuranceCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens a create form and submits a new insurance draft', () => {
    useQueryClientMock.mockReturnValue({
      invalidateQueries: vi.fn(),
    });
    useQueryMock.mockReturnValue({
      data: {
        data: {
          current: [],
          upcoming: [],
          history: [],
          all: [],
        },
      },
      isLoading: false,
      error: null,
    });
    useMutationMock.mockReturnValue({
      isPending: false,
      mutate: mutateMock,
    });

    render(<PatientInsuranceCard patientId="patient_1" orgId="org_1" />);

    expect(screen.getByRole('heading', { level: 2, name: '保険詳細' }).tagName).toBe('H2');
    fireEvent.click(screen.getByRole('button', { name: '保険追加' }));
    expect(screen.getByRole('heading', { level: 3, name: 'new-insurance' }).tagName).toBe('H3');
    fireEvent.change(screen.getByLabelText('番号'), {
      target: { value: '1234567' },
    });
    fireEvent.change(screen.getByLabelText('自己負担割合'), {
      target: { value: '30' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(mutateMock).toHaveBeenCalledWith({
      form: expect.objectContaining({
        insurance_type: 'medical',
        application_status: 'confirmed',
        number: '1234567',
        copay_ratio: '30',
        is_active: true,
      }),
    });
  });

  it('surfaces and submits pending public subsidy and care change status fields', () => {
    useQueryClientMock.mockReturnValue({
      invalidateQueries: vi.fn(),
    });
    useQueryMock.mockReturnValue({
      data: {
        data: {
          current: [
            {
              id: 'ins_public_54',
              insurance_type: 'public_subsidy',
              application_status: 'applying',
              application_submitted_at: '2026-06-01T00:00:00.000Z',
              decision_at: null,
              public_program_code: '54',
              previous_care_level: null,
              provisional_care_level: null,
              confirmed_care_level: null,
              insurer_number: null,
              symbol: null,
              number: '1234567',
              branch_number: null,
              copay_ratio: null,
              valid_from: '2026-06-01T00:00:00.000Z',
              valid_until: null,
              is_active: true,
              notes: '指定難病申請中',
            },
            {
              id: 'ins_care_change',
              insurance_type: 'care',
              application_status: 'change_pending',
              application_submitted_at: '2026-06-01T00:00:00.000Z',
              decision_at: null,
              public_program_code: null,
              previous_care_level: 'care_1',
              provisional_care_level: 'care_2',
              confirmed_care_level: null,
              insurer_number: '137000',
              symbol: '記号A',
              number: '7654321',
              branch_number: '枝番01',
              copay_ratio: null,
              valid_from: '2026-06-01T00:00:00.000Z',
              valid_until: null,
              is_active: true,
              notes: '区分変更中',
            },
          ],
          upcoming: [],
          history: [
            {
              id: 'ins_inactive_medical',
              insurance_type: 'medical',
              application_status: 'confirmed',
              application_submitted_at: null,
              decision_at: null,
              public_program_code: null,
              previous_care_level: null,
              provisional_care_level: null,
              confirmed_care_level: null,
              insurer_number: '139999',
              symbol: '記号B',
              number: '9999999',
              branch_number: '枝番09',
              copay_ratio: 30,
              valid_from: '2025-04-01T00:00:00.000Z',
              valid_until: '2026-03-31T00:00:00.000Z',
              is_active: false,
              notes: '古い保険証を回収済み',
            },
          ],
          all: [],
        },
      },
      isLoading: false,
      error: null,
    });
    useMutationMock.mockReturnValue({
      isPending: false,
      mutate: mutateMock,
    });

    render(<PatientInsuranceCard patientId="patient_1" orgId="org_1" />);

    const actionButtons = [
      screen.getByRole('button', { name: '現在有効 1件目の公費を編集' }),
      screen.getByRole('button', { name: '現在有効 1件目の公費を失効' }),
      screen.getByRole('button', { name: '現在有効 2件目の介護保険を編集' }),
      screen.getByRole('button', { name: '現在有効 2件目の介護保険を失効' }),
      screen.getByRole('button', { name: '履歴 1件目の医療保険を編集' }),
      screen.getByRole('button', { name: '履歴 1件目の医療保険を削除' }),
    ];
    for (const button of actionButtons) {
      expect(button.getAttribute('aria-label')).not.toMatch(
        /patient|山田|54|137000|139999|1234567|7654321|9999999|記号|枝番|2026-06-01|2026-03-31|指定難病|区分変更|回収済み/,
      );
    }
    expect(screen.getByText('申請中')).toBeTruthy();
    expect(screen.getAllByText('区分変更中').length).toBeGreaterThan(0);
    expect(screen.getByText('54')).toBeTruthy();
    expect(screen.getByText(/変更前 要介護1 \/ 暫定 要介護2 \/ 確定/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '保険追加' }));
    fireEvent.change(screen.getByLabelText('保険種別'), {
      target: { value: 'public_subsidy' },
    });
    fireEvent.change(screen.getByLabelText('資格状態'), {
      target: { value: 'applying' },
    });
    fireEvent.change(screen.getByLabelText('公費制度コード'), {
      target: { value: '21' },
    });
    fireEvent.change(screen.getByLabelText('申請日'), {
      target: { value: '2026-06-08' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(mutateMock).toHaveBeenCalledWith({
      form: expect.objectContaining({
        insurance_type: 'public_subsidy',
        application_status: 'applying',
        public_program_code: '21',
        application_submitted_at: '2026-06-08',
      }),
    });
  });

  const sampleForm = {
    insurance_type: 'medical' as const,
    application_status: 'confirmed' as const,
    application_submitted_at: '',
    decision_at: '',
    public_program_code: '',
    previous_care_level: '',
    provisional_care_level: '',
    confirmed_care_level: '',
    insurer_number: '',
    symbol: '',
    number: '1234567',
    branch_number: '',
    copay_ratio: '30',
    valid_from: '',
    valid_until: '',
    is_active: true,
    notes: '',
  };

  type CapturedConfig = {
    queryKey?: unknown[];
    queryFn?: () => Promise<unknown>;
    mutationFn?: (args: unknown) => Promise<unknown>;
  };

  function captureConfigs() {
    const queryConfigs: CapturedConfig[] = [];
    const mutationConfigs: CapturedConfig[] = [];
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useQueryMock.mockImplementation((config: CapturedConfig) => {
      queryConfigs.push(config);
      return { data: undefined, isLoading: true, error: null };
    });
    useMutationMock.mockImplementation((config: CapturedConfig) => {
      mutationConfigs.push(config);
      return { isPending: false, mutate: mutateMock };
    });
    return { queryConfigs, mutationConfigs };
  }

  function okFetch() {
    return vi
      .fn<typeof fetch>()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({}) } as unknown as Response);
  }

  it('fetches the insurance list from an encoded patient path with org headers', async () => {
    const hostileId = 'pt/1?x=y#z';
    const { queryConfigs } = captureConfigs();
    const fetchMock = okFetch();
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<PatientInsuranceCard patientId={hostileId} orgId="org_1" />);

      expect(queryConfigs[0]?.queryKey).toEqual(['patient-insurance', 'org_1', hostileId]);
      await queryConfigs[0]?.queryFn?.();

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`/api/patients/${encodeURIComponent(hostileId)}/insurance`);
      expect(url).not.toContain('?x=y');
      expect(url).not.toContain('#z');
      expect(url).not.toContain('%25');
      expect(init.headers).toEqual(buildOrgHeaders('org_1'));
    } finally {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    }
  });

  it('encodes both patient and insurance id segments for an update (PUT) without leaking ids into the body', async () => {
    const hostilePatientId = 'pt/1?x=y#z';
    const hostileInsuranceId = 'ins/9?a=b#c';
    const { mutationConfigs } = captureConfigs();
    const fetchMock = okFetch();
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<PatientInsuranceCard patientId={hostilePatientId} orgId="org_1" />);

      await mutationConfigs[0]?.mutationFn?.({
        insuranceId: hostileInsuranceId,
        form: sampleForm,
      });

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(
        `/api/patients/${encodeURIComponent(hostilePatientId)}/insurance/${encodeURIComponent(hostileInsuranceId)}`,
      );
      expect(url).not.toContain('?x=y');
      expect(url).not.toContain('#c');
      expect(url).not.toContain('%25');
      expect(init.method).toBe('PUT');
      expect(init.headers).toEqual(buildOrgJsonHeaders('org_1'));
      const body = init.body as string;
      // ids live only in the URL path - never in the payload.
      expect(body).not.toContain(hostilePatientId);
      expect(body).not.toContain(hostileInsuranceId);
      expect(JSON.parse(body)).toMatchObject({ insurance_type: 'medical', number: '1234567' });
    } finally {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    }
  });

  it('posts a create (no insuranceId) to the encoded collection path with JSON org headers', async () => {
    const hostilePatientId = 'pt/1?x=y#z';
    const { mutationConfigs } = captureConfigs();
    const fetchMock = okFetch();
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<PatientInsuranceCard patientId={hostilePatientId} orgId="org_1" />);

      await mutationConfigs[0]?.mutationFn?.({ form: sampleForm });

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`/api/patients/${encodeURIComponent(hostilePatientId)}/insurance`);
      expect(init.method).toBe('POST');
      expect(init.headers).toEqual(buildOrgJsonHeaders('org_1'));
    } finally {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    }
  });

  it('deletes via an encoded nested path with org headers', async () => {
    const hostilePatientId = 'pt/1?x=y#z';
    const hostileInsuranceId = 'ins/9?a=b#c';
    const { mutationConfigs } = captureConfigs();
    const fetchMock = okFetch();
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<PatientInsuranceCard patientId={hostilePatientId} orgId="org_1" />);

      await mutationConfigs[1]?.mutationFn?.(hostileInsuranceId);

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(
        `/api/patients/${encodeURIComponent(hostilePatientId)}/insurance/${encodeURIComponent(hostileInsuranceId)}`,
      );
      expect(url).not.toContain('%25');
      expect(init.method).toBe('DELETE');
      expect(init.headers).toEqual(buildOrgHeaders('org_1'));
    } finally {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    }
  });

  it.each(['.', '..'])(
    'fails closed without fetching for exact dot-segment patientId %p across list/save/delete',
    async (dotId) => {
      const { queryConfigs, mutationConfigs } = captureConfigs();
      const fetchMock = vi.fn<typeof fetch>();
      vi.stubGlobal('fetch', fetchMock);

      try {
        render(<PatientInsuranceCard patientId={dotId} orgId="org_1" />);

        await expect(queryConfigs[0]?.queryFn?.()).rejects.toThrow(RangeError);
        await expect(
          mutationConfigs[0]?.mutationFn?.({ insuranceId: 'ins_1', form: sampleForm }),
        ).rejects.toThrow(RangeError);
        await expect(mutationConfigs[1]?.mutationFn?.('ins_1')).rejects.toThrow(RangeError);
        expect(fetchMock).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
      }
    },
  );

  it.each(['.', '..'])(
    'fails closed without fetching for exact dot-segment insuranceId %p on update/delete',
    async (dotId) => {
      const { mutationConfigs } = captureConfigs();
      const fetchMock = vi.fn<typeof fetch>();
      vi.stubGlobal('fetch', fetchMock);

      try {
        render(<PatientInsuranceCard patientId="patient_1" orgId="org_1" />);

        await expect(
          mutationConfigs[0]?.mutationFn?.({ insuranceId: dotId, form: sampleForm }),
        ).rejects.toThrow(RangeError);
        await expect(mutationConfigs[1]?.mutationFn?.(dotId)).rejects.toThrow(RangeError);
        expect(fetchMock).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
      }
    },
  );
});
