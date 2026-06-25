// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { PrescriptionDetailContent } from './prescription-detail-content';

setupDomTestEnv();

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const routerBackMock = vi.hoisted(() => vi.fn());
const fetchMock = vi.hoisted(() => vi.fn());
const buildOrgHeadersMock = vi.hoisted(() => vi.fn());
const buildPatientHrefMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    back: routerBackMock,
  }),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
}));

vi.mock('@/lib/api/org-headers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/org-headers')>();
  buildOrgHeadersMock.mockImplementation(actual.buildOrgHeaders);
  return {
    ...actual,
    buildOrgHeaders: buildOrgHeadersMock,
  };
});

vi.mock('@/lib/patient/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/patient/navigation')>();
  buildPatientHrefMock.mockImplementation(actual.buildPatientHref);
  return {
    ...actual,
    buildPatientHref: buildPatientHrefMock,
  };
});

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

type QueryConfig = {
  queryKey: unknown[];
  queryFn: () => Promise<unknown>;
};

function buildPrescriptionDetail(patientId = 'patient_1') {
  return {
    id: 'intake_1',
    cycle_id: 'cycle_1',
    source_type: 'paper',
    prescribed_date: '2026-06-01T00:00:00.000Z',
    prescriber_name: null,
    prescriber_institution: null,
    prescriber_institution_id: null,
    prescriber_institution_ref: null,
    prescription_expiry_date: null,
    original_document_url: null,
    refill_remaining_count: null,
    refill_next_dispense_date: null,
    split_dispense_total: null,
    split_dispense_current: null,
    split_next_dispense_date: null,
    created_at: '2026-06-01T09:00:00.000Z',
    jahis_supplemental_records: [],
    lines: [],
    cycle: {
      id: 'cycle_1',
      overall_status: 'pending',
      patient_id: patientId,
      case_id: 'case_1',
      case_: {
        patient: {
          id: patientId,
          name: '田中 一郎',
          name_kana: 'タナカ イチロウ',
          birth_date: '1942-04-12',
          gender: 'male',
        },
      },
      inquiries: [],
    },
  };
}

describe('PrescriptionDetailContent', () => {
  beforeEach(() => {
    useOrgIdMock.mockReset();
    useQueryMock.mockReset();
    routerBackMock.mockReset();
    fetchMock.mockReset();
    buildOrgHeadersMock.mockClear();
    buildPatientHrefMock.mockClear();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('encodes decoded route ids before fetching prescription intake details', async () => {
    const hostileId = '../settings?x=1#frag';
    const sentinelHeaders = { 'x-org-id': 'org_1', 'x-test-helper': 'buildOrgHeaders' };
    let queryConfig: QueryConfig | undefined;

    useOrgIdMock.mockReturnValue('org_1');
    buildOrgHeadersMock.mockReturnValueOnce(sentinelHeaders);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    useQueryMock.mockImplementation((config: QueryConfig) => {
      queryConfig = config;
      return {
        data: null,
        isLoading: true,
        error: null,
      };
    });

    render(<PrescriptionDetailContent intakeId={hostileId} />);

    if (!queryConfig) throw new Error('query config was not captured');
    expect(queryConfig.queryKey).toEqual(['prescription-intake-detail', 'org_1', hostileId]);
    await queryConfig.queryFn();

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/prescription-intakes/${encodeURIComponent(hostileId)}`,
      {
        headers: sentinelHeaders,
      },
    );
    expect(buildOrgHeadersMock).toHaveBeenCalledWith('org_1');
    expect(fetchMock.mock.calls[0]?.[0]).not.toContain('%25');
  });

  it('renders a retryable error state with reload + back when the detail fetch fails', () => {
    const refetchMock = vi.fn();
    useOrgIdMock.mockReturnValue('org_1');
    useQueryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('処方受付の取得に失敗しました'),
      refetch: refetchMock,
    });

    render(<PrescriptionDetailContent intakeId="intake_1" />);

    expect(screen.getByText('処方受付を取得できませんでした')).toBeTruthy();
    expect(screen.getByRole('button', { name: '戻る' })).toBeTruthy();
    // retry 導線(共有 ErrorState の再読み込み)が refetch を呼ぶ。
    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }));
    expect(refetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(['.', '..'])(
    'rejects exact dot intake ids before fetching prescription intake details (%s)',
    async (intakeId) => {
      let queryConfig: QueryConfig | undefined;

      useOrgIdMock.mockReturnValue('org_1');
      useQueryMock.mockImplementation((config: QueryConfig) => {
        queryConfig = config;
        return {
          data: null,
          isLoading: true,
          error: null,
        };
      });

      render(<PrescriptionDetailContent intakeId={intakeId} />);

      if (!queryConfig) throw new Error('query config was not captured');
      await expect(queryConfig.queryFn()).rejects.toThrow(RangeError);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('renders all patient detail links through buildPatientHref', () => {
    const hostilePatientId = 'patient/1?x=y#z';
    const sentinelHref = '/patients/__helper_patient_1__';

    useOrgIdMock.mockReturnValue('org_1');
    buildPatientHrefMock.mockReturnValueOnce(sentinelHref);
    useQueryMock.mockReturnValue({
      data: buildPrescriptionDetail(hostilePatientId),
      isLoading: false,
      error: null,
    });

    const { container } = render(<PrescriptionDetailContent intakeId="intake_1" />);
    const patientLinks = Array.from(container.querySelectorAll(`a[href="${sentinelHref}"]`));

    expect(patientLinks).toHaveLength(3);
    expect(buildPatientHrefMock).toHaveBeenCalledTimes(1);
    expect(buildPatientHrefMock).toHaveBeenCalledWith(hostilePatientId);
    expect(container.innerHTML).not.toContain(`/patients/${hostilePatientId}`);
    expect(container.innerHTML).not.toContain(hostilePatientId);
  });
});
