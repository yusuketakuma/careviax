// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { buildOrgHeaders } from '@/lib/api/org-headers';
import { buildPrescriptionHref } from '@/lib/prescriptions/navigation';
import { buildPatientHref } from '@/lib/patient/navigation';
import { PrescriptionInlineDetail } from './prescription-inline-detail';

setupDomTestEnv();

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
}));

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

vi.mock('@/components/features/patients/patient-history-summary', () => ({
  PatientHistorySummary: () => <div>直近過去歴サマリー</div>,
}));

// Actual-backed spy: real behavior stays in place by default, while the
// queryFn test can use a sentinel return to prove the shared header helper is
// consumed instead of a manually equal-shaped literal.
vi.mock('@/lib/api/org-headers', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/org-headers')>();
  return { ...actual, buildOrgHeaders: vi.fn(actual.buildOrgHeaders) };
});

// Actual-backed spies: real encode/guard output for the existing hostile
// prescription id assertions and the hostile patient id test, plus return-value
// delegation teeth for the 詳細 / 全画面表示 / 患者 browser links.
vi.mock('@/lib/prescriptions/navigation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/prescriptions/navigation')>();
  return { ...actual, buildPrescriptionHref: vi.fn(actual.buildPrescriptionHref) };
});
vi.mock('@/lib/patient/navigation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/patient/navigation')>();
  return { ...actual, buildPatientHref: vi.fn(actual.buildPatientHref) };
});

type QueryConfig = {
  queryKey: unknown[];
  queryFn: () => Promise<unknown>;
};

describe('PrescriptionInlineDetail', () => {
  beforeEach(() => {
    useOrgIdMock.mockReset();
    useQueryMock.mockReset();
    fetchMock.mockReset();
    vi.mocked(buildOrgHeaders).mockClear();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('shows patient history links and encodes prescription detail links from the detail pane', () => {
    const hostileId = '../settings?x=1#frag';
    useOrgIdMock.mockReturnValue('org_1');
    useQueryMock.mockReturnValue({
      data: {
        id: hostileId,
        cycle_id: 'cycle_1',
        source_type: 'paper',
        prescribed_date: '2026-04-20T00:00:00.000Z',
        prescriber_name: '佐藤医師',
        prescriber_institution: '佐藤医院',
        prescriber_institution_id: null,
        prescriber_institution_ref: null,
        prescription_expiry_date: null,
        original_document_url: null,
        refill_remaining_count: null,
        refill_next_dispense_date: null,
        split_dispense_total: null,
        split_dispense_current: null,
        split_next_dispense_date: null,
        created_at: '2026-04-20T09:00:00.000Z',
        lines: [
          {
            id: 'line_1',
            line_number: 1,
            drug_name: 'アムロジピン錠5mg',
            drug_code: '2149001',
            dosage_form: '錠',
            dose: '1錠',
            frequency: '1日1回朝食後',
            days: 14,
            route: 'internal',
            dispensing_method: null,
            is_generic: false,
            is_generic_name_prescription: false,
            packaging_instructions: null,
            notes: null,
          },
        ],
        cycle: {
          id: 'cycle_1',
          overall_status: 'intake_received',
          patient_id: 'patient_1',
          case_id: 'case_1',
          case_: {
            patient: {
              id: 'patient_1',
              name: '山田太郎',
              name_kana: 'ヤマダタロウ',
              birth_date: '1940-01-01T00:00:00.000Z',
              gender: 'male',
            },
          },
          inquiries: [],
        },
      },
      isLoading: false,
      error: null,
    });

    render(<PrescriptionInlineDetail intakeId={hostileId} />);

    expect(screen.getByRole('heading', { name: '患者の過去歴' })).toBeTruthy();
    const encodedPrescriptionHref = `/prescriptions/${encodeURIComponent(hostileId)}`;
    expect(screen.getByRole('link', { name: /詳細/ }).getAttribute('href')).toBe(
      encodedPrescriptionHref,
    );
    expect(screen.getByRole('link', { name: /詳細/ }).className).toContain('!min-h-11');
    expect(screen.getByRole('link', { name: /詳細/ }).className).toContain('sm:!min-h-11');
    expect(screen.getByRole('link', { name: '全画面表示' }).getAttribute('href')).toBe(
      encodedPrescriptionHref,
    );
    expect(screen.getByRole('link', { name: '全画面表示' }).className).toContain('!min-h-11');
    expect(screen.getByRole('link', { name: '全画面表示' }).className).toContain('sm:!min-h-11');
    expect(screen.getByRole('link', { name: /処方歴/ }).getAttribute('href')).toBe(
      '/patients/patient_1/prescriptions',
    );
    expect(screen.getByRole('link', { name: /訪問歴/ }).getAttribute('href')).toBe(
      '/patients/patient_1#card-recent-activities',
    );
    expect(screen.getByRole('link', { name: /統合履歴/ }).getAttribute('href')).toBe(
      '/patients/patient_1#card-recent-activities',
    );
  });

  it('encodes decoded route ids before fetching prescription intake details', async () => {
    const hostileId = '../settings?x=1#frag';
    const sentinelHeaders = { 'x-org-id': 'org_1', 'x-test-helper': 'buildOrgHeaders' };
    let queryConfig: QueryConfig | undefined;

    useOrgIdMock.mockReturnValue('org_1');
    vi.mocked(buildOrgHeaders).mockReturnValueOnce(sentinelHeaders);
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

    render(<PrescriptionInlineDetail intakeId={hostileId} />);

    if (!queryConfig) throw new Error('query config was not captured');
    expect(queryConfig.queryKey).toEqual(['prescription-intake-detail', 'org_1', hostileId]);
    await queryConfig.queryFn();

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/prescription-intakes/${encodeURIComponent(hostileId)}`,
      {
        headers: sentinelHeaders,
      },
    );
    expect(vi.mocked(buildOrgHeaders)).toHaveBeenCalledWith('org_1');
    expect(fetchMock.mock.calls[0]?.[0]).not.toContain('%25');
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

      render(<PrescriptionInlineDetail intakeId={intakeId} />);

      if (!queryConfig) throw new Error('query config was not captured');
      await expect(queryConfig.queryFn()).rejects.toThrow(RangeError);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  function buildDetailData(prescriptionId: string, patientId: string) {
    return {
      id: prescriptionId,
      cycle_id: 'cycle_1',
      source_type: 'paper',
      prescribed_date: '2026-04-20T00:00:00.000Z',
      prescriber_name: '佐藤医師',
      prescriber_institution: '佐藤医院',
      prescriber_institution_id: null,
      prescriber_institution_ref: null,
      prescription_expiry_date: null,
      original_document_url: null,
      refill_remaining_count: null,
      refill_next_dispense_date: null,
      split_dispense_total: null,
      split_dispense_current: null,
      split_next_dispense_date: null,
      created_at: '2026-04-20T09:00:00.000Z',
      lines: [
        {
          id: 'line_1',
          line_number: 1,
          drug_name: 'アムロジピン錠5mg',
          drug_code: '2149001',
          dosage_form: '錠',
          dose: '1錠',
          frequency: '1日1回朝食後',
          days: 14,
          route: 'internal',
          dispensing_method: null,
          is_generic: false,
          is_generic_name_prescription: false,
          packaging_instructions: null,
          notes: null,
        },
      ],
      cycle: {
        id: 'cycle_1',
        overall_status: 'intake_received',
        patient_id: patientId,
        case_id: 'case_1',
        case_: {
          patient: {
            id: patientId,
            name: '山田太郎',
            name_kana: 'ヤマダタロウ',
            birth_date: '1940-01-01T00:00:00.000Z',
            gender: 'male',
          },
        },
        inquiries: [],
      },
    };
  }

  it('delegates 詳細/全画面表示 to buildPrescriptionHref and 患者 to buildPatientHref (return-value)', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useQueryMock.mockReturnValue({
      data: buildDetailData('rx_1', 'patient_1'),
      isLoading: false,
      error: null,
    });

    const realRx = vi.mocked(buildPrescriptionHref).getMockImplementation();
    const realPt = vi.mocked(buildPatientHref).getMockImplementation();
    vi.mocked(buildPrescriptionHref).mockImplementation(
      (id: string) => `/prescriptions/__s_${id}__`,
    );
    vi.mocked(buildPatientHref).mockImplementation(
      (id: string, suffix = '') => `/patients/__s_${id}__${suffix}`,
    );
    vi.mocked(buildPrescriptionHref).mockClear();
    vi.mocked(buildPatientHref).mockClear();
    try {
      render(<PrescriptionInlineDetail intakeId="rx_1" />);

      expect(screen.getByRole('link', { name: /詳細/ }).getAttribute('href')).toBe(
        '/prescriptions/__s_rx_1__',
      );
      expect(screen.getByRole('link', { name: '全画面表示' }).getAttribute('href')).toBe(
        '/prescriptions/__s_rx_1__',
      );
      // 患者 button passes the raw id with no suffix (distinct from the
      // QuickLinks suffixed calls), and renders the helper's return value.
      expect(screen.getByRole('link', { name: '患者' }).getAttribute('href')).toBe(
        '/patients/__s_patient_1__',
      );
      expect(screen.getByRole('link', { name: '患者' }).className).toContain('!min-h-11');
      expect(screen.getByRole('link', { name: '患者' }).className).toContain('sm:!min-h-11');
      // shared const -> buildPrescriptionHref invoked exactly once for data.id.
      expect(vi.mocked(buildPrescriptionHref).mock.calls).toEqual([['rx_1']]);
      expect(vi.mocked(buildPatientHref).mock.calls).toContainEqual(['patient_1']);
    } finally {
      if (realRx) vi.mocked(buildPrescriptionHref).mockImplementation(realRx);
      if (realPt) vi.mocked(buildPatientHref).mockImplementation(realPt);
    }
  });

  it('encodes a hostile patient id in the 患者 detail link as a single path segment', () => {
    const hostilePatientId = 'pt/1?x=y#z';
    useOrgIdMock.mockReturnValue('org_1');
    useQueryMock.mockReturnValue({
      data: buildDetailData('rx_1', hostilePatientId),
      isLoading: false,
      error: null,
    });

    render(<PrescriptionInlineDetail intakeId="rx_1" />);

    const patientHref = screen.getByRole('link', { name: '患者' }).getAttribute('href') ?? '';
    expect(patientHref).toBe(`/patients/${encodeURIComponent(hostilePatientId)}`);
    expect(patientHref).not.toContain('?x=y');
    expect(patientHref).not.toContain('#z');
    // raw id passed to the helper (not pre-encoded) -> no double-encode.
    expect(patientHref).not.toContain('%25');
  });
});
