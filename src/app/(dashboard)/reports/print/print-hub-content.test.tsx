// @vitest-environment jsdom

import type { QueryClient } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { buildPatientApiPath } from '@/lib/patient/api-paths';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { createQueryClientWrapper, createTestQueryClient } from '@/test/query-client-test-utils';
import { PrintHubContent } from './print-hub-content';

const replaceMock = vi.hoisted(() => vi.fn());
const useSearchParamsMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  usePathname: () => '/reports/print',
  useRouter: () => ({ replace: replaceMock }),
  useSearchParams: useSearchParamsMock,
}));

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

vi.mock('@/lib/patient/api-paths', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/patient/api-paths')>();
  return {
    ...actual,
    buildPatientApiPath: vi.fn(actual.buildPatientApiPath),
  };
});

setupDomTestEnv();

const REPORT_UPDATED_AT_ISO = '2026-06-18T00:05:00.000Z';

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderPrintHubContent(queryClient: QueryClient = createTestQueryClient()) {
  return {
    queryClient,
    ...render(<PrintHubContent />, { wrapper: createQueryClientWrapper(queryClient) }),
  };
}

function physicianPrintAuditContent(assessment: string, reportDate = '2026-06-18') {
  return {
    patient: { name: '山田 太郎', birth_date: '1940-01-01', gender: 'M' },
    report_date: reportDate,
    visit_date: '2026-06-18',
    pharmacist_name: '薬剤師 太郎',
    prescriber: { name: '主治医 一郎', institution: '在宅診療所' },
    prescriptions: [
      {
        drug_name: 'アムロジピン錠5mg',
        dose: '1錠',
        frequency: '1日1回朝食後',
        days: 28,
      },
    ],
    medication_management: {
      compliance_summary: '概ね良好',
      adherence_score: 4,
      self_management: '家族支援あり',
      calendar_used: true,
    },
    adverse_events: { has_events: false, events: [] },
    functional_assessment: {
      lab_values: '未確認',
      sleep: '良好',
      cognition: '変化なし',
      diet_oral: '良好',
      mobility: '杖歩行',
      excretion: '自立',
    },
    residual_medications: [],
    assessment,
    plan: '次回も残薬確認',
    physician_communication: '処方継続で問題ありません',
    warnings: [],
  };
}

function setPrintSearchParams(params: Record<string, string>) {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    searchParams.set(key, value);
  }
  useSearchParamsMock.mockReturnValue(searchParams);
}

function firstVisitDocumentsResponse(patientId: string) {
  return {
    patient: { id: patientId, name: '山田 太郎', name_kana: 'ヤマダ タロウ' },
    print_readiness: {
      overall_status: 'ready',
      missing_required_count: 0,
      warning_count: 0,
      template_versions: [],
      checks: [
        {
          key: 'patient_profile',
          label: '患者基本情報',
          completed: true,
          severity: 'required',
          description: '差し込みできます。',
          action_href: `/patients/${patientId}/edit`,
          action_label: '基本情報を編集',
        },
      ],
    },
    first_visit_documents: [
      {
        id: 'doc_1',
        case_id: 'case_1',
        document_url: '/reports/print?copy=1',
        delivered_at: '2026-06-16T00:00:00.000Z',
        delivered_to: '山田 花子',
        created_at: '2026-06-16T00:00:00.000Z',
        updated_at: '2026-06-16T00:00:00.000Z',
        emergency_contacts: [],
        history: [],
      },
    ],
  };
}

function setPlansResponse(patientId: string) {
  return {
    data: [
      {
        id: 'plan_1',
        cycle_id: 'cycle_1',
        target_period_start: '2026-06-01T00:00:00.000Z',
        target_period_end: '2026-06-28T00:00:00.000Z',
        set_method: 'calendar',
        packaging_summary_snapshot: null,
        notes: null,
        created_at: '2026-06-01T00:00:00.000Z',
        packaging_method_ref: null,
        cycle: {
          id: 'cycle_1',
          patient_id: patientId,
          case_: { patient: { id: patientId, name: '山田 太郎', name_kana: 'ヤマダ タロウ' } },
        },
        audits: [],
      },
    ],
  };
}

function prescriptionsResponse(patientId: string) {
  return {
    patient: { id: patientId, name: '山田 太郎', name_kana: 'ヤマダ タロウ' },
    data: [
      {
        id: 'intake_1',
        cycle_id: 'cycle_1',
        prescribed_date: '2026-06-01',
        prescriber_name: '主治医 一郎',
        prescriber_institution: '在宅診療所',
        lines: [
          {
            id: 'line_1',
            line_number: 1,
            drug_name: 'アムロジピン錠5mg',
            dose: '1錠',
            frequency: '1日1回朝食後',
            days: 28,
            quantity: 28,
            unit: '錠',
            notes: null,
          },
        ],
      },
    ],
  };
}

function careReportsResponse(reportId: string) {
  return {
    data: [
      {
        id: reportId,
        patient_id: 'patient_1',
        patient_name: '山田 太郎',
        report_type: 'physician_report',
        updated_at: REPORT_UPDATED_AT_ISO,
        status: 'confirmed',
        created_at: '2026-06-18T00:00:00.000Z',
        delivery_records: [],
      },
    ],
  };
}

describe('PrintHubContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSearchParamsMock.mockReturnValue(
      new URLSearchParams('type=first_visit_documents&patient_id=patient_1'),
    );
    vi.stubGlobal('print', vi.fn());
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/patients/patient_1/documents') {
          return new Response(
            JSON.stringify({
              patient: { id: 'patient_1', name: '山田 太郎', name_kana: 'ヤマダ タロウ' },
              print_readiness: {
                overall_status: 'ready',
                missing_required_count: 0,
                warning_count: 0,
                template_versions: [],
                checks: [
                  {
                    key: 'patient_profile',
                    label: '患者基本情報',
                    completed: true,
                    severity: 'required',
                    description: '差し込みできます。',
                    action_href: '/patients/patient_1/edit',
                    action_label: '基本情報を編集',
                  },
                ],
              },
              first_visit_documents: [
                {
                  id: 'doc_1',
                  case_id: 'case_1',
                  document_url: '/reports/print?copy=1',
                  delivered_at: '2026-06-16T00:00:00.000Z',
                  delivered_to: '山田 花子',
                  created_at: '2026-06-16T00:00:00.000Z',
                  updated_at: '2026-06-16T00:00:00.000Z',
                  emergency_contacts: [],
                  history: [],
                },
              ],
            }),
            { status: 200 },
          );
        }

        if (url === '/api/first-visit-documents/print-batch') {
          expect(init?.method).toBe('POST');
          return new Response(JSON.stringify({ data: { print_batch_id: 'print_batch_1' } }), {
            status: 200,
          });
        }

        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );
  });

  it('records first-visit print history only after staff confirms output completion', async () => {
    renderPrintHubContent();

    await screen.findByTestId('print-target-first_visit_documents');
    expect(screen.getAllByLabelText('控えを保存').length).toBeGreaterThan(0);
    const printButton = await screen.findByTestId('print-submit-button');

    fireEvent.click(printButton);

    expect(window.print).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalledWith(
      '/api/first-visit-documents/print-batch',
      expect.anything(),
    );
    expect((await screen.findByTestId('first-visit-print-confirm-button')).textContent).toContain(
      '印刷完了を記録',
    );

    fireEvent.click(screen.getByTestId('first-visit-print-confirm-button'));

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/first-visit-documents/print-batch',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            patient_id: 'patient_1',
            document_ids: ['doc_1'],
            save_copy: true,
          }),
        }),
      ),
    );
  });

  it('uses the first-visit print history fallback when the thrown error has an empty message', async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/patients/patient_1/documents') {
        return new Response(JSON.stringify(firstVisitDocumentsResponse('patient_1')), {
          status: 200,
        });
      }
      if (url === '/api/first-visit-documents/print-batch') {
        throw new Error('');
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    renderPrintHubContent();

    await screen.findByTestId('print-target-first_visit_documents');
    const printButton = await screen.findByTestId('print-submit-button');

    await waitFor(() => {
      expect(printButton).toHaveProperty('disabled', false);
    });
    fireEvent.click(printButton);
    fireEvent.click(await screen.findByTestId('first-visit-print-confirm-button'));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain(
        '初回文書の印刷履歴を記録できませんでした',
      );
    });
    expect(window.print).toHaveBeenCalledTimes(1);
  });

  it('encodes the first-visit document patient path while preserving the raw print body', async () => {
    const patientId = 'patient/1?x=y#z';
    const encodedPatientId = encodeURIComponent(patientId);
    setPrintSearchParams({ type: 'first_visit_documents', patient_id: patientId });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === `/api/patients/${encodedPatientId}/documents`) {
        expect(init?.headers).toEqual(buildOrgHeaders('org_1'));
        return new Response(JSON.stringify(firstVisitDocumentsResponse(patientId)), {
          status: 200,
        });
      }
      if (url === '/api/first-visit-documents/print-batch') {
        expect(init?.method).toBe('POST');
        expect(init?.headers).toEqual(buildOrgJsonHeaders('org_1'));
        expect(JSON.parse(String(init?.body))).toEqual({
          patient_id: patientId,
          document_ids: ['doc_1'],
          save_copy: true,
        });
        return new Response(JSON.stringify({ data: { print_batch_id: 'print_batch_1' } }), {
          status: 200,
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { queryClient } = renderPrintHubContent();

    await screen.findByTestId('print-target-first_visit_documents');
    expect(
      queryClient
        .getQueryCache()
        .getAll()
        .some((query) => {
          const key = query.queryKey;
          return (
            key[0] === 'print-hub-patient-documents' && key[1] === 'org_1' && key[2] === patientId
          );
        }),
    ).toBe(true);
    const calledUrls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(calledUrls).toContain(`/api/patients/${encodedPatientId}/documents`);
    expect(calledUrls).not.toContain(`/api/patients/${patientId}/documents`);
    expect(calledUrls.join('\n')).not.toContain('%25');
    expect(calledUrls.join('\n')).not.toContain('?x=y#z');

    fireEvent.click(await screen.findByTestId('print-submit-button'));
    fireEvent.click(await screen.findByTestId('first-visit-print-confirm-button'));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/first-visit-documents/print-batch',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });

  it('loads first-visit documents through the shared patient API path helper', async () => {
    setPrintSearchParams({ type: 'first_visit_documents', patient_id: 'patient_1' });
    vi.mocked(buildPatientApiPath).mockImplementationOnce(
      (patientId, suffix = '') => `/api/patients/__helper_${patientId}__${suffix}`,
    );
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/patients/__helper_patient_1__/documents') {
        expect(init?.headers).toEqual(buildOrgHeaders('org_1'));
        return new Response(JSON.stringify(firstVisitDocumentsResponse('patient_1')), {
          status: 200,
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderPrintHubContent();

    await screen.findByTestId('print-target-first_visit_documents');

    expect(buildPatientApiPath).toHaveBeenCalledWith('patient_1', '/documents');
    expect(fetchMock).toHaveBeenCalledWith('/api/patients/__helper_patient_1__/documents', {
      headers: buildOrgHeaders('org_1'),
    });
    expect(fetchMock).not.toHaveBeenCalledWith('/api/patients/patient_1/documents', {
      headers: buildOrgHeaders('org_1'),
    });
  });

  it('encodes the set-instruction prescriptions patient path while keeping the raw query key', async () => {
    const patientId = 'patient/1?x=y#z';
    const encodedPatientId = encodeURIComponent(patientId);
    setPrintSearchParams({ type: 'set_instruction' });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/set-plans') {
        expect(init?.headers).toEqual(buildOrgHeaders('org_1'));
        return new Response(JSON.stringify(setPlansResponse(patientId)), { status: 200 });
      }
      if (url === `/api/patients/${encodedPatientId}/prescriptions?limit=20`) {
        expect(init?.headers).toEqual(buildOrgHeaders('org_1'));
        return new Response(JSON.stringify(prescriptionsResponse(patientId)), { status: 200 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { queryClient } = renderPrintHubContent();

    await screen.findByTestId('print-target-set_instruction');
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/patients/${encodedPatientId}/prescriptions?limit=20`,
        { headers: buildOrgHeaders('org_1') },
      ),
    );
    expect(
      queryClient
        .getQueryCache()
        .getAll()
        .some((query) => {
          const key = query.queryKey;
          return key[0] === 'print-hub-prescriptions' && key[1] === 'org_1' && key[2] === patientId;
        }),
    ).toBe(true);
    const calledUrls = fetchMock.mock.calls.map(([input]) => String(input)).join('\n');
    expect(calledUrls).not.toContain(`/api/patients/${patientId}/prescriptions`);
    expect(calledUrls).not.toContain('%25');
  });

  it('scopes /api/set-plans to patient_id when the print hub is opened for a known patient', async () => {
    setPrintSearchParams({ type: 'set_instruction', patient_id: 'patient_1' });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/set-plans?patient_id=patient_1') {
        expect(init?.headers).toEqual(buildOrgHeaders('org_1'));
        return new Response(JSON.stringify(setPlansResponse('patient_1')), { status: 200 });
      }
      if (url === '/api/patients/patient_1/prescriptions?limit=20') {
        expect(init?.headers).toEqual(buildOrgHeaders('org_1'));
        return new Response(JSON.stringify(prescriptionsResponse('patient_1')), { status: 200 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderPrintHubContent();

    await screen.findByTestId('print-target-set_instruction');
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/set-plans?patient_id=patient_1', {
        headers: buildOrgHeaders('org_1'),
      }),
    );
    // 絞り込みパラメータを付与しても pickPrintSetPlan の選択結果(唯一の候補)は不変。
    expect(fetchMock).not.toHaveBeenCalledWith('/api/set-plans', {
      headers: buildOrgHeaders('org_1'),
    });
  });

  it('does not scope /api/set-plans when no patient is known (org-wide sidebar entry)', async () => {
    setPrintSearchParams({ type: 'set_instruction' });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/set-plans') {
        expect(init?.headers).toEqual(buildOrgHeaders('org_1'));
        return new Response(JSON.stringify(setPlansResponse('patient_1')), { status: 200 });
      }
      if (url === '/api/patients/patient_1/prescriptions?limit=20') {
        return new Response(JSON.stringify(prescriptionsResponse('patient_1')), { status: 200 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderPrintHubContent();

    await screen.findByTestId('print-target-set_instruction');
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/set-plans', {
        headers: buildOrgHeaders('org_1'),
      }),
    );
  });

  it('loads prescriptions through the shared patient API path helper', async () => {
    setPrintSearchParams({ type: 'set_instruction' });
    vi.mocked(buildPatientApiPath).mockImplementationOnce(
      (patientId, suffix = '') => `/api/patients/__helper_${patientId}__${suffix}`,
    );
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/set-plans') {
        expect(init?.headers).toEqual(buildOrgHeaders('org_1'));
        return new Response(JSON.stringify(setPlansResponse('patient_1')), { status: 200 });
      }
      if (url === '/api/patients/__helper_patient_1__/prescriptions?limit=20') {
        expect(init?.headers).toEqual(buildOrgHeaders('org_1'));
        return new Response(JSON.stringify(prescriptionsResponse('patient_1')), { status: 200 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderPrintHubContent();

    await screen.findByTestId('print-target-set_instruction');
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/patients/__helper_patient_1__/prescriptions?limit=20',
        { headers: buildOrgHeaders('org_1') },
      ),
    );

    expect(buildPatientApiPath).toHaveBeenCalledWith('patient_1', '/prescriptions');
    expect(fetchMock).not.toHaveBeenCalledWith('/api/patients/patient_1/prescriptions?limit=20', {
      headers: buildOrgHeaders('org_1'),
    });
  });

  it('encodes visit-report print-audit paths for preview and print-requested writes', async () => {
    const reportId = 'report/1?x=y#z';
    const encodedReportId = encodeURIComponent(reportId);
    setPrintSearchParams({ type: 'visit_report' });
    const seenIntents: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/care-reports?limit=50&status=confirmed') {
        expect(init?.headers).toEqual(buildOrgHeaders('org_1'));
        return new Response(JSON.stringify(careReportsResponse(reportId)), { status: 200 });
      }
      if (url === `/api/care-reports/${encodedReportId}/print-audit`) {
        expect(init?.method).toBe('POST');
        expect(init?.headers).toEqual(buildOrgJsonHeaders('org_1'));
        const body = JSON.parse(String(init?.body ?? '{}')) as { intent?: string };
        seenIntents.push(body.intent ?? '');
        return new Response(
          JSON.stringify({
            data: {
              audited: true,
              report: {
                id: reportId,
                report_type: 'physician_report',
                updated_at: REPORT_UPDATED_AT_ISO,
                content: physicianPrintAuditContent('訪問報告書の監査済み本文'),
              },
            },
          }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { queryClient } = renderPrintHubContent();

    expect(await screen.findByText('訪問報告書の監査済み本文')).toBeTruthy();
    expect(
      queryClient
        .getQueryCache()
        .getAll()
        .some((query) => {
          const key = query.queryKey;
          return (
            key[0] === 'print-hub-care-report-print-audit' &&
            key[1] === 'org_1' &&
            key[2] === reportId
          );
        }),
    ).toBe(true);

    fireEvent.click(await screen.findByTestId('print-submit-button'));

    await waitFor(() => expect(seenIntents).toEqual(['preview_rendered', 'print_requested']));
    expect(window.print).toHaveBeenCalledTimes(1);
    const calledUrls = fetchMock.mock.calls.map(([input]) => String(input)).join('\n');
    expect(calledUrls).toContain(`/api/care-reports/${encodedReportId}/print-audit`);
    expect(calledUrls).not.toContain(`/api/care-reports/${reportId}/print-audit`);
    expect(calledUrls).not.toContain('%25');
  });

  it.each(['.', '..'])(
    'rejects dot-segment patient document ids before first-visit fetch: %s',
    async (patientId) => {
      setPrintSearchParams({ type: 'first_visit_documents', patient_id: patientId });
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      renderPrintHubContent();

      expect(
        await screen.findByText('帳票データの読み込みに失敗しました。再読み込みしてください。'),
      ).toBeTruthy();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each(['.', '..'])(
    'rejects dot-segment visit report ids before print-audit fetch: %s',
    async (reportId) => {
      setPrintSearchParams({ type: 'visit_report' });
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/care-reports?limit=50&status=confirmed') {
          expect(init?.headers).toEqual(buildOrgHeaders('org_1'));
          return new Response(JSON.stringify(careReportsResponse(reportId)), { status: 200 });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      });
      vi.stubGlobal('fetch', fetchMock);

      renderPrintHubContent();

      expect(
        await screen.findByText('帳票データの読み込みに失敗しました。再読み込みしてください。'),
      ).toBeTruthy();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith('/api/care-reports?limit=50&status=confirmed', {
        headers: buildOrgHeaders('org_1'),
      });
    },
  );

  it('describes blocked first-visit printing without leaking patient values', async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/patients/patient_1/documents') {
        return new Response(
          JSON.stringify({
            patient: { id: 'patient_1', name: '山田 太郎', name_kana: 'ヤマダ タロウ' },
            print_readiness: {
              overall_status: 'ready',
              missing_required_count: 0,
              warning_count: 0,
              template_versions: [],
              checks: [],
            },
            first_visit_documents: [],
          }),
          { status: 200 },
        );
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    renderPrintHubContent();

    const printReason = await screen.findByText(
      '印刷対象の契約・同意文書がありません。患者詳細で文書を作成してから印刷してください。',
    );
    const printButton = screen.getByTestId('print-submit-button');

    expect(printButton).toHaveProperty('disabled', true);
    expect(printButton.getAttribute('aria-describedby')).toBe(printReason.id);
    expect(printReason.textContent).not.toMatch(/patient_1|山田|太郎|doc_/);

    fireEvent.click(printButton);

    expect(window.print).not.toHaveBeenCalled();
  });

  it('hides save-copy controls for print types without persisted copy support', async () => {
    useSearchParamsMock.mockReturnValue(new URLSearchParams('type=visit_report'));
    vi.mocked(fetch).mockImplementationOnce(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('/api/care-reports?limit=50&status=confirmed');
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });

    renderPrintHubContent();

    await screen.findByTestId('print-target-visit_report');

    expect(screen.queryAllByLabelText('控えを保存')).toHaveLength(0);
    expect(screen.queryByText(/患者文書にこの印刷プレビューの控えリンクを保存/)).toBeNull();
  });

  it('loads visit report preview content through the print audit endpoint', async () => {
    useSearchParamsMock.mockReturnValue(new URLSearchParams('type=visit_report'));
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/care-reports?limit=50&status=confirmed') {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 'report_1',
                patient_id: 'patient_1',
                patient_name: '山田 太郎',
                report_type: 'physician_report',
                updated_at: REPORT_UPDATED_AT_ISO,
                status: 'confirmed',
                created_at: '2026-06-18T00:00:00.000Z',
                delivery_records: [],
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url === '/api/care-reports/report_1/print-audit') {
        expect(init?.method).toBe('POST');
        return new Response(
          JSON.stringify({
            data: {
              audited: true,
              report: {
                id: 'report_1',
                report_type: 'physician_report',
                updated_at: REPORT_UPDATED_AT_ISO,
                content: physicianPrintAuditContent('訪問報告書の監査済み本文'),
              },
            },
          }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    renderPrintHubContent();

    await screen.findByText('訪問報告書の監査済み本文');
    expect(fetch).toHaveBeenCalledWith('/api/care-reports/report_1/print-audit', {
      method: 'POST',
      headers: buildOrgJsonHeaders('org_1'),
      body: JSON.stringify({ intent: 'preview_rendered' }),
    });
    expect(fetch).not.toHaveBeenCalledWith(
      '/api/care-reports?limit=50&include_content=1',
      expect.anything(),
    );

    fireEvent.click(await screen.findByTestId('print-submit-button'));

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith('/api/care-reports/report_1/print-audit', {
        method: 'POST',
        headers: buildOrgJsonHeaders('org_1'),
        body: JSON.stringify({
          intent: 'print_requested',
          expected_report_updated_at: REPORT_UPDATED_AT_ISO,
        }),
      }),
    );
    expect(window.print).toHaveBeenCalledTimes(1);
  });

  it('does not show or print a visit report when the preview audit response is for another report', async () => {
    useSearchParamsMock.mockReturnValue(new URLSearchParams('type=visit_report'));
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/care-reports?limit=50&status=confirmed') {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 'report_1',
                patient_id: 'patient_1',
                patient_name: '山田 太郎',
                report_type: 'physician_report',
                updated_at: REPORT_UPDATED_AT_ISO,
                status: 'confirmed',
                created_at: '2026-06-18T00:00:00.000Z',
                delivery_records: [],
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url === '/api/care-reports/report_1/print-audit') {
        expect(init?.method).toBe('POST');
        return new Response(
          JSON.stringify({
            data: {
              audited: true,
              report: {
                id: 'report_other',
                report_type: 'physician_report',
                updated_at: REPORT_UPDATED_AT_ISO,
                content: physicianPrintAuditContent('別報告書として返された監査本文'),
              },
            },
          }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    renderPrintHubContent();

    expect(
      await screen.findByText('帳票データの読み込みに失敗しました。再読み込みしてください。'),
    ).toBeTruthy();
    expect(screen.queryByText('別報告書として返された監査本文')).toBeNull();
    expect(screen.getByTestId('print-submit-button')).toHaveProperty('disabled', true);

    fireEvent.click(screen.getByTestId('print-submit-button'));

    expect(window.print).not.toHaveBeenCalled();
  });

  it('does not show cached visit report content before the current preview audit resolves', async () => {
    useSearchParamsMock.mockReturnValue(new URLSearchParams('type=visit_report'));
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(['print-hub-care-report-print-audit', 'org_1', 'report_1'], {
      data: {
        audited: true,
        report: {
          id: 'report_1',
          report_type: 'physician_report',
          updated_at: REPORT_UPDATED_AT_ISO,
          content: physicianPrintAuditContent('キャッシュ済みの古い監査本文', '2026-06-17'),
        },
      },
    });
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/care-reports?limit=50&status=confirmed') {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 'report_1',
                patient_id: 'patient_1',
                patient_name: '山田 太郎',
                report_type: 'physician_report',
                updated_at: REPORT_UPDATED_AT_ISO,
                status: 'confirmed',
                created_at: '2026-06-18T00:00:00.000Z',
                delivery_records: [],
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url === '/api/care-reports/report_1/print-audit') {
        return new Promise<Response>(() => {});
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    renderPrintHubContent(queryClient);

    expect(
      await screen.findByText(
        '帳票の明細を確認しています。完了するとこのプレビューに反映されます。',
      ),
    ).toBeTruthy();
    expect(screen.queryByText('キャッシュ済みの古い監査本文')).toBeNull();
    expect(await screen.findByTestId('print-submit-button')).toHaveProperty('disabled', true);

    fireEvent.click(screen.getByTestId('print-submit-button'));

    expect(window.print).not.toHaveBeenCalled();
  });

  it('does not show cached visit report content when the current preview audit fails', async () => {
    useSearchParamsMock.mockReturnValue(new URLSearchParams('type=visit_report'));
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(['print-hub-care-report-print-audit', 'org_1', 'report_1'], {
      data: {
        audited: true,
        report: {
          id: 'report_1',
          report_type: 'physician_report',
          updated_at: REPORT_UPDATED_AT_ISO,
          content: physicianPrintAuditContent('キャッシュ済みの失敗時本文', '2026-06-17'),
        },
      },
    });
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/care-reports?limit=50&status=confirmed') {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 'report_1',
                patient_id: 'patient_1',
                patient_name: '山田 太郎',
                report_type: 'physician_report',
                updated_at: REPORT_UPDATED_AT_ISO,
                status: 'confirmed',
                created_at: '2026-06-18T00:00:00.000Z',
                delivery_records: [],
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url === '/api/care-reports/report_1/print-audit') {
        return new Response(JSON.stringify({ error: 'audit failed' }), { status: 500 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    renderPrintHubContent(queryClient);

    expect(
      await screen.findByText('帳票データの読み込みに失敗しました。再読み込みしてください。'),
    ).toBeTruthy();
    expect(screen.queryByText('キャッシュ済みの失敗時本文')).toBeNull();
    expect(screen.getByTestId('print-submit-button')).toHaveProperty('disabled', true);

    fireEvent.click(screen.getByTestId('print-submit-button'));

    expect(window.print).not.toHaveBeenCalled();
  });

  it('uses only the current preview audit success for visit report content', async () => {
    useSearchParamsMock.mockReturnValue(new URLSearchParams('type=visit_report'));
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(['print-hub-care-report-print-audit', 'org_1', 'report_1'], {
      data: {
        audited: true,
        report: {
          id: 'report_1',
          report_type: 'physician_report',
          updated_at: REPORT_UPDATED_AT_ISO,
          content: physicianPrintAuditContent('キャッシュ済みの旧本文', '2026-06-17'),
        },
      },
    });
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/care-reports?limit=50&status=confirmed') {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 'report_1',
                patient_id: 'patient_1',
                patient_name: '山田 太郎',
                report_type: 'physician_report',
                updated_at: REPORT_UPDATED_AT_ISO,
                status: 'confirmed',
                created_at: '2026-06-18T00:00:00.000Z',
                delivery_records: [],
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url === '/api/care-reports/report_1/print-audit') {
        expect(init?.method).toBe('POST');
        return new Response(
          JSON.stringify({
            data: {
              audited: true,
              report: {
                id: 'report_1',
                report_type: 'physician_report',
                updated_at: REPORT_UPDATED_AT_ISO,
                content: physicianPrintAuditContent('現在の監査済み本文'),
              },
            },
          }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    renderPrintHubContent(queryClient);

    expect(await screen.findByText('現在の監査済み本文')).toBeTruthy();
    expect(screen.queryByText('キャッシュ済みの旧本文')).toBeNull();
  });

  it('does not print a visit report when the print-requested audit response is not audited', async () => {
    useSearchParamsMock.mockReturnValue(new URLSearchParams('type=visit_report'));
    let printRequested = false;
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/care-reports?limit=50&status=confirmed') {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 'report_1',
                patient_id: 'patient_1',
                patient_name: '山田 太郎',
                report_type: 'physician_report',
                updated_at: REPORT_UPDATED_AT_ISO,
                status: 'confirmed',
                created_at: '2026-06-18T00:00:00.000Z',
                delivery_records: [],
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url === '/api/care-reports/report_1/print-audit') {
        expect(init?.method).toBe('POST');
        const body = JSON.parse(String(init?.body ?? '{}')) as { intent?: string };
        if (body.intent === 'print_requested') {
          printRequested = true;
          return new Response(
            JSON.stringify({
              data: {
                audited: false,
                report: {
                  id: 'report_1',
                  report_type: 'physician_report',
                  updated_at: REPORT_UPDATED_AT_ISO,
                  content: physicianPrintAuditContent('印刷前に表示済みの監査本文'),
                },
              },
            }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            data: {
              audited: true,
              report: {
                id: 'report_1',
                report_type: 'physician_report',
                updated_at: REPORT_UPDATED_AT_ISO,
                content: physicianPrintAuditContent('印刷前に表示済みの監査本文'),
              },
            },
          }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    renderPrintHubContent();

    expect(await screen.findByText('印刷前に表示済みの監査本文')).toBeTruthy();

    fireEvent.click(await screen.findByTestId('print-submit-button'));

    await waitFor(() => expect(printRequested).toBe(true));
    expect((await screen.findByRole('alert')).textContent).toContain(
      '報告書の印刷監査を記録できませんでした。再読み込みしてください。',
    );
    expect(window.print).not.toHaveBeenCalled();
  });

  it('does not print a visit report when the print-requested audit success response is malformed', async () => {
    useSearchParamsMock.mockReturnValue(new URLSearchParams('type=visit_report'));
    let printRequested = false;
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/care-reports?limit=50&status=confirmed') {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 'report_1',
                patient_id: 'patient_1',
                patient_name: '山田 太郎',
                report_type: 'physician_report',
                updated_at: REPORT_UPDATED_AT_ISO,
                status: 'confirmed',
                created_at: '2026-06-18T00:00:00.000Z',
                delivery_records: [],
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url === '/api/care-reports/report_1/print-audit') {
        expect(init?.method).toBe('POST');
        const body = JSON.parse(String(init?.body ?? '{}')) as { intent?: string };
        if (body.intent === 'print_requested') {
          printRequested = true;
          return new Response(JSON.stringify({ data: { audited: true } }), { status: 200 });
        }
        return new Response(
          JSON.stringify({
            data: {
              audited: true,
              report: {
                id: 'report_1',
                report_type: 'physician_report',
                updated_at: REPORT_UPDATED_AT_ISO,
                content: physicianPrintAuditContent('印刷前に表示済みの監査本文'),
              },
            },
          }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    renderPrintHubContent();

    expect(await screen.findByText('印刷前に表示済みの監査本文')).toBeTruthy();

    fireEvent.click(await screen.findByTestId('print-submit-button'));

    await waitFor(() => expect(printRequested).toBe(true));
    expect((await screen.findByRole('alert')).textContent).toContain(
      '報告書の印刷監査を記録できませんでした。再読み込みしてください。',
    );
    expect(window.print).not.toHaveBeenCalled();
  });

  it('does not print a visit report when the print-requested audit response is for another report', async () => {
    useSearchParamsMock.mockReturnValue(new URLSearchParams('type=visit_report'));
    let printRequested = false;
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/care-reports?limit=50&status=confirmed') {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 'report_1',
                patient_id: 'patient_1',
                patient_name: '山田 太郎',
                report_type: 'physician_report',
                updated_at: REPORT_UPDATED_AT_ISO,
                status: 'confirmed',
                created_at: '2026-06-18T00:00:00.000Z',
                delivery_records: [],
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url === '/api/care-reports/report_1/print-audit') {
        expect(init?.method).toBe('POST');
        const body = JSON.parse(String(init?.body ?? '{}')) as { intent?: string };
        if (body.intent === 'print_requested') {
          printRequested = true;
          return new Response(
            JSON.stringify({
              data: {
                audited: true,
                report: {
                  id: 'report_other',
                  report_type: 'physician_report',
                  updated_at: REPORT_UPDATED_AT_ISO,
                  content: physicianPrintAuditContent('別報告書として返された監査本文'),
                },
              },
            }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            data: {
              audited: true,
              report: {
                id: 'report_1',
                report_type: 'physician_report',
                updated_at: REPORT_UPDATED_AT_ISO,
                content: physicianPrintAuditContent('印刷前に表示済みの監査本文'),
              },
            },
          }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    renderPrintHubContent();

    expect(await screen.findByText('印刷前に表示済みの監査本文')).toBeTruthy();

    fireEvent.click(await screen.findByTestId('print-submit-button'));

    await waitFor(() => expect(printRequested).toBe(true));
    expect((await screen.findByRole('alert')).textContent).toContain(
      '報告書の印刷監査を記録できませんでした。再読み込みしてください。',
    );
    expect(window.print).not.toHaveBeenCalled();
  });

  it('does not print a visit report when the report changed after preview audit', async () => {
    useSearchParamsMock.mockReturnValue(new URLSearchParams('type=visit_report'));
    let printRequestedBody: { intent?: string; expected_report_updated_at?: string } | null = null;
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/care-reports?limit=50&status=confirmed') {
        return new Response(JSON.stringify(careReportsResponse('report_1')), { status: 200 });
      }
      if (url === '/api/care-reports/report_1/print-audit') {
        expect(init?.method).toBe('POST');
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          intent?: string;
          expected_report_updated_at?: string;
        };
        if (body.intent === 'print_requested') {
          printRequestedBody = body;
          return new Response(
            JSON.stringify({
              data: {
                audited: true,
                report: {
                  id: 'report_1',
                  report_type: 'physician_report',
                  updated_at: '2026-06-18T00:06:00.000Z',
                  content: physicianPrintAuditContent('更新後の監査本文'),
                },
              },
            }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            data: {
              audited: true,
              report: {
                id: 'report_1',
                report_type: 'physician_report',
                updated_at: REPORT_UPDATED_AT_ISO,
                content: physicianPrintAuditContent('印刷前に表示済みの監査本文'),
              },
            },
          }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    renderPrintHubContent();

    expect(await screen.findByText('印刷前に表示済みの監査本文')).toBeTruthy();

    fireEvent.click(await screen.findByTestId('print-submit-button'));

    await waitFor(() =>
      expect(printRequestedBody).toEqual({
        intent: 'print_requested',
        expected_report_updated_at: REPORT_UPDATED_AT_ISO,
      }),
    );
    expect((await screen.findByRole('alert')).textContent).toContain(
      '報告書の印刷監査を記録できませんでした。再読み込みしてください。',
    );
    expect(window.print).not.toHaveBeenCalled();
  });
});
