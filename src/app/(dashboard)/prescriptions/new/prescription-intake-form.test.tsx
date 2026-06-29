// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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
  DrugSuggest: () => <div data-testid="drug-suggest" />,
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
});
