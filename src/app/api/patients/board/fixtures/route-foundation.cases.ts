import { expect, it, vi } from 'vitest';
import { getPatientBoardRouteTestSupport } from './route.test-support';

const {
  patientFindManyMock,
  patientCountMock,
  dispenseTaskFindManyMock,
  workflowExceptionFindManyMock,
  GET,
  createRequest,
  buildPatientRow,
  getPerformanceSnapshot,
} = getPatientBoardRouteTestSupport();

export function registerPatientBoardRouteFoundationCases() {
  it.each([
    ['missing_parking', 'patient_missing_parking', '駐車未確認'],
    ['missing_care_level', 'patient_missing_care_level', '介護度未確認'],
    ['missing_insurance', 'patient_missing_insurance', '保険確認1件'],
    ['missing_consent_plan', 'patient_missing_consent_plan', '同意・計画未確認'],
  ] as const)(
    'filters board cards by expanded foundation issue %s',
    async (issue, patientId, expectedItem) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-12T08:00:00+09:00'));
      const matchingPatient = {
        ...buildPatientRow(new Date('2026-06-12T00:00:00.000Z')),
        id: patientId,
        name: `対象 ${issue}`,
        scheduling_preference: {
          ...buildPatientRow(new Date('2026-06-12T00:00:00.000Z')).scheduling_preference,
          parking_available: issue === 'missing_parking' ? null : true,
          care_level: issue === 'missing_care_level' ? null : 'care_3',
        },
        medical_insurance_number: issue === 'missing_insurance' ? null : 'medical_1',
        care_insurance_number: null,
        consents: issue === 'missing_consent_plan' ? [] : [{ id: 'consent_1' }],
      };
      patientFindManyMock.mockResolvedValue([
        buildPatientRow(new Date('2026-06-12T00:00:00.000Z')),
        matchingPatient,
      ]);
      patientCountMock.mockResolvedValue(2);

      const response = (await GET(createRequest(`?scope=all&foundation_issue=${issue}`), {
        params: Promise.resolve({}),
      }))!;

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.data).toHaveLength(1);
      expect(json.data[0]).toMatchObject({
        patient_id: patientId,
        foundation_issue_keys: [issue],
        foundation_summary: {
          items: expect.arrayContaining([expectedItem]),
        },
      });
      expect(json.meta.facets.foundation_issue_counts[issue]).toBe(1);
    },
  );

  it('scans the foundation basis once across stable batches and keeps exact derived counts', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-12T08:00:00+09:00'));
    const patients = Array.from({ length: 82 }, (_, index) => ({
      ...buildPatientRow(new Date('2026-06-13T00:00:00.000Z')),
      id: `patient_${String(index).padStart(3, '0')}`,
      name: `患者 ${String(index).padStart(3, '0')}`,
      name_kana: `カンジャ ${String(index).padStart(3, '0')}`,
    }));
    patients[10] = {
      ...patients[10]!,
      scheduling_preference: {
        ...patients[10]!.scheduling_preference,
        preferred_contact_phone: null,
      },
      contacts: [],
    };
    patients[80] = {
      ...patients[80]!,
      medical_insurance_number: null,
      care_insurance_number: null,
      cases: [
        {
          ...patients[80]!.cases[0]!,
          visit_schedules: [
            {
              ...patients[80]!.cases[0]!.visit_schedules[0]!,
              scheduled_date: new Date('2026-06-12T00:00:00.000Z'),
              facility_batch_id: 'facility_batch_late',
              facility_batch: { patient_ids: ['patient_080', 'patient_other'] },
            },
          ],
        },
      ],
    };
    patients[81] = {
      ...patients[81]!,
      medical_insurance_number: null,
      care_insurance_number: null,
      cases: [
        {
          ...patients[81]!.cases[0]!,
          medication_cycles: [
            {
              id: 'cycle_late_external',
              overall_status: 'inquiry_pending',
              exception_status: null,
              updated_at: new Date('2026-06-12T08:00:00+09:00'),
              prescription_intakes: [
                {
                  lines: [
                    {
                      packaging_instruction_tags: ['cold_storage'],
                      dispensing_method: null,
                    },
                  ],
                },
              ],
              inquiries: [
                {
                  inquired_at: new Date('2026-06-12T07:00:00+09:00'),
                  resolved_at: null,
                },
              ],
              dispense_tasks: [],
              workflow_exceptions: [],
            },
          ],
        },
      ],
    };
    patientFindManyMock.mockImplementation(
      (args: { cursor?: { id: string }; skip?: number; take?: number }) => {
        const cursorIndex = args.cursor
          ? patients.findIndex((patient) => patient.id === args.cursor?.id)
          : -1;
        const start = cursorIndex >= 0 ? cursorIndex + (args.skip ?? 0) : 0;
        return Promise.resolve(patients.slice(start, start + (args.take ?? patients.length)));
      },
    );
    patientCountMock.mockResolvedValue(82);

    const response = (await GET(createRequest('?scope=all&foundation_issue=missing_insurance'), {
      params: Promise.resolve({}),
    }))!;

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.data.map((card: { patient_id: string }) => card.patient_id)).toEqual([
      'patient_080',
      'patient_081',
    ]);
    expect(new Set(json.data.map((card: { patient_id: string }) => card.patient_id)).size).toBe(2);
    expect(json.meta.facets.foundation_issue_counts).toMatchObject({
      missing_insurance: 2,
      missing_contact: 1,
    });
    expect(json.meta.facets).toMatchObject({
      chip_counts: {
        urgent_now: 0,
        external_wait: 1,
        visit_today: 1,
        paused: 0,
      },
      today_facility_patient_count: 2,
      today_visit_count: 0,
      safety_tagged_count: 1,
    });
    expect(json.meta).toMatchObject({
      assigned_total: 82,
      total_count: 2,
      has_more: false,
      next_cursor: null,
    });

    const patientQueries = patientFindManyMock.mock.calls.map(([args]) => args);
    expect(patientQueries).toHaveLength(2);
    expect(patientQueries[0]).toMatchObject({
      where: expect.objectContaining({ org_id: 'org_1' }),
      orderBy: [{ name_kana: 'asc' }, { id: 'asc' }],
      take: 80,
    });
    expect(patientQueries[0].where).not.toHaveProperty('AND');
    expect(patientQueries[1]).toMatchObject({
      where: expect.objectContaining({ org_id: 'org_1' }),
      orderBy: [{ name_kana: 'asc' }, { id: 'asc' }],
      take: 80,
      cursor: { id: 'patient_079' },
      skip: 1,
    });
    expect(patientQueries[1].where).not.toHaveProperty('AND');
    expect(
      patientFindManyMock.mock.calls.length +
        patientCountMock.mock.calls.length +
        dispenseTaskFindManyMock.mock.calls.length +
        workflowExceptionFindManyMock.mock.calls.length,
    ).toBe(5);
    expect(patientCountMock).toHaveBeenCalledWith({
      where: expect.objectContaining({ org_id: 'org_1' }),
    });
  });

  it('sorts matching cards before applying the cursor page limit and reports has_more', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-12T08:00:00+09:00'));
    const patients = Array.from({ length: 81 }, (_, index) => ({
      ...buildPatientRow(new Date('2026-06-12T00:00:00.000Z')),
      id: `patient_${String(index).padStart(2, '0')}`,
      name: `患者 ${String(index).padStart(2, '0')}`,
      name_kana: `カンジャ ${String(index).padStart(2, '0')}`,
    }));
    patients[80] = {
      ...patients[80]!,
      id: 'patient_urgent_last_in_db_order',
      name: '最後 緊急',
      name_kana: 'ンンンン',
      cases: [
        {
          ...patients[80]!.cases[0]!,
          medication_cycles: [
            {
              id: 'cycle_urgent',
              overall_status: 'dispensed',
              exception_status: null,
              updated_at: new Date('2026-06-12T08:00:00+09:00'),
              prescription_intakes: [
                {
                  lines: [
                    {
                      packaging_instruction_tags: ['narcotic'],
                      dispensing_method: null,
                    },
                  ],
                },
              ],
              dispense_tasks: [
                {
                  due_date: new Date('2026-06-12T00:05:00.000Z'),
                  audits: [],
                },
              ],
              inquiries: [],
              workflow_exceptions: [],
            },
          ],
        },
      ],
    };
    patientFindManyMock.mockImplementation(
      (args: { cursor?: { id: string }; skip?: number; take?: number }) => {
        const cursorIndex = args.cursor
          ? patients.findIndex((patient) => patient.id === args.cursor?.id)
          : -1;
        const start = cursorIndex >= 0 ? cursorIndex + (args.skip ?? 0) : 0;
        return Promise.resolve(patients.slice(start, start + (args.take ?? patients.length)));
      },
    );
    patientCountMock.mockResolvedValue(81);

    const response = (await GET(createRequest('?scope=all&foundation_issue=needs_confirmation'), {
      params: Promise.resolve({}),
    }))!;

    expect(response.status).toBe(200);
    const bodyText = await response.text();
    const json = JSON.parse(bodyText);
    expect(json.data).toHaveLength(60);
    expect(json.data[0]).toMatchObject({
      patient_id: 'patient_urgent_last_in_db_order',
      attention: 'urgent_now',
    });
    expect(json.meta.total_count).toBe(81);
    expect(json.meta.has_more).toBe(true);
    expect(json.meta.next_cursor).toEqual(expect.any(String));
    const responseBytes = Number(response.headers.get('content-length'));
    expect(responseBytes).toBeLessThanOrEqual(307_200);
    expect(
      getPerformanceSnapshot({ topRoutes: 100 }).routes.find(
        (route) => route.method === 'GET' && route.route === '/api/patients/board',
      ),
    ).toMatchObject({
      critical_route: true,
      critical_route_family: 'patients-board',
      payload_sample_count: 1,
      last_payload_bytes: responseBytes,
      payload_budget_bytes: 307_200,
      payload_budget_status: 'within_budget',
      payload_budget_met: true,
    });

    const patientQueries = patientFindManyMock.mock.calls.map(([args]) => args);
    expect(patientQueries).toHaveLength(2);
    expect(patientQueries.filter((args) => args.cursor == null)).toHaveLength(1);
    expect(
      patientQueries.filter((args) => args.cursor?.id === 'patient_79' && args.skip === 1),
    ).toHaveLength(1);
    for (const args of patientQueries) {
      expect(args).toMatchObject({
        where: expect.objectContaining({ org_id: 'org_1' }),
        orderBy: [{ name_kana: 'asc' }, { id: 'asc' }],
        take: 80,
        select: expect.any(Object),
      });
    }
    expect(
      patientFindManyMock.mock.calls.length +
        patientCountMock.mock.calls.length +
        dispenseTaskFindManyMock.mock.calls.length +
        workflowExceptionFindManyMock.mock.calls.length,
    ).toBe(5);
  });

  it('returns stable cursor pages with exact non-page-derived counts', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-12T08:00:00+09:00'));
    const patients = ['A', 'B', 'C'].map((suffix, index) => ({
      ...buildPatientRow(new Date(`2026-06-${20 + index}T00:00:00.000Z`)),
      id: `patient_${suffix.toLowerCase()}`,
      name: `患者 ${suffix}`,
      name_kana: `カンジャ ${suffix}`,
    }));
    patientFindManyMock.mockResolvedValue(patients);
    patientCountMock.mockResolvedValue(3);

    const first = (await GET(createRequest('?scope=all&limit=2'), {
      params: Promise.resolve({}),
    }))!;
    expect(first.status).toBe(200);
    const firstJson = await first.json();
    expect(firstJson.data.map((card: { patient_id: string }) => card.patient_id)).toEqual([
      'patient_a',
      'patient_b',
    ]);
    expect(firstJson.meta).toMatchObject({
      limit: 2,
      returned_count: 2,
      total_count: 3,
      has_more: true,
    });
    expect(firstJson.meta.next_cursor).toEqual(expect.any(String));
    expect(firstJson.meta.facets.chip_counts.visit_today).toBe(0);
    expect(firstJson.meta.facets.safety_tagged_count).toBe(0);

    const second = (await GET(
      createRequest(`?scope=all&limit=2&cursor=${encodeURIComponent(firstJson.meta.next_cursor)}`),
      { params: Promise.resolve({}) },
    ))!;
    expect(second.status).toBe(200);
    const secondJson = await second.json();
    expect(secondJson.data.map((card: { patient_id: string }) => card.patient_id)).toEqual([
      'patient_c',
    ]);
    expect(secondJson.meta).toMatchObject({
      limit: 2,
      returned_count: 1,
      total_count: 3,
      has_more: false,
      next_cursor: null,
    });
  });

  it.each([
    {
      sort: 'name',
      expected: ['patient_a', 'patient_b'],
    },
    {
      sort: 'next_visit',
      expected: ['patient_b', 'patient_c'],
    },
  ] as const)(
    'keeps encrypted keyset pagination stable for $sort sorting',
    async ({ sort, expected }) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-12T08:00:00+09:00'));
      const patients = [
        {
          ...buildPatientRow(new Date('2026-06-15T00:00:00.000Z')),
          id: 'patient_a',
          name: 'A Patient',
          name_kana: 'A',
        },
        {
          ...buildPatientRow(new Date('2026-06-12T00:00:00.000Z')),
          id: 'patient_b',
          name: 'B Patient',
          name_kana: 'B',
        },
        {
          ...buildPatientRow(new Date('2026-06-14T00:00:00.000Z')),
          id: 'patient_c',
          name: 'C Patient',
          name_kana: 'C',
        },
      ];
      patientFindManyMock.mockResolvedValue(patients);
      patientCountMock.mockResolvedValue(3);

      const first = (await GET(createRequest(`?scope=all&limit=1&sort=${sort}`), {
        params: Promise.resolve({}),
      }))!;
      const firstJson = await first.json();
      expect(firstJson.data.map((card: { patient_id: string }) => card.patient_id)).toEqual([
        expected[0],
      ]);
      expect(firstJson.meta.next_cursor).toEqual(expect.any(String));

      const second = (await GET(
        createRequest(
          `?scope=all&limit=1&sort=${sort}&cursor=${encodeURIComponent(firstJson.meta.next_cursor)}`,
        ),
        { params: Promise.resolve({}) },
      ))!;
      const secondJson = await second.json();
      expect(secondJson.data.map((card: { patient_id: string }) => card.patient_id)).toEqual([
        expected[1],
      ]);
      expect(secondJson.meta).toMatchObject({ total_count: 3, has_more: true });
    },
  );
}
