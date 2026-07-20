// @vitest-environment jsdom

import type { QueryClient } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildOrgJsonHeaders } from '@/lib/api/org-headers';
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

setupDomTestEnv();

const REPORT_UPDATED_AT = '2026-06-18T00:05:00.000Z';

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status });
}

function setSearch(query: string) {
  useSearchParamsMock.mockReturnValue(new URLSearchParams(query));
}

function renderPrintHub(queryClient: QueryClient = createTestQueryClient()) {
  return {
    queryClient,
    ...render(<PrintHubContent />, { wrapper: createQueryClientWrapper(queryClient) }),
  };
}

function patientHeaderResponse(
  patientId = 'patient_1',
  name = '山田 太郎',
  birthDate = '1940-01-01',
) {
  return {
    data: {
      patient_id: patientId,
      name,
      name_kana: 'ヤマダ タロウ',
      birth_date: birthDate,
      gender: 'male',
      gender_label: '男性',
      care_level: null,
      care_level_label: null,
      home_status_label: null,
      residence_label: null,
      primary_diagnosis: null,
      intervention_start_date: null,
      primary_pharmacist_name: null,
      backup_pharmacist_name: null,
      primary_staff_name: null,
      backup_staff_name: null,
      first_visit_date: null,
      last_prescribed_date: null,
      next_prescription_expected_date: null,
      safety: {
        allergy: null,
        renal: null,
        handling_tags: [],
        swallowing: null,
        cautions: [],
        safety_tags: [],
        visible_safety_tags: [],
        hidden_safety_tag_count: 0,
      },
    },
  };
}

function readyPrintReadiness() {
  return {
    overall_status: 'ready' as const,
    missing_required_count: 0,
    warning_count: 0,
    template_versions: [],
    checks: [
      {
        key: 'patient_profile',
        label: '患者基本情報',
        completed: true,
        severity: 'required' as const,
        description: '差し込みできます。',
        action_href: '/patients/patient_1/edit',
        action_label: '基本情報を編集',
      },
    ],
  };
}

function firstVisitDocument(id = 'doc_1') {
  return {
    id,
    case_id: 'case_1',
    document_url: '/api/files/document_1',
    delivered_at: '2026-06-16T00:00:00.000Z',
    delivered_to: '山田 花子',
    created_at: '2026-06-16T00:00:00.000Z',
    updated_at: '2026-06-16T00:00:00.000Z',
    emergency_contacts: [],
    history: [],
  };
}

function firstVisitDocumentsResponse(
  args: {
    patientId?: string;
    patientName?: string;
    documents?: ReturnType<typeof firstVisitDocument>[];
    readiness?: ReturnType<typeof readyPrintReadiness> | ReturnType<typeof blockedPrintReadiness>;
  } = {},
) {
  const patientId = args.patientId ?? 'patient_1';
  return {
    data: {
      patient: {
        id: patientId,
        name: args.patientName ?? '山田 太郎',
        name_kana: 'ヤマダ タロウ',
      },
      print_readiness: args.readiness ?? readyPrintReadiness(),
      first_visit_documents: args.documents ?? [firstVisitDocument()],
    },
  };
}

function blockedPrintReadiness() {
  return {
    overall_status: 'blocked' as const,
    missing_required_count: 1,
    warning_count: 0,
    template_versions: [],
    checks: [
      {
        key: 'patient_profile',
        label: '患者基本情報',
        completed: false,
        severity: 'required' as const,
        description: '生年月日を確認してください。',
        action_href: '/patients/patient_1/edit',
        action_label: '基本情報を編集',
      },
    ],
  };
}

function setPlanResponse(patientId = 'patient_1', planId = 'plan_1') {
  return {
    data: {
      id: planId,
      cycle_id: 'cycle_1',
      target_period_start: '2026-06-01T00:00:00.000Z',
      target_period_end: '2026-06-28T00:00:00.000Z',
      set_method: 'calendar',
      packaging_summary_snapshot: null,
      notes: null,
      created_at: '2026-06-01T00:00:00.000Z',
      updated_at: '2026-06-01T01:00:00.000Z',
      packaging_method_ref: null,
      cycle: {
        id: 'cycle_1',
        patient_id: patientId,
        case_: {
          patient: { id: patientId, name: '山田 太郎', name_kana: 'ヤマダ タロウ' },
        },
      },
      audits: [],
    },
  };
}

function prescriptionIntake(cycleId = 'cycle_1', id = 'intake_1') {
  return {
    id,
    cycle_id: cycleId,
    prescribed_date: '2026-06-01',
    updated_at: '2026-06-01T01:30:00.000Z',
    prescriber_name: '主治医 一郎',
    prescriber_institution: '在宅診療所',
    lines: [
      {
        id: `line_${id}`,
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
  };
}

function prescriptionsResponse(
  args: {
    patientId?: string;
    intakes?: ReturnType<typeof prescriptionIntake>[];
    hasMore?: boolean;
    nextCursor?: string | null;
  } = {},
) {
  const patientId = args.patientId ?? 'patient_1';
  return {
    data: {
      patient: { id: patientId, name: '山田 太郎', name_kana: 'ヤマダ タロウ' },
      data: args.intakes ?? [prescriptionIntake()],
      hasMore: args.hasMore ?? false,
      nextCursor: args.nextCursor ?? null,
    },
  };
}

function physicianContent(assessment = '監査済み本文') {
  return {
    patient: { name: '山田 太郎', birth_date: '1940-01-01', gender: 'M' },
    report_date: '2026-06-18',
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

function careReportDetailResponse(
  args: {
    reportId?: string;
    patientId?: string;
    patientName?: string;
    birthDate?: string;
    updatedAt?: string;
    deliveryRecords?: Array<{
      id: string;
      channel: string;
      recipient_name: string;
      recipient_contact: string | null;
      status: string;
      sent_at: string | null;
      created_at: string;
    }>;
  } = {},
) {
  const reportId = args.reportId ?? 'report_1';
  const patientId = args.patientId ?? 'patient_1';
  return {
    data: {
      id: reportId,
      patient_id: patientId,
      case_id: 'case_1',
      visit_record_id: null,
      report_type: 'physician_report',
      status: 'confirmed',
      content: physicianContent('詳細API本文'),
      template_id: null,
      pdf_url: null,
      created_by: 'user_1',
      created_at: '2026-06-18T00:00:00.000Z',
      updated_at: args.updatedAt ?? REPORT_UPDATED_AT,
      delivery_records: args.deliveryRecords ?? [],
      patient_summary: {
        id: patientId,
        name: args.patientName ?? '山田 太郎',
        name_kana: 'ヤマダ タロウ',
        birth_date: args.birthDate ?? '1940-01-01',
        archive: { status: 'active', archived: false, archived_at: null },
      },
      visit_summary: null,
      intake_baseline_context: null,
      permissions: {
        can_edit: false,
        can_send: true,
        can_create_external_share: false,
        can_create_followup_task: false,
        can_view_patient: true,
        can_view_related_requests: false,
      },
      delivery_rule_suggestion: null,
      external_professional_suggestions: [],
      prescriber_institution_suggestion: null,
    },
  };
}

function printAuditResponse(
  args: {
    reportId?: string;
    updatedAt?: string;
    audited?: boolean;
    assessment?: string;
  } = {},
) {
  return {
    data: {
      audited: args.audited ?? true,
      report: {
        id: args.reportId ?? 'report_1',
        report_type: 'physician_report',
        updated_at: args.updatedAt ?? REPORT_UPDATED_AT,
        content: physicianContent(args.assessment),
      },
    },
  };
}

function requestIntent(init?: RequestInit) {
  return (JSON.parse(String(init?.body ?? '{}')) as { intent?: string }).intent;
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

function installFirstVisitFetch(
  args: {
    documentId?: string;
    documents?: ReturnType<typeof firstVisitDocument>[];
    readiness?: ReturnType<typeof readyPrintReadiness> | ReturnType<typeof blockedPrintReadiness>;
    oldPatientName?: string;
    printBatchStatus?: number;
    printBatchReason?: string | null;
  } = {},
) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/patients/patient_1/header-summary') {
      return json(patientHeaderResponse());
    }
    if (url === '/api/patients/patient_1/documents') {
      return json(
        firstVisitDocumentsResponse({
          documents: args.documents ?? [firstVisitDocument(args.documentId)],
          readiness: args.readiness,
          patientName: args.oldPatientName,
        }),
      );
    }
    if (url === '/api/first-visit-documents/print-batch') {
      expect(init?.method).toBe('POST');
      return args.printBatchStatus === 409
        ? json(
            {
              message: '初回文書が更新されています',
              ...(args.printBatchReason === null
                ? {}
                : {
                    details: {
                      reason: args.printBatchReason ?? 'first_visit_document_version_conflict',
                    },
                  }),
            },
            409,
          )
        : json({ data: { print_batch_id: 'print_batch_1' } });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function openPrintConfirmation(patientName = '山田 太郎') {
  fireEvent.click(await screen.findByTestId('print-submit-button'));
  const dialog = await screen.findByRole('alertdialog', { name: '印刷対象を確認' });
  const input = within(dialog).getByPlaceholderText(patientName);
  const confirm = within(dialog).getByRole('button', { name: 'この対象を印刷' });
  return { dialog, input, confirm };
}

describe('PrintHubContent explicit print target boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSearch('type=first_visit_documents&patient_id=patient_1&document_id=doc_1');
    vi.stubGlobal('print', vi.fn());
    installFirstVisitFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ['sidebar entry', ''],
    ['missing resource', 'type=set_instruction&patient_id=patient_1'],
    ['missing patient', 'type=set_instruction&set_plan_id=plan_1'],
    [
      'duplicate patient',
      'type=set_instruction&patient_id=patient_1&patient_id=patient_2&set_plan_id=plan_1',
    ],
    [
      'incompatible selector',
      'type=set_instruction&patient_id=patient_1&set_plan_id=plan_1&report_id=report_1',
    ],
  ])('performs zero PHI reads and zero print side effects for %s', async (_label, query) => {
    setSearch(query);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    renderPrintHub();

    expect((await screen.findAllByText(/開き直してください/)).length).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('print-submit-button')).toHaveProperty('disabled', true);
    expect(window.print).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain('patient_1');
  });

  it('preserves the patient while clearing every resource selector on type switch', async () => {
    renderPrintHub();

    fireEvent.click(await screen.findByTestId('print-target-visit_report'));

    expect(replaceMock).toHaveBeenCalledWith(
      '/reports/print?type=visit_report&patient_id=patient_1',
      { scroll: false },
    );
  });

  it('requires identity confirmation, prints one exact first-visit document, then records it', async () => {
    const fetchMock = installFirstVisitFetch();
    renderPrintHub();

    expect((await screen.findAllByText('山田 太郎 様')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('1940年1月1日')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText(/doc_1/)).length).toBeGreaterThan(0);
    expect(screen.queryByText('患者名を表示')).toBeNull();

    const { input, confirm } = await openPrintConfirmation();
    expect(window.print).not.toHaveBeenCalled();
    expect(confirm).toHaveProperty('disabled', true);
    fireEvent.change(input, { target: { value: '山田 太郎' } });
    expect(confirm).toHaveProperty('disabled', false);
    fireEvent.click(confirm);
    expect(window.print).toHaveBeenCalledTimes(1);

    fireEvent.click(await screen.findByTestId('first-visit-print-confirm-button'));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/first-visit-documents/print-batch', {
        method: 'POST',
        headers: buildOrgJsonHeaders('org_1'),
        body: JSON.stringify({
          patient_id: 'patient_1',
          documents: [{ id: 'doc_1', expected_updated_at: '2026-06-16T00:00:00.000Z' }],
          save_copy: true,
        }),
      }),
    );
  });

  it('discards confirmation and requires reprint when history detects a stale printed version', async () => {
    installFirstVisitFetch({ printBatchStatus: 409 });
    renderPrintHub();

    expect((await screen.findAllByText('山田 太郎 様')).length).toBeGreaterThan(0);
    const { input, confirm } = await openPrintConfirmation();
    fireEvent.change(input, { target: { value: '山田 太郎' } });
    fireEvent.click(confirm);
    expect(window.print).toHaveBeenCalledTimes(1);

    fireEvent.click(await screen.findByTestId('first-visit-print-confirm-button'));

    expect(
      await screen.findByText(
        '印刷後に文書の更新が検出されました。今印刷した帳票は使用せず破棄し、最新データを再読み込みして再印刷してください。',
      ),
    ).toBeTruthy();
    expect(screen.queryByTestId('first-visit-print-confirm-button')).toBeNull();
  });

  it('keeps non-version 409 guidance distinct from stale-output recovery', async () => {
    installFirstVisitFetch({ printBatchStatus: 409, printBatchReason: null });
    renderPrintHub();

    expect((await screen.findAllByText('山田 太郎 様')).length).toBeGreaterThan(0);
    const { input, confirm } = await openPrintConfirmation();
    fireEvent.change(input, { target: { value: '山田 太郎' } });
    fireEvent.click(confirm);
    fireEvent.click(await screen.findByTestId('first-visit-print-confirm-button'));

    expect(
      await screen.findByText(
        '初回文書の印刷履歴を記録できませんでした。患者状態と印刷前チェックを確認してください。',
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/今印刷した帳票は使用せず破棄/)).toBeNull();
    expect(screen.getByTestId('first-visit-print-confirm-button')).toBeTruthy();
  });

  it('fails closed when the patient-scoped document response lacks the exact document', async () => {
    setSearch('type=first_visit_documents&patient_id=patient_1&document_id=doc_missing');
    const fetchMock = installFirstVisitFetch({ documents: [firstVisitDocument('doc_other')] });

    renderPrintHub();

    expect(
      (
        await screen.findAllByText(
          '指定した患者文書が見つかりません。患者文書画面から開き直してください。',
        )
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.getByTestId('print-submit-button')).toHaveProperty('disabled', true);
    expect(window.print).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.map(([input]) => String(input))).not.toContain(
      '/api/first-visit-documents/print-batch',
    );
  });

  it('blocks first-visit printing when the patient readiness contract is blocked', async () => {
    installFirstVisitFetch({ readiness: blockedPrintReadiness() });
    renderPrintHub();

    expect(
      (await screen.findAllByText('印刷前チェックで必須項目が未完了です。不足: 患者基本情報'))
        .length,
    ).toBeGreaterThan(0);
    const reason = document.getElementById('print-submit-disabled-reason');
    expect(reason).not.toBeNull();
    const button = screen.getByTestId('print-submit-button');
    expect(button).toHaveProperty('disabled', true);
    expect(button.getAttribute('aria-describedby')).toBe(reason?.id);
    expect(window.print).not.toHaveBeenCalled();
  });

  it('does not project a cached target from another patient or resource', async () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(['print-hub-patient-header', 'org_1', 'patient_old'], {
      data: patientHeaderResponse('patient_old', '別患者 花子').data,
    });
    queryClient.setQueryData(
      ['print-hub-patient-documents', 'org_1', 'patient_old', 'doc_old'],
      firstVisitDocumentsResponse({
        patientId: 'patient_old',
        patientName: '別患者 花子',
        documents: [firstVisitDocument('doc_old')],
      }).data,
    );

    renderPrintHub(queryClient);

    expect((await screen.findAllByText('山田 太郎 様')).length).toBeGreaterThan(0);
    expect(screen.queryByText(/別患者 花子/)).toBeNull();
    expect(screen.queryByText('doc_old')).toBeNull();
  });

  it('loads an exact set plan, paginates only until its exact cycle, and never lists plans', async () => {
    setSearch('type=set_instruction&patient_id=patient_1&set_plan_id=plan_1');
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/patients/patient_1/header-summary') {
        return json(patientHeaderResponse());
      }
      if (url === '/api/set-plans/plan_1') return json(setPlanResponse());
      if (url === '/api/patients/patient_1/prescriptions?limit=20') {
        return json(
          prescriptionsResponse({
            intakes: [prescriptionIntake('cycle_other', 'intake_other')],
            hasMore: true,
            nextCursor: 'cursor_1',
          }),
        );
      }
      if (url === '/api/patients/patient_1/prescriptions?limit=20&cursor=cursor_1') {
        return json(prescriptionsResponse({ intakes: [prescriptionIntake()] }));
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderPrintHub();

    expect(await screen.findByText('アムロジピン錠5mg')).toBeTruthy();
    expect((await screen.findAllByText(/plan_1/)).length).toBeGreaterThan(0);
    const urls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(urls).toContain('/api/set-plans/plan_1');
    expect(urls).toContain('/api/patients/patient_1/prescriptions?limit=20&cursor=cursor_1');
    expect(urls.some((url) => url === '/api/set-plans' || url.startsWith('/api/set-plans?'))).toBe(
      false,
    );

    const { input, confirm } = await openPrintConfirmation();
    fireEvent.change(input, { target: { value: '山田 太郎' } });
    fireEvent.click(confirm);
    expect(window.print).toHaveBeenCalledTimes(1);
  });

  it('requires a fresh confirmation when the exact set-plan version changes', async () => {
    setSearch('type=set_instruction&patient_id=patient_1&set_plan_id=plan_1');
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/patients/patient_1/header-summary') {
        return json(patientHeaderResponse());
      }
      if (url === '/api/set-plans/plan_1') return json(setPlanResponse());
      if (url === '/api/patients/patient_1/prescriptions?limit=20') {
        return json(prescriptionsResponse());
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { queryClient } = renderPrintHub();
    expect(await screen.findByText('アムロジピン錠5mg')).toBeTruthy();
    const { input } = await openPrintConfirmation();
    fireEvent.change(input, { target: { value: '山田 太郎' } });

    act(() => {
      queryClient.setQueryData(['print-hub-set-plan', 'org_1', 'patient_1', 'plan_1'], {
        ...setPlanResponse().data,
        updated_at: '2026-06-01T02:00:00.000Z',
      });
    });

    await waitFor(() =>
      expect(screen.queryByRole('alertdialog', { name: '印刷対象を確認' })).toBeNull(),
    );
    expect(window.print).not.toHaveBeenCalled();
  });

  it('requires a fresh confirmation when the exact prescription intake version changes', async () => {
    setSearch('type=set_instruction&patient_id=patient_1&set_plan_id=plan_1');
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/patients/patient_1/header-summary') {
        return json(patientHeaderResponse());
      }
      if (url === '/api/set-plans/plan_1') return json(setPlanResponse());
      if (url === '/api/patients/patient_1/prescriptions?limit=20') {
        return json(prescriptionsResponse());
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const { queryClient } = renderPrintHub();
    expect(await screen.findByText('アムロジピン錠5mg')).toBeTruthy();
    const { input } = await openPrintConfirmation();
    fireEvent.change(input, { target: { value: '山田 太郎' } });

    act(() => {
      queryClient.setQueryData(
        ['print-hub-prescriptions', 'org_1', 'patient_1', 'plan_1', 'cycle_1'],
        {
          patient: { id: 'patient_1', name: '山田 太郎', name_kana: 'ヤマダ タロウ' },
          data: [
            {
              ...prescriptionIntake(),
              updated_at: '2026-06-01T02:00:00.000Z',
            },
          ],
        },
      );
    });

    await waitFor(() =>
      expect(screen.queryByRole('alertdialog', { name: '印刷対象を確認' })).toBeNull(),
    );
    expect(window.print).not.toHaveBeenCalled();
  });

  it('rejects a set plan whose resource patient differs before prescription reads or print', async () => {
    setSearch('type=set_instruction&patient_id=patient_1&set_plan_id=plan_1');
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/patients/patient_1/header-summary') {
        return json(patientHeaderResponse());
      }
      if (url === '/api/set-plans/plan_1') return json(setPlanResponse('patient_2'));
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderPrintHub();

    expect(
      (
        await screen.findAllByText(
          '帳票データの読み込みに失敗しました。対象画面から開き直すか再読み込みしてください。',
        )
      ).length,
    ).toBeGreaterThan(0);
    const urls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(urls.some((url) => url.includes('/prescriptions'))).toBe(false);
    expect(screen.getByTestId('print-submit-button')).toHaveProperty('disabled', true);
    expect(window.print).not.toHaveBeenCalled();
  });

  it('loads one exact report, audits its exact version, and prints only after confirmation', async () => {
    setSearch('type=visit_report&patient_id=patient_1&report_id=report_1');
    const intents: Array<string | undefined> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/patients/patient_1/header-summary') {
        return json(patientHeaderResponse());
      }
      if (url === '/api/care-reports/report_1') return json(careReportDetailResponse());
      if (url === '/api/care-reports/report_1/print-audit') {
        intents.push(requestIntent(init));
        return json(printAuditResponse({ assessment: '監査済み訪問報告' }));
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderPrintHub();

    expect(await screen.findByText('監査済み訪問報告')).toBeTruthy();
    expect(intents).toEqual(['preview_rendered']);
    expect(fetchMock.mock.calls.map(([input]) => String(input))).not.toContain(
      '/api/care-reports?limit=50&status=confirmed',
    );

    const { input, confirm } = await openPrintConfirmation();
    expect(window.print).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '山田 太郎' } });
    fireEvent.click(confirm);

    await waitFor(() => expect(intents).toEqual(['preview_rendered', 'print_requested']));
    expect(fetchMock).toHaveBeenCalledWith('/api/care-reports/report_1/print-audit', {
      method: 'POST',
      headers: buildOrgJsonHeaders('org_1'),
      body: JSON.stringify({
        intent: 'print_requested',
        expected_report_updated_at: REPORT_UPDATED_AT,
      }),
    });
    expect(window.print).toHaveBeenCalledTimes(1);
  });

  it('suppresses duplicate confirmation while the exact report audit is in flight', async () => {
    setSearch('type=visit_report&patient_id=patient_1&report_id=report_1');
    let printRequestedCount = 0;
    const deferredPrintAudit = createDeferred<Response>();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/patients/patient_1/header-summary') {
        return json(patientHeaderResponse());
      }
      if (url === '/api/care-reports/report_1') return json(careReportDetailResponse());
      if (url === '/api/care-reports/report_1/print-audit') {
        if (requestIntent(init) === 'print_requested') {
          printRequestedCount += 1;
          return deferredPrintAudit.promise;
        }
        return json(printAuditResponse());
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderPrintHub();
    expect(await screen.findByText('監査済み本文')).toBeTruthy();

    const { input, confirm } = await openPrintConfirmation();
    fireEvent.change(input, { target: { value: '山田 太郎' } });
    await waitFor(() => expect(confirm).toHaveProperty('disabled', false));
    act(() => {
      confirm.click();
      confirm.click();
    });

    await waitFor(() => expect(printRequestedCount).toBe(1));
    expect(window.print).not.toHaveBeenCalled();
    deferredPrintAudit.resolve(json(printAuditResponse()));
    await waitFor(() => expect(window.print).toHaveBeenCalledTimes(1));
    expect(printRequestedCount).toBe(1);
  });

  it('invalidates an in-flight report print synchronously when the target switch is requested', async () => {
    setSearch('type=visit_report&patient_id=patient_1&report_id=report_1');
    let printRequestedCount = 0;
    const deferredPrintAudit = createDeferred<Response>();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/patients/patient_1/header-summary') {
        return json(patientHeaderResponse());
      }
      if (url === '/api/care-reports/report_1') return json(careReportDetailResponse());
      if (url === '/api/care-reports/report_1/print-audit') {
        if (requestIntent(init) === 'print_requested') {
          printRequestedCount += 1;
          return deferredPrintAudit.promise;
        }
        return json(printAuditResponse());
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderPrintHub();
    expect(await screen.findByText('監査済み本文')).toBeTruthy();
    const { input, confirm } = await openPrintConfirmation();
    fireEvent.change(input, { target: { value: '山田 太郎' } });
    fireEvent.click(confirm);
    await waitFor(() => expect(printRequestedCount).toBe(1));

    await act(async () => {
      fireEvent.click(screen.getByTestId('print-target-document_receipt'));
      deferredPrintAudit.resolve(json(printAuditResponse()));
      await deferredPrintAudit.promise;
    });

    expect(
      await screen.findByText('印刷対象が変わりました。対象を確認してもう一度操作してください。'),
    ).toBeTruthy();
    expect(replaceMock).toHaveBeenCalledWith(
      '/reports/print?type=document_receipt&patient_id=patient_1',
      { scroll: false },
    );
    expect(window.print).not.toHaveBeenCalled();
    expect(printRequestedCount).toBe(1);
  });

  it('invalidates an in-flight report print synchronously when an output setting changes', async () => {
    setSearch('type=visit_report&patient_id=patient_1&report_id=report_1');
    let printRequestedCount = 0;
    const deferredPrintAudit = createDeferred<Response>();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/patients/patient_1/header-summary') {
        return json(patientHeaderResponse());
      }
      if (url === '/api/care-reports/report_1') return json(careReportDetailResponse());
      if (url === '/api/care-reports/report_1/print-audit') {
        if (requestIntent(init) === 'print_requested') {
          printRequestedCount += 1;
          return deferredPrintAudit.promise;
        }
        return json(printAuditResponse());
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderPrintHub();
    expect(await screen.findByText('監査済み本文')).toBeTruthy();
    const { input, confirm } = await openPrintConfirmation();
    fireEvent.change(input, { target: { value: '山田 太郎' } });
    fireEvent.click(confirm);
    await waitFor(() => expect(printRequestedCount).toBe(1));

    await act(async () => {
      fireEvent.click(screen.getByRole('checkbox', { name: 'QRコードを付ける' }));
      deferredPrintAudit.resolve(json(printAuditResponse()));
      await deferredPrintAudit.promise;
    });

    expect(
      await screen.findByText('印刷対象が変わりました。対象を確認してもう一度操作してください。'),
    ).toBeTruthy();
    expect(window.print).not.toHaveBeenCalled();
    expect(printRequestedCount).toBe(1);
  });

  it('rejects report/patient mismatch before preview audit or print', async () => {
    setSearch('type=visit_report&patient_id=patient_1&report_id=report_1');
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/patients/patient_1/header-summary') {
        return json(patientHeaderResponse());
      }
      if (url === '/api/care-reports/report_1') {
        return json(careReportDetailResponse({ patientId: 'patient_2' }));
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderPrintHub();

    expect(
      (
        await screen.findAllByText(
          '帳票データの読み込みに失敗しました。対象画面から開き直すか再読み込みしてください。',
        )
      ).length,
    ).toBeGreaterThan(0);
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith('/print-audit'))).toBe(
      false,
    );
    expect(screen.getByTestId('print-submit-button')).toHaveProperty('disabled', true);
    expect(window.print).not.toHaveBeenCalled();
  });

  it('does not print when the report version changes after preview confirmation', async () => {
    setSearch('type=visit_report&patient_id=patient_1&report_id=report_1');
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/patients/patient_1/header-summary') {
        return json(patientHeaderResponse());
      }
      if (url === '/api/care-reports/report_1') return json(careReportDetailResponse());
      if (url === '/api/care-reports/report_1/print-audit') {
        return requestIntent(init) === 'print_requested'
          ? json(printAuditResponse({ updatedAt: '2026-06-18T00:06:00.000Z' }))
          : json(printAuditResponse());
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderPrintHub();
    expect(await screen.findByText('監査済み本文')).toBeTruthy();
    const { input, confirm } = await openPrintConfirmation();
    fireEvent.change(input, { target: { value: '山田 太郎' } });
    fireEvent.click(confirm);

    expect(
      await screen.findByText('報告書の印刷監査を記録できませんでした。再読み込みしてください。'),
    ).toBeTruthy();
    expect(window.print).not.toHaveBeenCalled();
  });

  it('uses only the exact report delivery records for a document receipt without preview audit', async () => {
    setSearch('type=document_receipt&patient_id=patient_1&report_id=report_1');
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/patients/patient_1/header-summary') {
        return json(patientHeaderResponse());
      }
      if (url === '/api/care-reports/report_1') {
        return json(
          careReportDetailResponse({
            deliveryRecords: [
              {
                id: 'delivery_1',
                channel: 'fax',
                recipient_name: '主治医 一郎',
                recipient_contact: '03-0000-0000',
                status: 'sent',
                sent_at: '2026-06-18T01:00:00.000Z',
                created_at: '2026-06-18T00:30:00.000Z',
              },
            ],
          }),
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderPrintHub();

    expect(await screen.findByText('主治医 一郎')).toBeTruthy();
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith('/print-audit'))).toBe(
      false,
    );
    const { input, confirm } = await openPrintConfirmation();
    fireEvent.change(input, { target: { value: '山田 太郎' } });
    fireEvent.click(confirm);
    expect(window.print).toHaveBeenCalledTimes(1);
  });
});
