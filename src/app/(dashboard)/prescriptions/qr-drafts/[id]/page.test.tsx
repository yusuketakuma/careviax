// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const {
  pushMock,
  refetchCasesMock,
  refetchDraftMock,
  useMutationMock,
  useOrgIdMock,
  useQueryMock,
} = vi.hoisted(() => ({
  pushMock: vi.fn(),
  refetchCasesMock: vi.fn(),
  refetchDraftMock: vi.fn(),
  useMutationMock: vi.fn(),
  useOrgIdMock: vi.fn(),
  useQueryMock: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
  useMutation: useMutationMock,
  useQuery: useQueryMock,
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'draft_1' }),
  useRouter: () => ({ push: pushMock }),
}));

vi.mock('@/lib/hooks/use-org-id', () => ({ useOrgId: useOrgIdMock }));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('@/components/features/prescriptions/jahis-supplemental-records-card', () => ({
  JahisSupplementalRecordsCard: () => <div data-testid="supplemental-records" />,
}));

vi.mock('@/components/ui/select', async () => {
  const React = await import('react');

  function isElement(node: ReactNode): node is ReactElement<Record<string, unknown>> {
    return React.isValidElement(node);
  }

  function SelectTrigger() {
    return null;
  }

  function SelectValue() {
    return null;
  }

  function SelectContent({ children }: { children?: ReactNode }) {
    return <>{children}</>;
  }

  function SelectItem({ value, children }: { value: string; children?: ReactNode }) {
    return <option value={value}>{children}</option>;
  }

  function extractPlaceholder(children: ReactNode) {
    const valueElement = React.Children.toArray(children)
      .filter(isElement)
      .find((child) => child.type === SelectValue);
    const placeholder = valueElement?.props.placeholder;
    return typeof placeholder === 'string' ? placeholder : '';
  }

  function Select({
    value,
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange?: (value: string) => void;
    children?: ReactNode;
  }) {
    const childElements = React.Children.toArray(children).filter(isElement);
    const trigger = childElements.find((child) => child.type === SelectTrigger);
    const content = childElements.find((child) => child.type === SelectContent);
    const ariaLabel =
      typeof trigger?.props['aria-label'] === 'string' ? trigger.props['aria-label'] : undefined;

    return (
      <select
        aria-label={ariaLabel}
        value={value ?? ''}
        onChange={(event) => onValueChange?.(event.currentTarget.value)}
      >
        <option value="">{extractPlaceholder(trigger?.props.children as ReactNode)}</option>
        {content?.props.children as ReactNode}
      </select>
    );
  }

  return {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
  };
});

import QrDraftReviewPage from './page';

setupDomTestEnv();

type QueryConfig = { queryKey: unknown[]; queryFn?: () => Promise<unknown> };
type MutationConfig = { mutationFn?: () => Promise<unknown> };

const baseDraft = {
  id: 'draft_1',
  org_id: 'org_1',
  site_id: 'site_1',
  patient_id: 'patient_1',
  scanned_by: 'user_1',
  session_id: 'session_1234567890',
  status: 'pending',
  parsed_data: {
    patientName: '患者 太郎',
    patientNameKana: 'カンジャ タロウ',
    patientBirthdate: '19800101',
    patientGender: 'M',
    prescriptionDate: '2026-06-29',
    prescriberName: '田中 医師',
    prescriberInstitution: 'テストクリニック',
    lines: [
      {
        drugName: 'アムロジピン錠5mg',
        drugCode: '2171013F1028',
        sourceDrugCode: null as string | null,
        sourceDrugCodeType: null as string | null,
        drugCodeResolutionStatus: 'resolved' as 'resolved' | 'review_required' | 'unresolved',
        drugCodeResolutionSource: 'drug_master_code' as string | null,
        candidateDrugMasterId: null as string | null,
        candidateDrugCode: null as string | null,
        candidateDrugName: null as string | null,
        dose: '1錠',
        frequency: '1日1回朝食後',
        days: 14,
      },
    ],
  },
  parse_errors: [],
  auto_completed: [],
  expected_qr_count: null,
  jahis_supplemental_records: [],
  created_at: '2026-06-29T00:00:00.000Z',
};

let draft = baseDraft;
let mutationConfigs: MutationConfig[];
let casesQueryResult: {
  data?: { data: Array<{ id: string; display_id?: string | null; status: string }> };
  isError?: boolean;
  isLoading?: boolean;
};

beforeEach(() => {
  vi.clearAllMocks();
  draft = baseDraft;
  mutationConfigs = [];
  useOrgIdMock.mockReturnValue('org_1');
  useMutationMock.mockImplementation((config: MutationConfig) => {
    mutationConfigs.push(config);
    return { mutate: vi.fn(), isPending: false };
  });
  casesQueryResult = { data: undefined, isError: true, isLoading: false };
  useQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
    switch (queryKey[0]) {
      case 'qr-scan-draft':
        return { data: draft, isLoading: false, isError: false, refetch: refetchDraftMock };
      case 'patient-cases':
        return {
          data: casesQueryResult.data,
          isLoading: Boolean(casesQueryResult.isLoading),
          isError: Boolean(casesQueryResult.isError),
          refetch: refetchCasesMock,
        };
      default:
        return { data: undefined, isLoading: false, isError: false, refetch: vi.fn() };
    }
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('QrDraftReviewPage case lookup error handling', () => {
  it('surfaces a retryable error instead of a false missing-draft state', () => {
    useQueryMock.mockImplementation(({ queryKey }: { queryKey: unknown[] }) => {
      switch (queryKey[0]) {
        case 'qr-scan-draft':
          return { data: undefined, isLoading: false, isError: true, refetch: refetchDraftMock };
        case 'patient-cases':
          return {
            data: undefined,
            isLoading: false,
            isError: false,
            refetch: refetchCasesMock,
          };
        default:
          return { data: undefined, isLoading: false, isError: false, refetch: vi.fn() };
      }
    });

    render(<QrDraftReviewPage />);

    expect(screen.getByText('QRスキャン下書きを読み込めませんでした')).toBeTruthy();
    expect(screen.queryByText('QRスキャン下書きが見つかりません')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }));

    expect(refetchDraftMock).toHaveBeenCalledTimes(1);
  });

  it('surfaces a retryable error instead of a false empty case selector', () => {
    render(<QrDraftReviewPage />);

    expect(screen.getByText('ケース一覧を読み込めませんでした')).toBeTruthy();
    expect(screen.queryByText('この患者に紐付くアクティブなケースが見つかりません。')).toBeNull();
    expect(screen.getByText('ケース一覧の再読み込み')).toBeTruthy();
    expect((screen.getByRole('button', { name: '確定' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }));
    expect(refetchCasesMock).toHaveBeenCalledTimes(1);
  });

  it('drops a previously selected case when it disappears from the active case options', () => {
    casesQueryResult = {
      data: {
        data: [
          { id: 'case_1', status: 'active' },
          { id: 'case_2', status: 'active' },
        ],
      },
      isError: false,
      isLoading: false,
    };
    const { rerender } = render(<QrDraftReviewPage />);

    fireEvent.change(screen.getByLabelText('QR下書きのケース選択'), {
      target: { value: 'case_2' },
    });

    casesQueryResult = {
      data: { data: [{ id: 'case_1', status: 'active' }] },
      isError: false,
      isLoading: false,
    };
    rerender(<QrDraftReviewPage />);

    expect(screen.getByText('ケースの再選択')).toBeTruthy();
    expect((screen.getByRole('button', { name: '確定' }) as HTMLButtonElement).disabled).toBe(true);
    expect(
      screen.getByRole('link', { name: '処方登録画面で編集' }).getAttribute('href'),
    ).not.toContain('case_id=case_2');
  });

  it('encodes hostile patient and case ids in lookup URLs and registration links', async () => {
    draft = {
      ...baseDraft,
      id: 'draft&evil=1',
      patient_id: 'pt&case_id=case_other',
    };
    casesQueryResult = {
      data: {
        data: [{ id: 'case&safe=1', display_id: 'cc0000000789', status: 'active' }],
      },
      isError: false,
      isLoading: false,
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ data: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<QrDraftReviewPage />);

    const option = screen.getByRole('option', {
      name: 'cc0000000789 (active)',
    }) as HTMLOptionElement;
    expect(option.value).toBe('case&safe=1');
    expect(screen.queryByText(/case&safe/)).toBeNull();

    const patientCasesQuery = useQueryMock.mock.calls
      .map(([config]) => config as QueryConfig)
      .find((config) => config.queryKey[0] === 'patient-cases');
    if (!patientCasesQuery?.queryFn) {
      throw new Error('patient-cases queryFn was not registered');
    }
    await patientCasesQuery.queryFn();

    const lookupUrl = new URL(String(fetchMock.mock.calls[0]?.[0]), 'http://localhost');
    expect(lookupUrl.searchParams.get('patient_id')).toBe('pt&case_id=case_other');
    expect(lookupUrl.searchParams.get('case_id')).toBeNull();

    const registrationUrl = new URL(
      screen.getByRole('link', { name: '処方登録画面で編集' }).getAttribute('href') ?? '',
      'http://localhost',
    );
    expect(registrationUrl.searchParams.get('qr_draft_id')).toBe('draft&evil=1');
    expect(registrationUrl.searchParams.get('patient_id')).toBe('pt&case_id=case_other');
    expect(registrationUrl.searchParams.get('case_id')).toBe('case&safe=1');
    expect(registrationUrl.search).not.toContain('cc0000000789');
  });

  it('requires adopting a review-required DrugMaster candidate before QR confirmation', async () => {
    draft = {
      ...baseDraft,
      parsed_data: {
        ...baseDraft.parsed_data,
        lines: [
          {
            ...baseDraft.parsed_data.lines[0],
            drugCode: '',
            sourceDrugCode: 'receipt_123',
            sourceDrugCodeType: 'receipt',
            drugCodeResolutionStatus: 'review_required',
            drugCodeResolutionSource: 'drug_master_name_fallback',
            candidateDrugMasterId: 'drug_master_1',
            candidateDrugCode: '2171013F1028',
            candidateDrugName: 'アムロジピン錠5mg',
          },
        ],
      },
    };
    casesQueryResult = {
      data: { data: [{ id: 'case_1', display_id: 'cc0000000789', status: 'active' }] },
      isError: false,
      isLoading: false,
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ intake: { id: 'intake_1' }, cycle: { id: 'cycle_1' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<QrDraftReviewPage />);

    expect(screen.getByText('医薬品マスター確認')).toBeTruthy();
    expect(screen.getByText(/候補:/)).toBeTruthy();
    expect((screen.getByRole('button', { name: '確定' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(
      screen.getByRole('button', { name: '処方明細1件目の医薬品マスター候補を採用' }),
    );

    expect(screen.getByText('候補採用済み')).toBeTruthy();
    expect((screen.getByRole('button', { name: '確定' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    await waitFor(() => expect(mutationConfigs.length).toBeGreaterThan(2));

    const confirmMutation = mutationConfigs[mutationConfigs.length - 2];
    if (!confirmMutation?.mutationFn) {
      throw new Error('confirm mutationFn was not registered');
    }
    await act(async () => {
      await confirmMutation.mutationFn?.();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/qr-scan-drafts/draft_1/confirm',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': 'org_1' },
      }),
    );
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.case_id).toBe('case_1');
    expect(JSON.stringify(body)).not.toContain('cc0000000789');
    expect(body.lines[0]).toEqual(
      expect.objectContaining({
        drug_name: 'アムロジピン錠5mg',
        drug_master_id: 'drug_master_1',
        dose: '1錠',
        frequency: '1日1回朝食後',
        days: 14,
      }),
    );
    expect(body.lines[0]).not.toHaveProperty('drug_code');
  });
});
