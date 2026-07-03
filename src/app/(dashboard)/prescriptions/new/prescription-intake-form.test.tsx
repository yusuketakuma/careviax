// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const { useQueryMock, useMutationMock, useOrgIdMock, searchParamsGet } = vi.hoisted(() => ({
  useQueryMock: vi.fn(),
  useMutationMock: vi.fn(),
  useOrgIdMock: vi.fn(),
  searchParamsGet: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
  useMutation: useMutationMock,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => ({ get: searchParamsGet }),
}));

vi.mock('@/lib/hooks/use-org-id', () => ({ useOrgId: useOrgIdMock }));

// Debounce is collapsed to the identity so a typed search term is immediately
// reflected in debouncedPatientSearch without fake timers.
vi.mock('@/lib/hooks/use-debounced-value', () => ({
  useDebouncedValue: (value: unknown) => value,
}));

vi.mock('@/lib/hooks/use-prescription-draft', () => ({
  usePrescriptionDraft: () => ({
    loadDraft: vi.fn().mockResolvedValue(null),
    saveDraft: vi.fn().mockResolvedValue(undefined),
    clearDraft: vi.fn(),
  }),
}));

vi.mock('@/lib/hooks/use-unsaved-changes-guard', () => ({
  useUnsavedChangesGuard: () => vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

// Heavy children that run their own data fetching are stubbed: this suite only proves
// the secondary-lookup fetch-error affordances on the intake form itself.
vi.mock('@/components/patient-mcs/patient-mcs-summary-section', () => ({
  PatientMcsSummarySection: () => <div data-testid="mcs-summary" />,
}));
vi.mock('@/components/features/prescriptions/jahis-supplemental-records-card', () => ({
  JahisSupplementalRecordsCard: () => <div data-testid="jahis-records" />,
}));
vi.mock('@/components/features/pharmacy/drug-suggest', () => ({
  DrugSuggest: ({
    value,
    ariaLabel,
    onTextChange,
    onSelect,
  }: {
    value: string;
    ariaLabel?: string;
    onTextChange: (text: string) => void;
    onSelect: (drug: {
      drug_master_id: string;
      drug_name: string;
      drug_code: string;
      dosage_form: string | null;
      unit: string | null;
      is_generic: boolean;
      is_narcotic: boolean;
      is_psychotropic: boolean;
      max_administration_days: number | null;
      drug_price: number | null;
    }) => void;
  }) => (
    <div data-testid="drug-suggest">
      <input
        aria-label={ariaLabel ?? '薬剤名'}
        value={value}
        onChange={(event) => onTextChange(event.currentTarget.value)}
      />
      <button
        type="button"
        onClick={() =>
          onSelect({
            drug_master_id: 'drug_master_selected',
            drug_name: 'アムロジピン錠5mg',
            drug_code: '2171013F1024',
            dosage_form: '錠',
            unit: '錠',
            is_generic: false,
            is_narcotic: false,
            is_psychotropic: false,
            max_administration_days: null,
            drug_price: 12.3,
          })
        }
      >
        薬剤候補を選択
      </button>
    </div>
  ),
}));
vi.mock('./prescription-period-review', () => ({
  PrescriptionPeriodReview: () => <div data-testid="period-review" />,
}));

import { PrescriptionIntakeForm } from './prescription-intake-form';

setupDomTestEnv();

type QueryStub = { data?: unknown; isError?: boolean };

function setupQueries(stubs: Record<string, QueryStub>) {
  const refetchSpies: Record<string, ReturnType<typeof vi.fn>> = {};
  useOrgIdMock.mockReturnValue('org_1');
  useMutationMock.mockReturnValue({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  });
  useQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
    const key = String(queryKey[0]);
    const refetch = (refetchSpies[key] ??= vi.fn());
    const stub = stubs[key];
    if (stub) {
      return { data: stub.data, isError: Boolean(stub.isError), isLoading: false, refetch };
    }
    return { data: undefined, isError: false, isLoading: false, refetch };
  });
  return { refetchSpies };
}

beforeEach(() => {
  vi.clearAllMocks();
  searchParamsGet.mockReturnValue('');
});

describe('PrescriptionIntakeForm secondary-lookup fetch-error handling', () => {
  it('does not show any lookup error affordance when every secondary query succeeds', () => {
    searchParamsGet.mockImplementation((key: string) =>
      key === 'patient_id' ? 'patient_1' : key === 'case_id' ? 'case_1' : '',
    );
    setupQueries({
      'patient-cases': { data: { data: [] } },
      'patient-prescriptions': { data: { data: [] } },
    });
    render(<PrescriptionIntakeForm />);
    expect(screen.queryByText(/ケースを取得できませんでした/)).toBeNull();
    expect(screen.queryByText(/前回処方を取得できませんでした/)).toBeNull();
    expect(screen.queryByText(/患者検索に失敗しました/)).toBeNull();
  });

  it('surfaces a retryable error instead of an empty case selector when the case lookup fails', () => {
    searchParamsGet.mockImplementation((key: string) => (key === 'patient_id' ? 'patient_1' : ''));
    const { refetchSpies } = setupQueries({
      'patient-cases': { data: undefined, isError: true },
    });
    render(<PrescriptionIntakeForm />);

    expect(screen.getByText(/ケースを取得できませんでした/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }));
    expect(refetchSpies['patient-cases']).toHaveBeenCalled();
  });

  it('surfaces a retryable error when the patient search fetch fails so it is not read as no-match', () => {
    const { refetchSpies } = setupQueries({
      'patients-search': { data: undefined, isError: true },
    });
    render(<PrescriptionIntakeForm />);

    // No error before a search term is entered (query is disabled / not a failure yet).
    expect(screen.queryByText(/患者検索に失敗しました/)).toBeNull();

    fireEvent.change(screen.getByLabelText('患者検索'), { target: { value: 'やまだ' } });

    expect(screen.getByText(/患者検索に失敗しました/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }));
    expect(refetchSpies['patients-search']).toHaveBeenCalled();
  });

  it('distinguishes a failed previous-prescription lookup from having no previous prescription', () => {
    searchParamsGet.mockImplementation((key: string) =>
      key === 'patient_id' ? 'patient_1' : key === 'case_id' ? 'case_1' : '',
    );
    const { refetchSpies } = setupQueries({
      'patient-cases': { data: { data: [] } },
      'patient-prescriptions': { data: undefined, isError: true },
    });
    render(<PrescriptionIntakeForm />);

    expect(screen.getByText(/前回処方を取得できませんでした/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }));
    expect(refetchSpies['patient-prescriptions']).toHaveBeenCalled();
  });

  it('keeps the selected drug master id in the prescription submit payload', async () => {
    searchParamsGet.mockImplementation((key: string) =>
      key === 'patient_id' ? 'patient_1' : key === 'case_id' ? 'case_1' : '',
    );
    setupQueries({
      'patient-cases': {
        data: { data: [{ id: 'case_1', display_id: 'cc0000000123', status: 'active' }] },
      },
      'patient-prescriptions': { data: { data: [] } },
    });
    useMutationMock.mockImplementation(
      (config: { mutationFn: () => Promise<unknown> | unknown }) => ({
        mutate: vi.fn(),
        mutateAsync: () => config.mutationFn(),
        isPending: false,
      }),
    );
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { id: 'intake_1' } }),
    } as Response);
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<PrescriptionIntakeForm />);

      const caseOption = screen.getByRole('option', {
        name: 'cc0000000123 — active',
      }) as HTMLOptionElement;
      expect(caseOption.value).toBe('case_1');
      expect(screen.queryByRole('option', { name: 'case_1 — active' })).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: '薬剤候補を選択' }));
      fireEvent.change(screen.getByLabelText('明細行 1 の用量'), { target: { value: '1錠' } });
      fireEvent.change(screen.getByLabelText('明細行 1 の用法'), {
        target: { value: '1日1回朝食後' },
      });
      fireEvent.click(screen.getByRole('button', { name: '処方受付を登録' }));

      await waitFor(() =>
        expect(fetchMock).toHaveBeenCalledWith('/api/prescription-intakes', expect.any(Object)),
      );
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(init.headers).toEqual({ 'Content-Type': 'application/json', 'x-org-id': 'org_1' });
      const body = JSON.parse(String(init.body));
      expect(body.case_id).toBe('case_1');
      expect(JSON.stringify(body)).not.toContain('cc0000000123');
      expect(body.lines[0]).toEqual(
        expect.objectContaining({
          drug_name: 'アムロジピン錠5mg',
          drug_master_id: 'drug_master_selected',
          drug_code: '2171013F1024',
          dose: '1錠',
          frequency: '1日1回朝食後',
        }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('uses CareCase display_id in facility batch labels while storing the cuid case id', async () => {
    searchParamsGet.mockImplementation((key: string) =>
      key === 'patient_id' ? 'patient_1' : key === 'case_id' ? 'case_1' : '',
    );
    setupQueries({
      'selected-patient': {
        data: {
          id: 'patient_1',
          name: '田中 一郎',
          name_kana: 'タナカ イチロウ',
          birth_date: '1980-01-01',
        },
      },
      'patient-cases': {
        data: {
          data: [
            {
              id: 'case_1',
              display_id: 'cc0000000456',
              status: 'active',
              patient: { residences: [{ address: '施設A' }] },
            },
          ],
        },
      },
      'patient-prescriptions': { data: { data: [] } },
    });

    render(<PrescriptionIntakeForm />);

    await waitFor(() =>
      expect(screen.getByDisplayValue('田中 一郎 (タナカ イチロウ)')).toBeTruthy(),
    );
    fireEvent.change(screen.getByLabelText('ソースタイプ'), {
      target: { value: 'facility_batch' },
    });
    fireEvent.click(screen.getByRole('button', { name: '薬剤候補を選択' }));
    fireEvent.change(screen.getByLabelText('明細行 1 の用量'), { target: { value: '1錠' } });
    fireEvent.change(screen.getByLabelText('明細行 1 の用法'), {
      target: { value: '1日1回朝食後' },
    });

    expect(screen.getByText(/ケース cc0000000456 \/ 明細 1 行/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '一括リストへ追加' }));

    expect(screen.getByText(/ケース cc0000000456 \/ active \/ 1 行/)).toBeTruthy();
    expect(screen.queryByText(/ケース case_1/)).toBeNull();
  });
});
