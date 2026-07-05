import { afterEach, describe, expect, it, vi } from 'vitest';

import { MOCK_WRITE_NOOP } from './dispensing-workbench.write-types';
import { jsonResponse } from '@/test/fetch-test-utils';

function expectOrgReadHeaders(init: unknown, orgId: string) {
  expect(init).toMatchObject({
    headers: {
      Accept: 'application/json',
      'x-org-id': orgId,
    },
  });
}

function calendarBody() {
  return {
    data: {
      plan_id: 'plan_1',
      cycle_id: 'cycle_1',
      cycle_version: 3,
      cycle_status: 'setting',
      set_method: 'facility_calendar',
      period_start: '2026-06-17',
      period_end: '2026-06-17',
      day_count: 1,
      slots: ['morning', 'noon', 'evening', 'bedtime', 'prn'],
      rows: [
        {
          line: {
            id: 'line_1',
            drug_name: 'アムロジピン錠5mg',
            dose: '1錠',
            frequency: '朝食後',
            unit: '錠',
          },
          days: [
            {
              day_number: 1,
              date: '2026-06-17',
              cells: {
                morning: {
                  batch_id: 'batch_1',
                  state: 'set',
                  quantity: 1,
                  carry_type: 'carry',
                  set_state: 'set',
                  audit_state: 'pending',
                  ng_code: null,
                  held_reason: null,
                  version: 5,
                },
                noon: emptyCell(),
                evening: emptyCell(),
                bedtime: emptyCell(),
                prn: emptyCell(),
              },
            },
          ],
        },
      ],
      completion_gate: {
        total_cells: 1,
        set_cells: 1,
        pending_cells: 0,
        hold_cells: 0,
        audited_ok_cells: 0,
        audited_ng_cells: 0,
        unaudited_cells: 1,
        set_complete: true,
        audit_complete: false,
      },
    },
  };
}

function workbenchBody() {
  return {
    task: { id: 'task_1', status: 'in_progress', priority: 'normal', due_date: null },
    cycle: { id: 'cycle_1', overall_status: 'dispensing', version: 2 },
    patient: { id: 'patient_1', name: '佐藤 花子' },
    intake: {
      id: 'intake_1',
      prescribed_date: '2026-06-17',
      prescriber_institution: 'さくら内科',
      prescriber_name: '田中 一郎',
    },
    previous_intake: null,
    safety: {
      allergy: null,
      renal: null,
      handling_tags: [],
      swallowing: null,
      cautions: [],
    },
    comparison: [],
    count_rows: [],
    dispenser: null,
    auditor: null,
    is_self_audit: false,
    has_narcotic: false,
    visit_time_label: null,
    resolved_inquiry: null,
    team_audit_total: 0,
    stock_check_date_label: null,
  };
}

function emptyCell() {
  return {
    batch_id: null,
    state: 'empty',
    quantity: null,
    carry_type: null,
    set_state: null,
    audit_state: null,
    ng_code: null,
    held_reason: null,
    version: null,
  };
}

describe('dispensing-workbench.adapter set calendar real-data resolution', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    delete process.env.NEXT_PUBLIC_WORKBENCH_USE_REAL_DATA;
  });

  it('returns an empty patient list instead of seed fallback when the real-data patient API fails', async () => {
    process.env.NEXT_PUBLIC_WORKBENCH_USE_REAL_DATA = '1';
    const fetchMock = vi.fn(async () => new Response('server error', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    const { loadPatientsAsync } = await import('./dispensing-workbench.adapter');
    const result = await loadPatientsAsync();

    expect(result).toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith('/api/dispense-workbench/patients', expect.any(Object));
  });

  it('returns an empty patient list instead of seed fallback when the real-data patient API is empty', async () => {
    process.env.NEXT_PUBLIC_WORKBENCH_USE_REAL_DATA = '1';
    const fetchMock = vi.fn(async () => jsonResponse({ data: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const { loadPatientsAsync } = await import('./dispensing-workbench.adapter');
    const result = await loadPatientsAsync();

    expect(result).toEqual([]);
  });

  it('reuses already loaded patient rows when resolving the dispense workbench', async () => {
    process.env.NEXT_PUBLIC_WORKBENCH_USE_REAL_DATA = '1';
    const fetchMock = vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/dispense-tasks?cycle_id=cycle_1') {
        return jsonResponse({
          data: [{ id: 'task_1', cycle_id: 'cycle_1', status: 'in_progress' }],
        });
      }
      if (url === '/api/dispense-tasks/task_1/workbench') {
        return jsonResponse(workbenchBody());
      }
      return new Response('unexpected patient refetch', { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { loadWorkbenchAsync } = await import('./dispensing-workbench.adapter');
    const result = await loadWorkbenchAsync('dispense', 'patient_1', {
      patientRows: [
        {
          patient_id: 'patient_1',
          cycle_id: 'cycle_1',
          name: '佐藤 花子',
          name_kana: 'サトウ ハナコ',
          overall_status: 'dispensing',
          badge: 'in_progress',
          start_date: '2026-06-17',
          registered_date: '2026-06-01',
          latest_set_plan_id: null,
          latest_set_plan_cycle_id: null,
        },
      ],
    });

    expect(result).toMatchObject({
      patient: { id: 'patient_1', name: '佐藤 花子' },
      writeContext: {
        taskId: 'task_1',
        cycleId: 'cycle_1',
        cycleVersion: 2,
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/dispense-workbench/patients',
      expect.any(Object),
    );
  });

  it('resolves direct /audit entry to the completed dispense task for audit-ready cycles', async () => {
    process.env.NEXT_PUBLIC_WORKBENCH_USE_REAL_DATA = '1';
    const fetchMock = vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/dispense-tasks?cycle_id=cycle_1') {
        return jsonResponse({
          data: [
            { id: 'task_old_pending', cycle_id: 'cycle_1', status: 'pending' },
            { id: 'task_audit_ready', cycle_id: 'cycle_1', status: 'completed' },
          ],
        });
      }
      if (url === '/api/dispense-tasks/task_audit_ready/workbench') {
        return jsonResponse({
          ...workbenchBody(),
          task: { id: 'task_audit_ready', status: 'completed', priority: 'normal', due_date: null },
          cycle: { id: 'cycle_1', overall_status: 'dispensed', version: 2 },
        });
      }
      return new Response('unexpected task resolution', { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { loadWorkbenchAsync } = await import('./dispensing-workbench.adapter');
    const result = await loadWorkbenchAsync('audit', 'patient_1', {
      patientRows: [
        {
          patient_id: 'patient_1',
          cycle_id: 'cycle_1',
          name: '佐藤 花子',
          name_kana: 'サトウ ハナコ',
          overall_status: 'dispensed',
          badge: 'in_progress',
          start_date: '2026-06-17',
          registered_date: '2026-06-01',
          latest_set_plan_id: null,
          latest_set_plan_cycle_id: null,
        },
      ],
    });

    expect(result).toMatchObject({
      writeContext: {
        taskId: 'task_audit_ready',
        cycleId: 'cycle_1',
      },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/dispense-tasks/task_audit_ready/workbench',
      expect.any(Object),
    );
  });

  it('resolves direct /set entry from patient cycle to latest SetPlan calendar', async () => {
    process.env.NEXT_PUBLIC_WORKBENCH_USE_REAL_DATA = '1';
    const fetchMock = vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/dispense-workbench/patients?include_set_plan=1') {
        return jsonResponse({
          data: [
            {
              patient_id: 'patient_1',
              cycle_id: 'cycle_latest_without_plan',
              name: '佐藤 花子',
              name_kana: 'サトウ ハナコ',
              overall_status: 'dispensing',
              badge: 'in_progress',
              start_date: '2026-06-17',
              registered_date: '2026-06-01',
              latest_set_plan_id: 'plan_1',
              latest_set_plan_cycle_id: 'cycle_1',
            },
          ],
        });
      }
      if (url === '/api/set-plans/plan_1/calendar') {
        return jsonResponse(calendarBody());
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { loadSetCalendarForPatientAsync } = await import('./dispensing-workbench.adapter');
    const result = await loadSetCalendarForPatientAsync('patient_1');

    expect(result).toMatchObject({
      selId: 'patient_1',
      writeContext: {
        planId: 'plan_1',
        cycleId: 'cycle_1',
        cycleVersion: 3,
        cellMeta: {
          'patient_1:0:朝': {
            batchIds: ['batch_1'],
            versions: [5],
            dayNumber: 1,
            slot: 'morning',
          },
        },
      },
      calendarState: {
        setCells: { 'patient_1:0:朝': 'set' },
      },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/dispense-workbench/patients?include_set_plan=1',
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/set-plans/plan_1/calendar',
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fails closed instead of switching patients when the selected patient has no SetPlan', async () => {
    process.env.NEXT_PUBLIC_WORKBENCH_USE_REAL_DATA = '1';
    const fetchMock = vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/dispense-workbench/patients?include_set_plan=1') {
        return jsonResponse({
          data: [
            {
              patient_id: 'patient_without_plan',
              cycle_id: 'cycle_without_plan',
              name: '計画なし 患者',
              name_kana: 'ケイカクナシ カンジャ',
              overall_status: 'dispensing',
              badge: 'in_progress',
              start_date: '2026-06-17',
              registered_date: '2026-06-01',
              latest_set_plan_id: null,
              latest_set_plan_cycle_id: null,
            },
            {
              patient_id: 'patient_with_plan',
              cycle_id: 'cycle_latest_without_plan',
              name: '計画あり 患者',
              name_kana: 'ケイカクアリ カンジャ',
              overall_status: 'dispensing',
              badge: 'in_progress',
              start_date: '2026-06-17',
              registered_date: '2026-06-01',
              latest_set_plan_id: 'plan_1',
              latest_set_plan_cycle_id: 'cycle_1',
            },
          ],
        });
      }
      if (url === '/api/set-plans/plan_1/calendar') {
        return jsonResponse(calendarBody());
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { loadSetCalendarForPatientAsync } = await import('./dispensing-workbench.adapter');
    const result = await loadSetCalendarForPatientAsync('patient_without_plan');

    expect(result).toEqual({ empty: true, patients: [], selId: '' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/set-plans?patient_id=patient_without_plan',
      expect.any(Object),
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/set-plans?patient_id=patient_with_plan',
      expect.any(Object),
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/set-plans/plan_1/calendar',
      expect.any(Object),
    );
  });

  it('uses the first SetPlan-backed patient when the current selection is not a real patient', async () => {
    process.env.NEXT_PUBLIC_WORKBENCH_USE_REAL_DATA = '1';
    const fetchMock = vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/dispense-workbench/patients?include_set_plan=1') {
        return jsonResponse({
          data: [
            {
              patient_id: 'patient_without_plan',
              cycle_id: 'cycle_without_plan',
              name: '計画なし 患者',
              name_kana: 'ケイカクナシ カンジャ',
              overall_status: 'dispensing',
              badge: 'in_progress',
              start_date: '2026-06-17',
              registered_date: '2026-06-01',
              latest_set_plan_id: null,
              latest_set_plan_cycle_id: null,
            },
            {
              patient_id: 'patient_with_plan',
              cycle_id: 'cycle_latest_without_plan',
              name: '計画あり 患者',
              name_kana: 'ケイカクアリ カンジャ',
              overall_status: 'dispensing',
              badge: 'in_progress',
              start_date: '2026-06-17',
              registered_date: '2026-06-01',
              latest_set_plan_id: 'plan_1',
              latest_set_plan_cycle_id: 'cycle_1',
            },
          ],
        });
      }
      if (url === '/api/set-plans/plan_1/calendar') {
        return jsonResponse(calendarBody());
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { loadSetCalendarForPatientAsync } = await import('./dispensing-workbench.adapter');
    const result = await loadSetCalendarForPatientAsync('seed_patient_not_in_real_list');

    expect(result?.selId).toBe('patient_with_plan');
    // The empty result union branch has no writeContext, so narrow to the
    // populated branch before asserting the write context.
    if (!result || !('writeContext' in result))
      throw new Error('expected populated calendar result');
    expect(result.writeContext.planId).toBe('plan_1');
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/set-plans?patient_id=patient_without_plan',
      expect.any(Object),
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/set-plans?patient_id=patient_with_plan',
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenCalledWith('/api/set-plans/plan_1/calendar', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('dispensing-workbench.adapter real-data default + phase filtering', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    delete process.env.NEXT_PUBLIC_WORKBENCH_USE_REAL_DATA;
  });

  it('defaults to the real-data path when the flag is unset (§15 real-data default)', async () => {
    // フラグ未設定でも実 API を読む（mock seed に戻らない）。
    delete process.env.NEXT_PUBLIC_WORKBENCH_USE_REAL_DATA;
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        data: [
          {
            patient_id: 'patient_1',
            cycle_id: 'cycle_1',
            name: '佐藤 花子',
            name_kana: 'サトウ ハナコ',
            overall_status: 'dispensing',
            badge: 'in_progress',
            start_date: '2026-06-17',
            registered_date: '2026-06-01',
            latest_set_plan_id: null,
            latest_set_plan_cycle_id: null,
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { isRealDataEnabled, loadPatientsAsync } = await import('./dispensing-workbench.adapter');

    expect(isRealDataEnabled()).toBe(true);
    const result = await loadPatientsAsync();
    expect(fetchMock).toHaveBeenCalledWith('/api/dispense-workbench/patients', expect.any(Object));
    expect(result.map((p) => p.id)).toEqual(['patient_1']);
  });

  it("retains a mock opt-out seam when the flag is 'mock' (rollback path)", async () => {
    process.env.NEXT_PUBLIC_WORKBENCH_USE_REAL_DATA = 'mock';
    const fetchMock = vi.fn(async () => jsonResponse({ data: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const { isRealDataEnabled, loadPatientsAsync } = await import('./dispensing-workbench.adapter');

    expect(isRealDataEnabled()).toBe(false);
    const result = await loadPatientsAsync();
    // seed へ退避（非空）し、実 API は叩かない。
    expect(result.length).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('appends ?phase= to the patients query for the audit phase', async () => {
    process.env.NEXT_PUBLIC_WORKBENCH_USE_REAL_DATA = '1';
    const fetchMock = vi.fn(async () => jsonResponse({ data: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const { loadPatientsAsync } = await import('./dispensing-workbench.adapter');
    await loadPatientsAsync('audit');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/dispense-workbench/patients?phase=audit',
      expect.any(Object),
    );
  });

  it('maps the internal setp phase to the set URL token with include_set_plan', async () => {
    process.env.NEXT_PUBLIC_WORKBENCH_USE_REAL_DATA = '1';
    const fetchMock = vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/dispense-workbench/patients?include_set_plan=1&phase=set') {
        return jsonResponse({
          data: [
            {
              patient_id: 'patient_1',
              cycle_id: 'cycle_latest_without_plan',
              name: '佐藤 花子',
              name_kana: 'サトウ ハナコ',
              overall_status: 'setting',
              badge: 'in_progress',
              start_date: '2026-06-17',
              registered_date: '2026-06-01',
              latest_set_plan_id: 'plan_1',
              latest_set_plan_cycle_id: 'cycle_1',
            },
          ],
        });
      }
      if (url === '/api/set-plans/plan_1/calendar') {
        return jsonResponse(calendarBody());
      }
      return new Response('unexpected url', { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { loadSetCalendarForPatientAsync } = await import('./dispensing-workbench.adapter');
    const result = await loadSetCalendarForPatientAsync('patient_1', 'setp', { orgId: 'org_1' });

    expect(result?.selId).toBe('patient_1');
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/dispense-workbench/patients?include_set_plan=1&phase=set',
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/set-plans/plan_1/calendar',
      expect.any(Object),
    );
    expectOrgReadHeaders(fetchMock.mock.calls[0]?.[1], 'org_1');
    expectOrgReadHeaders(fetchMock.mock.calls[1]?.[1], 'org_1');
  });

  it('passes the current org header through the dispense read chain', async () => {
    process.env.NEXT_PUBLIC_WORKBENCH_USE_REAL_DATA = '1';
    const fetchMock = vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/dispense-workbench/patients?phase=dispense') {
        return jsonResponse({
          data: [
            {
              patient_id: 'patient_1',
              cycle_id: 'cycle_1',
              name: '佐藤 花子',
              name_kana: 'サトウ ハナコ',
              overall_status: 'dispensing',
              badge: 'in_progress',
              start_date: '2026-06-17',
              registered_date: '2026-06-01',
              latest_set_plan_id: null,
              latest_set_plan_cycle_id: null,
            },
          ],
        });
      }
      if (url === '/api/dispense-tasks?cycle_id=cycle_1') {
        return jsonResponse({
          data: [{ id: 'task_1', cycle_id: 'cycle_1', status: 'in_progress' }],
        });
      }
      if (url === '/api/dispense-tasks/task_1/workbench') {
        return jsonResponse(workbenchBody());
      }
      return new Response('unexpected url', { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { loadWorkbenchPatientRowsAsync, loadWorkbenchAsync } =
      await import('./dispensing-workbench.adapter');
    const { patients, rows } = await loadWorkbenchPatientRowsAsync({
      phase: 'dispense',
      orgId: 'org_1',
    });
    const result = await loadWorkbenchAsync('dispense', patients[0]!.id, {
      patientRows: rows,
      orgId: 'org_1',
    });

    expect(result?.writeContext.taskId).toBe('task_1');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const call of fetchMock.mock.calls) {
      expectOrgReadHeaders(call[1], 'org_1');
    }
  });

  it('maps the seta phase to set-audit and fails closed on the empty gate', async () => {
    // set-audit は BFF で空集合ゲート → 0 件 → empty（seed カレンダーへ戻さない）。
    process.env.NEXT_PUBLIC_WORKBENCH_USE_REAL_DATA = '1';
    const fetchMock = vi.fn(async () => jsonResponse({ data: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const { loadSetCalendarForPatientAsync } = await import('./dispensing-workbench.adapter');
    const result = await loadSetCalendarForPatientAsync('patient_1', 'seta');

    expect(result).toEqual({ empty: true, patients: [], selId: '' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/dispense-workbench/patients?include_set_plan=1&phase=set-audit',
      expect.any(Object),
    );
  });

  it('reports ok=false when the patients fetch fails (distinguishes a fault from 0 件)', async () => {
    process.env.NEXT_PUBLIC_WORKBENCH_USE_REAL_DATA = '1';
    const fetchMock = vi.fn(async () => new Response('server error', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    const { loadWorkbenchPatientRowsAsync } = await import('./dispensing-workbench.adapter');
    const result = await loadWorkbenchPatientRowsAsync({ phase: 'dispense' });

    expect(result).toEqual({ patients: [], rows: [], ok: false });
  });

  it('reports ok=false when the patients fetch succeeds with malformed JSON', async () => {
    process.env.NEXT_PUBLIC_WORKBENCH_USE_REAL_DATA = '1';
    const fetchMock = vi.fn(async () => new Response('not json', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const { loadWorkbenchPatientRowsAsync } = await import('./dispensing-workbench.adapter');
    const result = await loadWorkbenchPatientRowsAsync({ phase: 'dispense' });

    expect(result).toEqual({ patients: [], rows: [], ok: false });
  });

  it('reports ok=true on a successful but empty patients fetch (0 件は空状態)', async () => {
    process.env.NEXT_PUBLIC_WORKBENCH_USE_REAL_DATA = '1';
    const fetchMock = vi.fn(async () => jsonResponse({ data: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const { loadWorkbenchPatientRowsAsync } = await import('./dispensing-workbench.adapter');
    const result = await loadWorkbenchPatientRowsAsync({ phase: 'dispense' });

    expect(result).toEqual({ patients: [], rows: [], ok: true });
  });
});

describe('dispensing-workbench.adapter generateSetBatches', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    delete process.env.NEXT_PUBLIC_WORKBENCH_USE_REAL_DATA;
  });

  it('POSTs the force/expected_updated_at body to the generate-batches endpoint in real-data mode', async () => {
    process.env.NEXT_PUBLIC_WORKBENCH_USE_REAL_DATA = '1';
    const fetchMock = vi.fn(async () =>
      jsonResponse({ data: { count: 3, batches: [], reused: false } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { generateSetBatches } = await import('./dispensing-workbench.adapter');
    const result = await generateSetBatches('plan_1', {
      force: true,
      expected_updated_at: '2026-06-20T00:00:00.000Z',
    });

    expect(result).toEqual({ data: { count: 3, batches: [], reused: false } });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/set-plans/plan_1/generate-batches',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ force: true, expected_updated_at: '2026-06-20T00:00:00.000Z' }),
      }),
    );
  });

  it('returns a mock write noop without calling fetch when real data is opted out', async () => {
    process.env.NEXT_PUBLIC_WORKBENCH_USE_REAL_DATA = 'mock';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { generateSetBatches } = await import('./dispensing-workbench.adapter');
    const result = await generateSetBatches('plan_1', { force: false });

    expect(result).toEqual(MOCK_WRITE_NOOP);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('promotes a 409 conflict response to a WorkbenchConflictError', async () => {
    process.env.NEXT_PUBLIC_WORKBENCH_USE_REAL_DATA = '1';
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: '他の操作と競合しました。' }), {
          status: 409,
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    // vi.resetModules() gives the dynamically imported adapter a fresh module graph,
    // so the thrown class must be resolved from the same fresh write-types instance.
    const { generateSetBatches } = await import('./dispensing-workbench.adapter');
    const { WorkbenchConflictError } = await import('./dispensing-workbench.write-types');

    await expect(
      generateSetBatches('plan_1', { force: true, expected_updated_at: 'x' }),
    ).rejects.toBeInstanceOf(WorkbenchConflictError);
  });
});

describe('dispensing-workbench.adapter classifyCalendarPlanLoad (set/seta planId branch fail-closed)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    delete process.env.NEXT_PUBLIC_WORKBENCH_USE_REAL_DATA;
  });

  it('classifies a failed calendar fetch (HTTP 500) as error so the left pane shows a fetch error, not a false-empty patient list', async () => {
    process.env.NEXT_PUBLIC_WORKBENCH_USE_REAL_DATA = '1';
    const fetchMock = vi.fn(async () => new Response('server error', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    const { loadCalendarWriteContextAsync, classifyCalendarPlanLoad } =
      await import('./dispensing-workbench.adapter');
    const result = await loadCalendarWriteContextAsync('patient_1', 'plan_1', { orgId: 'org_1' });

    expect(result).toBeNull();
    // planId 実在で calendar 取得に失敗 → 空（対象患者ゼロ）でなく error。これが false-empty 回帰の歯止め。
    expect(classifyCalendarPlanLoad(result)).toEqual({ status: 'error' });
  });

  it('treats a 404 calendar response as error as well (a missing plan calendar is a failure, never an empty queue)', async () => {
    process.env.NEXT_PUBLIC_WORKBENCH_USE_REAL_DATA = '1';
    const fetchMock = vi.fn(async () => new Response('not found', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);

    const { loadCalendarWriteContextAsync, classifyCalendarPlanLoad } =
      await import('./dispensing-workbench.adapter');
    const result = await loadCalendarWriteContextAsync('patient_1', 'plan_1', { orgId: 'org_1' });

    expect(classifyCalendarPlanLoad(result)).toEqual({ status: 'error' });
  });

  it('treats a malformed successful calendar response as error, not an empty queue', async () => {
    process.env.NEXT_PUBLIC_WORKBENCH_USE_REAL_DATA = '1';
    const fetchMock = vi.fn(async () => new Response('not json', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const { loadCalendarWriteContextAsync, classifyCalendarPlanLoad } =
      await import('./dispensing-workbench.adapter');
    const result = await loadCalendarWriteContextAsync('patient_1', 'plan_1', { orgId: 'org_1' });

    expect(classifyCalendarPlanLoad(result)).toEqual({ status: 'error' });
  });

  it('classifies a successful calendar load as loaded with calendar state and write context', async () => {
    process.env.NEXT_PUBLIC_WORKBENCH_USE_REAL_DATA = '1';
    const fetchMock = vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/set-plans/plan_1/calendar') {
        return jsonResponse(calendarBody());
      }
      return new Response('unexpected fetch', { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { loadCalendarWriteContextAsync, classifyCalendarPlanLoad } =
      await import('./dispensing-workbench.adapter');
    const result = await loadCalendarWriteContextAsync('patient_1', 'plan_1', { orgId: 'org_1' });
    expect(result).not.toBeNull();

    const outcome = classifyCalendarPlanLoad(result);
    expect(outcome.status).toBe('loaded');
    if (outcome.status === 'loaded') {
      expect(outcome.writeContext.planId).toBe('plan_1');
      expect(outcome.writeContext.cycleId).toBe('cycle_1');
      expect(outcome.calendarState).toEqual(result!.calendarState);
      expect(outcome.generation).toBe(result!.matrix.generation ?? null);
    }
  });
});
