// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { jsonResponse } from '@/test/fetch-test-utils';
import { buildPatientWorkflowPreviewApiPath } from '@/lib/patient/api-paths';
import { buildPatientHref } from '@/lib/patient/navigation';
import { buildOrgHeaders } from '@/lib/api/org-headers';
import { PatientWorkflowPreviewCard } from './patient-workflow-preview-card';

setupDomTestEnv();

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());

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

// Actual-backed spy: real encode/guard output for the hostile patient id test,
// plus return-value delegation teeth for the five patient browser links.
vi.mock('@/lib/patient/navigation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/patient/navigation')>();
  return { ...actual, buildPatientHref: vi.fn(actual.buildPatientHref) };
});

// Actual-backed spy for the org-header helper so the fetch test can prove helper adoption (not equal shape).
vi.mock('@/lib/api/org-headers', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/org-headers')>();
  return { ...actual, buildOrgHeaders: vi.fn(actual.buildOrgHeaders) };
});

vi.mock('@/lib/patient/api-paths', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/patient/api-paths')>();
  return {
    ...actual,
    buildPatientWorkflowPreviewApiPath: vi.fn(actual.buildPatientWorkflowPreviewApiPath),
  };
});

describe('PatientWorkflowPreviewCard', () => {
  it('renders a PH-OS skeleton while the workflow preview loads', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useQueryMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    });

    render(<PatientWorkflowPreviewCard patientId="patient_1" />);

    expect(screen.getByRole('status', { name: 'ワークフロープレビューを読み込み中' })).toBeTruthy();
    expect(screen.queryByRole('status', { name: '読み込み中...' })).toBeNull();
    expect(screen.queryByText('ワークフロープレビューの取得に失敗しました')).toBeNull();
    expect(screen.queryByRole('heading', { name: '訪問準備プレビュー' })).toBeNull();
  });

  it('renders visit, report, and communication preview sections', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useQueryMock.mockReturnValue({
      data: {
        visit_preparation: {
          onboarding_readiness: {
            consent_obtained: true,
            emergency_contact_set: true,
            primary_physician_set: true,
            management_plan_approved: false,
          },
          scheduling_preview: {
            preferred_weekdays: [1, 3],
            preferred_time_from: '1970-01-01T09:00:00.000-08:00',
            preferred_time_to: '1970-01-01T12:00:00.000-0800',
            phone_contact_from: null,
            phone_contact_to: null,
            facility_time_from: null,
            facility_time_to: null,
            family_presence_required: false,
            visit_buffer_minutes: 30,
            preferred_contact_name: '長男 山田',
            preferred_contact_phone: '090-1111-2222',
            visit_before_contact_required: true,
            first_visit_preferred_date: null,
            first_visit_time_slot: null,
            first_visit_time_note: null,
            parking_available: true,
            primary_contact_preference: 'phone',
            mcs_linked: true,
          },
          baseline_context: {
            primary_disease: '心不全',
            care_level: 'care_3',
            adl_level: 'b',
            dementia_level: 'ii',
            money_management: 'family',
            family_key_person: '長男 山田',
            medication_support_methods: ['unit_dose'],
            special_medical_procedures: ['narcotics'],
            infection_isolation: null,
            narcotics_base: true,
            narcotics_rescue: false,
            residual_medication_status: '調整中',
          },
          latest_labs: [],
          blockers: ['承認済み管理計画書がありません。'],
        },
        report_targets: [
          {
            key: 'physician_report',
            label: '医師向け報告',
            available: true,
            source: 'care_team',
            recipient_name: '主治医 佐藤',
            recipient_organization: '佐藤医院',
            contact: 'TEL 03-0000-1111',
          },
        ],
        communication_priority: {
          preferred_contact_method: 'phone',
          effective_channel: 'phone',
          visit_before_contact_required: true,
          pharmacy_decision_due_date: null,
          targets: [
            {
              key: 'family',
              recipientRole: 'family_share',
              recipientName: '長男 山田',
              contact: '090-1111-2222',
              priority_order: 1,
            },
          ],
          warnings: ['患者・家族への事前連絡を優先します。'],
        },
      },
      isLoading: false,
      error: null,
    });

    render(<PatientWorkflowPreviewCard patientId="patient_1" />);

    expect(
      screen.getByRole('heading', { level: 2, name: '訪問・報告・連携プレビュー' }).tagName,
    ).toBe('H2');
    expect(screen.getByRole('heading', { name: '訪問準備プレビュー' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '報告先マトリクス' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '連携優先順位プレビュー' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '患者編集' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '同意記録' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'MCS連携' })).toBeTruthy();
    expect(screen.getByText('09:00 - 12:00')).toBeTruthy();
    expect(screen.getByText('医師向け報告')).toBeTruthy();
    expect(screen.getByText('患者情報')).toBeTruthy();
    expect(screen.getByText(/佐藤医院/)).toBeTruthy();
    expect(screen.getByText('患者・家族への事前連絡を優先します。')).toBeTruthy();
  });

  function buildPreviewData() {
    return {
      visit_preparation: {
        onboarding_readiness: {
          consent_obtained: true,
          emergency_contact_set: true,
          primary_physician_set: true,
          management_plan_approved: false,
        },
        scheduling_preview: {
          preferred_weekdays: [1, 3],
          preferred_time_from: '1970-01-01T09:00:00.000-08:00',
          preferred_time_to: '1970-01-01T12:00:00.000-0800',
          phone_contact_from: null,
          phone_contact_to: null,
          facility_time_from: null,
          facility_time_to: null,
          family_presence_required: false,
          visit_buffer_minutes: 30,
          preferred_contact_name: '長男 山田',
          preferred_contact_phone: '090-1111-2222',
          visit_before_contact_required: true,
          first_visit_preferred_date: null,
          first_visit_time_slot: null,
          first_visit_time_note: null,
          parking_available: true,
          primary_contact_preference: 'phone',
          mcs_linked: true,
        },
        baseline_context: {
          primary_disease: '心不全',
          care_level: 'care_3',
          adl_level: 'b',
          dementia_level: 'ii',
          money_management: 'family',
          family_key_person: '長男 山田',
          medication_support_methods: ['unit_dose'],
          special_medical_procedures: ['narcotics'],
          infection_isolation: null,
          narcotics_base: true,
          narcotics_rescue: false,
          residual_medication_status: '調整中',
        },
        latest_labs: [],
        blockers: ['承認済み管理計画書がありません。'],
      },
      report_targets: [
        {
          key: 'physician_report',
          label: '医師向け報告',
          available: true,
          source: 'care_team',
          recipient_name: '主治医 佐藤',
          recipient_organization: '佐藤医院',
          contact: 'TEL 03-0000-1111',
        },
      ],
      communication_priority: {
        preferred_contact_method: 'phone',
        effective_channel: 'phone',
        visit_before_contact_required: true,
        pharmacy_decision_due_date: null,
        targets: [
          {
            key: 'family',
            recipientRole: 'family_share',
            recipientName: '長男 山田',
            contact: '090-1111-2222',
            priority_order: 1,
          },
        ],
        warnings: ['患者・家族への事前連絡を優先します。'],
      },
    };
  }

  it('routes the five patient links through buildPatientHref (return-value delegation)', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useQueryMock.mockReturnValue({ data: buildPreviewData(), isLoading: false, error: null });

    const realImpl = vi.mocked(buildPatientHref).getMockImplementation();
    vi.mocked(buildPatientHref).mockImplementation(
      (id: string, suffix = '') => `/patients/__s_${id}__${suffix}`,
    );
    vi.mocked(buildPatientHref).mockClear();
    try {
      render(<PatientWorkflowPreviewCard patientId="patient_1" />);

      expect(screen.getByRole('link', { name: '患者編集' }).getAttribute('href')).toBe(
        '/patients/__s_patient_1__/edit',
      );
      expect(screen.getByRole('link', { name: '同意記録' }).getAttribute('href')).toBe(
        '/patients/__s_patient_1__/consent',
      );
      expect(screen.getByRole('link', { name: 'MCS連携' }).getAttribute('href')).toBe(
        '/patients/__s_patient_1__/mcs',
      );
      expect(screen.getByRole('link', { name: '共有設定' }).getAttribute('href')).toBe(
        '/patients/__s_patient_1__/share',
      );
      expect(screen.getByRole('link', { name: '連携先確認' }).getAttribute('href')).toBe(
        '/patients/__s_patient_1__/mcs',
      );
      // render order, with the duplicate /mcs locked as two explicit calls.
      expect(vi.mocked(buildPatientHref).mock.calls).toEqual([
        ['patient_1', '/edit'],
        ['patient_1', '/consent'],
        ['patient_1', '/mcs'],
        ['patient_1', '/share'],
        ['patient_1', '/mcs'],
      ]);
    } finally {
      if (realImpl) {
        vi.mocked(buildPatientHref).mockImplementation(realImpl);
      }
    }
  });

  it('encodes a hostile patientId in every patient link as a single path segment', () => {
    const hostileId = 'pt/1?x=y#z';
    const encoded = encodeURIComponent(hostileId);
    useOrgIdMock.mockReturnValue('org_1');
    useQueryMock.mockReturnValue({ data: buildPreviewData(), isLoading: false, error: null });

    render(<PatientWorkflowPreviewCard patientId={hostileId} />);

    const cases: Array<[string, string]> = [
      ['患者編集', '/edit'],
      ['同意記録', '/consent'],
      ['MCS連携', '/mcs'],
      ['共有設定', '/share'],
      ['連携先確認', '/mcs'],
    ];
    for (const [name, suffix] of cases) {
      const href = screen.getByRole('link', { name }).getAttribute('href') ?? '';
      expect(href).toBe(`/patients/${encoded}${suffix}`);
      expect(href).not.toContain('?x=y');
      expect(href).not.toContain('#z');
      // raw id passed to the helper (not pre-encoded) -> no double-encode.
      expect(href).not.toContain('%25');
    }
  });

  it('encodes a hostile patientId in the workflow-preview fetch URL with helper org headers and raw queryKey', async () => {
    const hostileId = 'pt/1?x=y#z';
    const sentinelHeaders = { 'x-org-id': 'org_1', 'x-test-helper': 'buildOrgHeaders' };
    vi.mocked(buildOrgHeaders).mockReturnValue(sentinelHeaders);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(buildPreviewData()));
    vi.stubGlobal('fetch', fetchMock);
    useOrgIdMock.mockReturnValue('org_1');

    let captured: { queryKey: unknown[]; queryFn: () => Promise<unknown> } | undefined;
    useQueryMock.mockImplementation(
      (config: { queryKey: unknown[]; queryFn: () => Promise<unknown> }) => {
        captured = config;
        return { data: undefined, isLoading: true, error: null };
      },
    );

    try {
      render(<PatientWorkflowPreviewCard patientId={hostileId} />);

      if (!captured) throw new Error('query config was not captured');
      expect(captured.queryKey).toEqual(['patient-workflow-preview', hostileId, 'org_1']);
      await captured.queryFn();

      // exactly one fetch; inspect the single call for URL + header REFERENCE identity (toBe), not structural match -
      // a `{ ...buildOrgHeaders(orgId) }` spread regression would fail this.
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [fetchedUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(fetchedUrl).toBe(`/api/patients/${encodeURIComponent(hostileId)}/workflow-preview`);
      expect(init.headers).toBe(sentinelHeaders);
      expect(vi.mocked(buildOrgHeaders)).toHaveBeenCalledWith('org_1');
      expect(fetchedUrl).not.toContain('?x=y');
      expect(fetchedUrl).not.toContain('#z');
      expect(fetchedUrl).not.toContain('%25');
    } finally {
      vi.unstubAllGlobals();
      vi.mocked(buildOrgHeaders).mockReset();
    }
  });

  it('routes the workflow-preview fetch through buildPatientWorkflowPreviewApiPath', async () => {
    const sentinelHeaders = { 'x-org-id': 'org_1', 'x-test-helper': 'buildOrgHeaders' };
    vi.mocked(buildOrgHeaders).mockReturnValue(sentinelHeaders);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(buildPreviewData()));
    vi.stubGlobal('fetch', fetchMock);
    useOrgIdMock.mockReturnValue('org_1');

    let captured: { queryKey: unknown[]; queryFn: () => Promise<unknown> } | undefined;
    useQueryMock.mockImplementation(
      (config: { queryKey: unknown[]; queryFn: () => Promise<unknown> }) => {
        captured = config;
        return { data: undefined, isLoading: true, error: null };
      },
    );

    const realImpl = vi.mocked(buildPatientWorkflowPreviewApiPath).getMockImplementation();
    vi.mocked(buildPatientWorkflowPreviewApiPath).mockImplementation(
      (id: string) => `/api/patients/__workflow_${id}__/workflow-preview`,
    );
    vi.mocked(buildPatientWorkflowPreviewApiPath).mockClear();
    try {
      render(<PatientWorkflowPreviewCard patientId="patient_1" />);

      if (!captured) throw new Error('query config was not captured');
      expect(captured.queryKey).toEqual(['patient-workflow-preview', 'patient_1', 'org_1']);
      await captured.queryFn();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [fetchedUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(fetchedUrl).toBe('/api/patients/__workflow_patient_1__/workflow-preview');
      expect(init.headers).toBe(sentinelHeaders);
      expect(vi.mocked(buildPatientWorkflowPreviewApiPath)).toHaveBeenCalledWith('patient_1');
    } finally {
      vi.unstubAllGlobals();
      vi.mocked(buildOrgHeaders).mockReset();
      if (realImpl) {
        vi.mocked(buildPatientWorkflowPreviewApiPath).mockImplementation(realImpl);
      }
    }
  });

  it('keeps API messages from failed workflow-preview fetches', async () => {
    const sentinelHeaders = { 'x-org-id': 'org_1', 'x-test-helper': 'buildOrgHeaders' };
    vi.mocked(buildOrgHeaders).mockReturnValue(sentinelHeaders);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ message: 'workflow preview APIからの詳細エラー' }, 500));
    vi.stubGlobal('fetch', fetchMock);
    useOrgIdMock.mockReturnValue('org_1');

    let captured: { queryKey: unknown[]; queryFn: () => Promise<unknown> } | undefined;
    useQueryMock.mockImplementation(
      (config: { queryKey: unknown[]; queryFn: () => Promise<unknown> }) => {
        captured = config;
        return { data: undefined, isLoading: true, error: null };
      },
    );

    try {
      render(<PatientWorkflowPreviewCard patientId="patient_1" />);

      if (!captured) throw new Error('query config was not captured');
      await expect(captured.queryFn()).rejects.toThrow('workflow preview APIからの詳細エラー');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
      vi.mocked(buildOrgHeaders).mockReset();
    }
  });

  it.each(['.', '..'])(
    'fails closed for exact dot-segment patientId %p instead of normalizing the API path',
    async (dotId) => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(buildPreviewData()));
      vi.stubGlobal('fetch', fetchMock);
      useOrgIdMock.mockReturnValue('org_1');

      let captured: { queryKey: unknown[]; queryFn: () => Promise<unknown> } | undefined;
      useQueryMock.mockImplementation(
        (config: { queryKey: unknown[]; queryFn: () => Promise<unknown> }) => {
          captured = config;
          return { data: undefined, isLoading: true, error: null };
        },
      );

      try {
        render(<PatientWorkflowPreviewCard patientId={dotId} />);

        if (!captured) throw new Error('query config was not captured');
        // raw identity preserved in the query key.
        expect(captured.queryKey).toEqual(['patient-workflow-preview', dotId, 'org_1']);
        // RangeError before fetch: no normalized /api/patients/workflow-preview request.
        await expect(captured.queryFn()).rejects.toThrow(RangeError);
        expect(fetchMock).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );
});
