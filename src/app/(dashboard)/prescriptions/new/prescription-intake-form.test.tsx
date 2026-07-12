// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { jsonResponse, stubJsonFetch } from '@/test/fetch-test-utils';

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
    // This suite does not exercise draft hydration. Keep the promise pending so the
    // mount effect cannot schedule an unrelated state update outside each assertion's act scope.
    loadDraft: vi.fn(() => new Promise<null>(() => undefined)),
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

type QueryStub = {
  data?: unknown;
  isError?: boolean;
  isLoading?: boolean;
  isRefetchError?: boolean;
};
type QueryConfig = { queryKey: unknown[]; queryFn?: () => Promise<unknown> };

const queryConfigs: QueryConfig[] = [];

function setupQueries(stubs: Record<string, QueryStub>) {
  const refetchSpies: Record<string, ReturnType<typeof vi.fn>> = {};
  const mutateAsync = vi.fn();
  useOrgIdMock.mockReturnValue('org_1');
  useMutationMock.mockReturnValue({
    mutate: vi.fn(),
    mutateAsync,
    isPending: false,
  });
  queryConfigs.length = 0;
  useQueryMock.mockImplementation((config: QueryConfig) => {
    const { queryKey } = config;
    queryConfigs.push(config);
    const key = String(queryKey[0]);
    const refetch = (refetchSpies[key] ??= vi.fn());
    const stub = stubs[key];
    if (stub) {
      return {
        data: stub.data,
        isError: Boolean(stub.isError),
        isLoading: Boolean(stub.isLoading),
        isRefetchError: Boolean(stub.isRefetchError),
        refetch,
      };
    }
    return {
      data: undefined,
      isError: false,
      isLoading: false,
      isRefetchError: false,
      refetch,
    };
  });
  return { refetchSpies, mutateAsync };
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

  it('shows independent loading states for deep-linked patient, cases, and previous prescriptions', () => {
    searchParamsGet.mockImplementation((key: string) =>
      key === 'patient_id' ? 'patient_1' : key === 'case_id' ? 'case_1' : '',
    );
    setupQueries({
      'selected-patient': { data: undefined, isLoading: true },
      'patient-cases': { data: undefined, isLoading: true },
      'patient-prescriptions': { data: undefined, isLoading: true },
    });

    render(<PrescriptionIntakeForm />);

    expect(screen.getByText('患者情報を読み込み中')).toBeTruthy();
    expect(screen.getByText('ケースを読み込み中')).toBeTruthy();
    expect(screen.getByText('前回処方を確認中')).toBeTruthy();
    expect(screen.queryByTestId('patient-header')).toBeNull();
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

  it('blocks registration and exposes retry when a deep-linked patient cannot be hydrated', () => {
    searchParamsGet.mockImplementation((key: string) =>
      key === 'patient_id' ? 'patient_1' : key === 'case_id' ? 'case_1' : '',
    );
    const { refetchSpies, mutateAsync } = setupQueries({
      'selected-patient': { data: undefined, isError: true },
      'patient-cases': {
        data: { data: [{ id: 'case_1', display_id: 'cc0000000123', status: 'active' }] },
      },
      'patient-prescriptions': { data: { data: [] } },
    });

    render(<PrescriptionIntakeForm />);

    expect(screen.getByText('患者情報を取得できませんでした')).toBeTruthy();
    expect(screen.getByText(/患者情報を再読み込みしてから登録してください/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }));
    expect(refetchSpies['selected-patient']).toHaveBeenCalled();
    expect((screen.getByTestId('prescription-submit-primary') as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.submit(screen.getByLabelText('処方受付フォーム'));
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(
      screen.getAllByText(/患者情報を再読み込みしてから登録してください/).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it('shows QR import loading and blocks registration until the draft is applied', () => {
    searchParamsGet.mockImplementation((key: string) => (key === 'qr_draft_id' ? 'draft_1' : ''));
    setupQueries({
      'qr-draft-import': { data: undefined, isLoading: true },
    });

    render(<PrescriptionIntakeForm />);

    expect(screen.getByText('QR下書きを読み込み中')).toBeTruthy();
    expect(screen.getByText('読込中')).toBeTruthy();
    expect(screen.getByText(/QR下書きの読み込み完了をお待ちください/)).toBeTruthy();
    expect((screen.getByTestId('prescription-submit-primary') as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('replaces the stuck QR loading label with a retryable failure and manual-entry path', () => {
    searchParamsGet.mockImplementation((key: string) => (key === 'qr_draft_id' ? 'draft_1' : ''));
    const { refetchSpies } = setupQueries({
      'qr-draft-import': { data: undefined, isError: true },
    });

    render(<PrescriptionIntakeForm />);

    expect(screen.getByText('取込失敗')).toBeTruthy();
    expect(screen.getByText('QR下書きを取り込めませんでした')).toBeTruthy();
    expect(screen.queryByText('読込中')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }));
    expect(refetchSpies['qr-draft-import']).toHaveBeenCalled();
    expect(screen.getByRole('link', { name: '手入力に切り替える' }).getAttribute('href')).toBe(
      '/prescriptions/new',
    );
    expect(screen.getByText(/QR下書きを再読み込みするか、手入力に切り替えてください/)).toBeTruthy();
  });

  it('distinguishes patient search loading and a confirmed no-match result', () => {
    setupQueries({
      'patients-search': { data: undefined, isLoading: true },
    });
    const { rerender } = render(<PrescriptionIntakeForm />);

    fireEvent.change(screen.getByLabelText('患者検索'), { target: { value: 'やまだ' } });
    expect(screen.getByText('患者を検索中')).toBeTruthy();

    setupQueries({
      'patients-search': { data: { data: [] } },
    });
    rerender(<PrescriptionIntakeForm />);
    expect(
      screen.getByText('一致する患者はいません。氏名またはフリガナを確認してください。'),
    ).toBeTruthy();
  });

  it('shows an optional institution-master failure while keeping manual entry available', () => {
    const { refetchSpies } = setupQueries({
      'prescriber-institutions': { data: undefined, isError: true },
    });

    render(<PrescriptionIntakeForm />);

    expect(screen.getByText('医療機関マスターを取得できませんでした')).toBeTruthy();
    expect((screen.getByLabelText('医療機関マスター') as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText('処方元機関') as HTMLInputElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }));
    expect(refetchSpies['prescriber-institutions']).toHaveBeenCalled();
  });

  it('preserves cached institution options and marks them stale after a refetch failure', () => {
    setupQueries({
      'prescriber-institutions': {
        data: {
          data: [
            {
              id: 'institution_1',
              name: '在宅クリニック',
              institution_code: '1234567',
              phone: null,
              fax: null,
            },
          ],
        },
        isError: true,
        isRefetchError: true,
      },
    });

    render(<PrescriptionIntakeForm />);

    expect(screen.getByRole('option', { name: '在宅クリニック (1234567)' })).toBeTruthy();
    expect(screen.getByText('前回取得した医療機関候補を表示中')).toBeTruthy();
    expect((screen.getByLabelText('医療機関マスター') as HTMLSelectElement).disabled).toBe(false);
  });

  it('keeps the API message when generic candidate lookup fetch fails', async () => {
    setupQueries({
      'patient-cases': { data: { data: [] } },
      'patient-prescriptions': { data: { data: [] } },
    });
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ message: '後発候補を表示できません' }, 403),
    );
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(<PrescriptionIntakeForm />);

      fireEvent.change(screen.getByLabelText('明細行 1 の薬剤名'), {
        target: { value: 'ロキソ' },
      });
      fireEvent.click(screen.getByLabelText('一般名処方'));

      await waitFor(() =>
        expect(
          queryConfigs.some(
            (config) =>
              config.queryKey[0] === 'generic-candidates' && config.queryKey[2] === 'ロキソ',
          ),
        ).toBe(true),
      );
      const genericCandidatesConfig = queryConfigs
        .filter((config) => config.queryKey[0] === 'generic-candidates')
        .at(-1);
      expect(genericCandidatesConfig?.queryKey).toEqual(['generic-candidates', 'org_1', 'ロキソ']);
      await expect(genericCandidatesConfig?.queryFn?.()).rejects.toThrow(
        '後発候補を表示できません',
      );
      const [calledUrl, calledInit] = fetchMock.mock.calls[0] ?? [];
      const url = new URL(String(calledUrl), 'http://localhost');
      expect(url.pathname).toBe('/api/drug-masters');
      expect(url.searchParams.get('q')).toBe('ロキソ');
      expect(url.searchParams.get('generic')).toBe('true');
      expect(url.searchParams.get('limit')).toBe('5');
      expect(url.searchParams.get('includeTotal')).toBe('false');
      expect(calledInit).toEqual(
        expect.objectContaining({
          headers: expect.objectContaining({ 'x-org-id': 'org_1' }),
        }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('validates and minimizes generic candidate query results before caching them', async () => {
    setupQueries({
      'patient-cases': { data: { data: [] } },
      'patient-prescriptions': { data: { data: [] } },
    });
    const candidate = {
      id: 'drug_generic_1',
      yj_code: '2171014F1020',
      drug_name: 'アムロジピン錠5mg「後発」',
      generic_name: 'アムロジピンベシル酸塩',
      dosage_form: '錠剤',
      drug_price: 9.8,
      unit: '錠',
      is_generic: true,
      generic_price_comparison: { lowest_price: '8.7', source_row: 'provider-only' },
      manufacturer: 'provider-only',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () =>
        jsonResponse({ data: [candidate], meta: { has_more: false, next_cursor: null } }),
      ),
    );

    try {
      render(<PrescriptionIntakeForm />);
      fireEvent.change(screen.getByLabelText('明細行 1 の薬剤名'), {
        target: { value: 'アムロ' },
      });
      fireEvent.click(screen.getByLabelText('一般名処方'));

      await waitFor(() =>
        expect(
          queryConfigs.some(
            (config) =>
              config.queryKey[0] === 'generic-candidates' && config.queryKey[2] === 'アムロ',
          ),
        ).toBe(true),
      );
      const query = queryConfigs
        .filter((config) => config.queryKey[0] === 'generic-candidates')
        .at(-1);

      await expect(query?.queryFn?.()).resolves.toEqual({
        data: [
          {
            id: candidate.id,
            yj_code: candidate.yj_code,
            drug_name: candidate.drug_name,
            generic_name: candidate.generic_name,
            dosage_form: candidate.dosage_form,
            drug_price: candidate.drug_price,
            unit: candidate.unit,
            is_generic: true,
            generic_price_comparison: { lowest_price: '8.7' },
          },
        ],
        meta: { has_more: false, next_cursor: null },
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('preserves cached generic candidates and warns when their refetch fails', () => {
    setupQueries({
      'generic-candidates': {
        data: {
          data: [
            {
              id: 'drug_generic_1',
              yj_code: '2171014F1020',
              drug_name: 'アムロジピン錠5mg「後発」',
              generic_name: 'アムロジピンベシル酸塩',
              dosage_form: '錠',
              drug_price: 9.8,
              unit: '錠',
              is_generic: true,
              generic_price_comparison: {
                lowest_price: '8.7',
              },
            },
          ],
        },
        isError: true,
        isRefetchError: true,
      },
    });

    render(<PrescriptionIntakeForm />);
    fireEvent.change(screen.getByLabelText('明細行 1 の薬剤名'), {
      target: { value: 'アムロ' },
    });
    fireEvent.click(screen.getByLabelText('一般名処方'));

    expect(screen.getByText('前回取得した後発候補を表示中')).toBeTruthy();
    expect(screen.getByText('アムロジピン錠5mg「後発」')).toBeTruthy();
    expect(screen.getByText(/同規格最安 ¥8.7/)).toBeTruthy();
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
    const fetchMock = stubJsonFetch({ data: { id: 'intake_1' } });

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
    expect(screen.getByTestId('patient-header')).toBeTruthy();
    expect(screen.getByText('田中 一郎 様')).toBeTruthy();
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
