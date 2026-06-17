import { afterEach, describe, expect, it, vi } from 'vitest';

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
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

  it('resolves direct /set entry from patient cycle to latest SetPlan calendar', async () => {
    process.env.NEXT_PUBLIC_WORKBENCH_USE_REAL_DATA = '1';
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/dispense-workbench/patients') {
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
            },
          ],
        });
      }
      if (url === '/api/set-plans?patient_id=patient_1') {
        return jsonResponse({ data: [{ id: 'plan_1', cycle_id: 'cycle_1' }] });
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
      '/api/dispense-workbench/patients',
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/set-plans?patient_id=patient_1',
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/set-plans/plan_1/calendar',
      expect.any(Object),
    );
  });

  it('fails closed instead of switching patients when the selected patient has no SetPlan', async () => {
    process.env.NEXT_PUBLIC_WORKBENCH_USE_REAL_DATA = '1';
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/dispense-workbench/patients') {
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
            },
          ],
        });
      }
      if (url === '/api/set-plans?patient_id=patient_without_plan') {
        return jsonResponse({ data: [] });
      }
      if (url === '/api/set-plans?patient_id=patient_with_plan') {
        return jsonResponse({ data: [{ id: 'plan_1', cycle_id: 'cycle_1' }] });
      }
      if (url === '/api/set-plans/plan_1/calendar') {
        return jsonResponse(calendarBody());
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { loadSetCalendarForPatientAsync } = await import('./dispensing-workbench.adapter');
    const result = await loadSetCalendarForPatientAsync('patient_without_plan');

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
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
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/dispense-workbench/patients') {
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
            },
          ],
        });
      }
      if (url === '/api/set-plans?patient_id=patient_without_plan') {
        return jsonResponse({ data: [] });
      }
      if (url === '/api/set-plans?patient_id=patient_with_plan') {
        return jsonResponse({ data: [{ id: 'plan_1', cycle_id: 'cycle_1' }] });
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
    expect(result?.writeContext.planId).toBe('plan_1');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/set-plans?patient_id=patient_without_plan',
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/set-plans?patient_id=patient_with_plan',
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenCalledWith('/api/set-plans/plan_1/calendar', expect.any(Object));
  });
});
