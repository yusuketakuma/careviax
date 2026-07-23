import { expect, it, vi } from 'vitest';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';
import { getPatientBoardRouteTestSupport } from './route.test-support';

const {
  withAuthContextOptions,
  patientFindManyMock,
  patientCountMock,
  GET,
  createRequest,
  buildPatientRow,
} = getPatientBoardRouteTestSupport();

export function registerPatientBoardRouteCoreCases() {
  it('keeps the patient board read behind canViewDashboard', () => {
    expect(withAuthContextOptions).toContainEqual({
      permission: 'canViewDashboard',
      message: '患者情報の閲覧権限がありません',
    });
  });

  it('JST 朝(UTC では前日)でも visit_schedules を当日 UTC 深夜以降で絞り込む', async () => {
    vi.useFakeTimers();
    // JST 2026-06-12 08:00(UTC では 2026-06-11T23:00Z)
    vi.setSystemTime(new Date('2026-06-12T08:00:00+09:00'));

    const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);

    const select = patientFindManyMock.mock.calls[0][0].select;
    const scheduleWhere = select.cases.select.visit_schedules.where;
    expect(scheduleWhere.scheduled_date.gte.toISOString()).toBe('2026-06-12T00:00:00.000Z');
    expect(select.contacts).toMatchObject({
      orderBy: [
        { is_primary: 'desc' },
        { is_emergency_contact: 'desc' },
        { created_at: 'asc' },
        { id: 'asc' },
      ],
      take: 10,
    });
    expect(select.contacts.select).toMatchObject({
      is_primary: true,
      is_emergency_contact: true,
      phone: true,
      email: true,
      fax: true,
    });
    expect(select.cases.select.care_team_links).toMatchObject({
      orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }, { id: 'asc' }],
      take: 10,
    });
    expect(select.cases.select.care_team_links.select).toMatchObject({
      role: true,
      phone: true,
      email: true,
      fax: true,
      is_primary: true,
    });
    expect(select.cases.take).toBeUndefined();
    expect(select.cases.orderBy).toEqual([{ updated_at: 'desc' }, { id: 'desc' }]);
    expect(select.residences.select).toEqual({
      facility_id: true,
      building_id: true,
    });
    expect(select.lab_observations).toMatchObject({
      orderBy: [{ measured_at: 'desc' }, { id: 'desc' }],
      take: 1,
    });
    expect(
      select.cases.select.medication_cycles.select.prescription_intakes.select.lines,
    ).toMatchObject({
      orderBy: [{ line_number: 'asc' }, { id: 'asc' }],
      take: 50,
      select: {
        packaging_instruction_tags: true,
        dispensing_method: true,
      },
    });
    expect(select.cases.select.visit_schedules.select).toMatchObject({
      carry_items_status: true,
      preparation: {
        select: {
          prepared_at: true,
          medication_changes_reviewed: true,
          carry_items_confirmed: true,
          previous_issues_reviewed: true,
          route_confirmed: true,
          offline_synced: true,
        },
      },
    });
  });

  it('UTC 深夜で保存された当日の scheduled_date を「本日訪問」と判定する', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-12T08:00:00+09:00'));
    // @db.Date 規約どおり UTC 深夜で保存された「今日」の予定
    const patient = buildPatientRow(new Date('2026-06-12T00:00:00.000Z'));
    (
      patient.cases[0]!.visit_schedules[0]! as { time_window_start: Date | null }
    ).time_window_start = new Date(Date.UTC(1970, 0, 1, 9, 0));
    patientFindManyMock.mockResolvedValue([patient]);
    patientCountMock.mockResolvedValue(1);

    const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;
    expect(response.status).toBe(200);

    const bodyText = await response.clone().text();
    expect(response.headers.get('content-length')).toBe(
      String(new TextEncoder().encode(bodyText).length),
    );
    const json = JSON.parse(bodyText);
    expect(Object.keys(json).sort()).toEqual(['data', 'meta']);
    expect(json.meta.facets.chip_counts.visit_today).toBe(1);
    expect(json.data[0]).toMatchObject({
      attention: 'visit_today',
      next_visit_date: '2026-06-12',
      next_visit_time: '09:00',
      operation_summary: ['準備未完', '連絡先あり', '駐車場なし', '要介護 3'],
      foundation_summary: {
        status: 'needs_confirmation',
        label: '未確認1件',
        items: ['訪問準備未完'],
      },
      foundation_href: '/patients/patient_1#patient-foundation',
      link_label: '訪問へ',
      link_href: '/schedules?focus=schedule&schedule_id=schedule_1',
    });
    expect(JSON.stringify(json.data[0])).not.toContain('090-1111-2222');
    expect(json.meta).toMatchObject({
      assigned_total: 1,
      total_count: 1,
      returned_count: 1,
      has_more: false,
      next_cursor: null,
    });
  });

  it('UTC runtime の日本早朝でも日本業務日の予定を本日訪問として集計する', async () => {
    const previousTz = process.env.TZ;
    process.env.TZ = 'UTC';
    try {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-11T15:30:00.000Z'));
      const patient = buildPatientRow(new Date('2026-06-12T00:00:00.000Z'));
      (
        patient.cases[0]!.visit_schedules[0]! as { time_window_start: Date | null }
      ).time_window_start = new Date(Date.UTC(1970, 0, 1, 9, 0));
      patientFindManyMock.mockResolvedValue([
        patient,
        {
          ...buildPatientRow(new Date('2026-06-13T00:00:00.000Z')),
          id: 'patient_future',
          name: '未来 太郎',
        },
      ]);
      patientCountMock.mockResolvedValue(2);

      const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;

      expect(response.status).toBe(200);
      const select = patientFindManyMock.mock.calls[0][0].select;
      const scheduleWhere = select.cases.select.visit_schedules.where;
      expect(scheduleWhere.scheduled_date.gte.toISOString()).toBe('2026-06-12T00:00:00.000Z');
      const json = await response.json();
      expect(json.meta.facets.chip_counts.visit_today).toBe(1);
      expect(json.meta.facets.today_visit_count).toBe(1);
      expect(json.data[0]).toMatchObject({
        attention: 'visit_today',
        next_visit_date: '2026-06-12',
        next_visit_time: '09:00',
      });
      expect(json.data[1]).toMatchObject({
        patient_id: 'patient_future',
        attention: 'steady',
        next_visit_date: '2026-06-13',
        operation_summary: ['連絡先あり', '駐車場なし', '要介護 3'],
      });
      expect(json.data[1].operation_summary).not.toContain('準備未完');
      expect(json.data[1].operation_summary).not.toContain('訪問準備済');
    } finally {
      if (previousTz === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = previousTz;
      }
    }
  });

  it('keeps assigned_total separate from the filtered page metadata', async () => {
    vi.setSystemTime(new Date('2026-06-12T08:00:00+09:00'));
    patientFindManyMock.mockResolvedValue([buildPatientRow(new Date('2026-06-12T00:00:00.000Z'))]);
    patientCountMock.mockResolvedValue(30);

    const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.meta.assigned_total).toBe(30);
    expect(json.meta.total_count).toBe(1);
    expect(json.meta.count_basis).toMatchObject({
      total_count: 'filtered_result_exact',
      chip_counts: 'scope_search_foundation_exact',
      foundation_issue_counts: 'scope_search_without_active_foundation_issue_exact',
    });
    expect(json.data.length).toBe(1);
    expect(json.meta.has_more).toBe(false);
  });

  it('encodes patient card and schedule hrefs while preserving raw patient ids', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-12T08:00:00+09:00'));
    const fallbackPatientId = 'patient/1?tab=x#frag';
    const staticLinkPatientId = 'patient/2?tab=x#frag';
    const scheduleId = '../schedule with space?x=1#frag';
    const fallbackPatientHref = `/patients/${encodeURIComponent(fallbackPatientId)}`;
    const staticLinkPatientHref = `/patients/${encodeURIComponent(staticLinkPatientId)}`;
    const scheduleHref = `/schedules?focus=schedule&schedule_id=${encodeURIComponent(scheduleId)}`;
    const staticLinkPatient = buildPatientRow(new Date('2026-06-12T00:00:00.000Z'));
    staticLinkPatient.id = staticLinkPatientId;
    staticLinkPatient.name = '訪問 リンク';
    staticLinkPatient.cases[0]!.visit_schedules[0]!.id = scheduleId;
    patientFindManyMock.mockResolvedValue([
      {
        ...buildPatientRow(new Date('2026-06-20T00:00:00.000Z')),
        id: fallbackPatientId,
        name: 'カード 遷移',
        cases: [],
      },
      staticLinkPatient,
    ]);
    patientCountMock.mockResolvedValue(2);

    const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;
    expect(response.status).toBe(200);

    const json = await response.json();
    const cardsByPatientId = new Map(
      json.data.map((card: { patient_id: string }) => [card.patient_id, card]),
    );
    const fallbackCard = cardsByPatientId.get(fallbackPatientId);
    const staticLinkCard = cardsByPatientId.get(staticLinkPatientId);

    expect(fallbackCard).toMatchObject({
      patient_id: fallbackPatientId,
      link_label: 'カードへ',
      link_href: fallbackPatientHref,
      foundation_href: `${fallbackPatientHref}#patient-foundation`,
    });
    expect(staticLinkCard).toMatchObject({
      patient_id: staticLinkPatientId,
      link_label: '訪問へ',
      link_href: scheduleHref,
      foundation_href: `${staticLinkPatientHref}#patient-foundation`,
    });
    expect(JSON.stringify(json)).not.toContain(`/patients/${fallbackPatientId}`);
    expect(JSON.stringify(json)).not.toContain(`/patients/${staticLinkPatientId}`);
    expect(JSON.stringify(json)).not.toContain(scheduleId);
  });

  it('focuses reply-wait patient cards on the exact pending report', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-12T08:00:00+09:00'));
    const reportId = 'report/1?tab=x#frag';
    const patient = buildPatientRow(new Date('2026-06-20T00:00:00.000Z'));
    patient.cases[0]!.care_reports = [{ id: reportId, status: 'failed' }];
    patient.cases[0]!.medication_cycles = [
      {
        id: 'cycle_1',
        overall_status: 'reported',
        exception_status: 'report_failed',
        updated_at: new Date('2026-06-10T00:00:00.000Z'),
        prescription_intakes: [{ lines: [] }],
        inquiries: [],
        dispense_tasks: [],
        workflow_exceptions: [],
      },
    ];
    patientFindManyMock.mockResolvedValue([patient]);
    patientCountMock.mockResolvedValue(1);

    const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;
    expect(response.status).toBe(200);

    const select = patientFindManyMock.mock.calls[0][0].select;
    expect(select.cases.select.care_reports).toEqual({
      where: { status: { in: ['response_waiting', 'failed'] } },
      orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
      take: 1,
      select: {
        id: true,
        status: true,
      },
    });

    const json = await response.json();
    expect(json.data[0]).toMatchObject({
      patient_id: 'patient_1',
      attention: 'reply_wait',
      status_text: '報告先の返信待ち 1日 — 再送できます',
      link_label: '報告・共有へ',
      link_href: `/reports/${encodeURIComponent(reportId)}`,
    });
    expect(JSON.stringify(json.data[0])).not.toContain(reportId);
  });

  it('does not return primary residence full address in the board card payload', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-12T08:00:00+09:00'));
    patientFindManyMock.mockResolvedValue([
      {
        ...buildPatientRow(new Date('2026-06-12T00:00:00.000Z')),
        residences: [
          {
            address: '東京都千代田区丸の内1-1-1',
            facility: null,
            building_id: null,
          },
        ],
      },
    ]);
    patientCountMock.mockResolvedValue(1);

    const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.data[0]).not.toHaveProperty('address');
    expect(json.data[0]).toMatchObject({
      patient_id: 'patient_1',
      residence_kind: 'home',
      residence_label: '在宅',
    });
    expect(JSON.stringify(json)).not.toContain('東京都千代田区丸の内1-1-1');
  });

  it('does not expose facility names in the board residence label or search payload', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-12T08:00:00+09:00'));
    patientFindManyMock.mockResolvedValue([
      {
        ...buildPatientRow(new Date('2026-06-12T00:00:00.000Z')),
        residences: [
          {
            address: '東京都千代田区丸の内1-1-1',
            facility_id: 'facility_unique',
            facility: { name: '青空レジデンス丸の内' },
            building_id: null,
          },
        ],
      },
    ]);
    patientCountMock.mockResolvedValue(1);

    const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.data[0]).toMatchObject({
      residence_kind: 'facility',
      residence_label: '施設',
    });
    expect(JSON.stringify(json)).not.toContain('青空レジデンス丸の内');
    expect(JSON.stringify(json)).not.toContain('丸の内');
    expect(JSON.stringify(json)).not.toContain('東京都千代田区');
  });

  it.each(['partial', 'blocked'] as const)(
    'prepared_at があっても持参物ステータス %s なら患者ボードでは準備未完扱いにする',
    async (carryItemsStatus) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-12T08:00:00+09:00'));
      const patient = buildPatientRow(new Date('2026-06-12T00:00:00.000Z'));
      const careCase = patient.cases[0];
      patientFindManyMock.mockResolvedValue([
        {
          ...patient,
          cases: [
            {
              ...careCase,
              visit_schedules: [
                {
                  ...careCase.visit_schedules[0],
                  carry_items_status: carryItemsStatus,
                  preparation: {
                    prepared_at: new Date('2026-06-12T07:30:00+09:00'),
                    medication_changes_reviewed: true,
                    carry_items_confirmed: true,
                    previous_issues_reviewed: true,
                    route_confirmed: true,
                    offline_synced: true,
                  },
                },
              ],
            },
          ],
        },
      ]);
      patientCountMock.mockResolvedValue(1);

      const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;
      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.data[0]).toMatchObject({
        status_text: '本日訪問 — 出発前チェックを確認',
        operation_summary: ['準備未完', '連絡先あり', '駐車場なし', '要介護 3'],
        foundation_summary: {
          status: 'needs_confirmation',
          label: '未確認1件',
          items: ['訪問準備未完'],
        },
      });
      expect(JSON.stringify(json.data[0])).not.toContain('訪問準備済');
      expect(JSON.stringify(json.data[0])).not.toContain('準備完了');
    },
  );

  it('希望連絡先名だけでは患者カードを連絡先あり扱いにせず、連携先信頼性も同じ基準で未確認にする', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-12T08:00:00+09:00'));
    patientFindManyMock.mockResolvedValue([
      {
        ...buildPatientRow(new Date('2026-06-12T00:00:00.000Z')),
        scheduling_preference: {
          swallowing_route: null,
          preferred_contact_name: '長男',
          preferred_contact_phone: null,
          visit_before_contact_required: false,
          parking_available: true,
          care_level: 'care_3',
        },
        contacts: [],
        cases: [
          {
            id: 'case_newer_on_hold',
            status: 'on_hold',
            management_plans: [{ id: 'plan_on_hold', next_review_date: null }],
            care_team_links: [
              {
                role: 'physician',
                phone: '03-1111-1111',
                email: null,
                fax: '03-1111-1112',
                is_primary: true,
              },
              {
                role: 'nurse',
                phone: '03-2222-2222',
                email: null,
                fax: '03-2222-2223',
                is_primary: true,
              },
              {
                role: 'care_manager',
                phone: '03-3333-3333',
                email: null,
                fax: '03-3333-3334',
                is_primary: true,
              },
            ],
            medication_cycles: [],
            visit_schedules: [],
          },
          {
            id: 'case_active',
            status: 'active',
            management_plans: [{ id: 'plan_active', next_review_date: null }],
            care_team_links: [
              {
                role: 'physician',
                phone: '03-1111-1111',
                email: null,
                fax: null,
                is_primary: true,
              },
            ],
            medication_cycles: [],
            visit_schedules: [
              {
                scheduled_date: new Date('2026-06-12T00:00:00.000Z'),
                time_window_start: null,
                carry_items_status: 'ready',
                facility_batch_id: null,
                facility_batch: null,
                preparation: null,
              },
            ],
          },
        ],
      },
    ]);
    patientCountMock.mockResolvedValue(1);

    const response = (await GET(createRequest(), { params: Promise.resolve({}) }))!;
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.data[0]).toMatchObject({
      operation_summary: ['準備未完', '連絡先未設定', '駐車場あり', '要介護 3'],
      foundation_summary: {
        status: 'needs_confirmation',
        label: '未確認3件',
        items: ['連絡先未設定', '連携先1件', '訪問準備未完'],
      },
    });
  });

  it('filters board cards by foundation issue using the derived foundation summary', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-12T08:00:00+09:00'));
    patientFindManyMock.mockResolvedValue([
      buildPatientRow(new Date('2026-06-12T00:00:00.000Z')),
      {
        ...buildPatientRow(new Date('2026-06-13T00:00:00.000Z')),
        id: 'patient_missing_contact',
        name: '連絡 不足',
        scheduling_preference: {
          swallowing_route: null,
          preferred_contact_name: '長男',
          preferred_contact_phone: null,
          visit_before_contact_required: false,
          parking_available: true,
          care_level: 'care_3',
        },
        contacts: [],
      },
    ]);
    patientCountMock.mockResolvedValue(2);

    const response = (await GET(createRequest('?scope=all&foundation_issue=missing_contact'), {
      params: Promise.resolve({}),
    }))!;

    expect(response.status).toBe(200);
    expect(patientFindManyMock.mock.calls[0][0]).toMatchObject({
      where: expect.objectContaining({ org_id: 'org_1' }),
      orderBy: [{ name_kana: 'asc' }, { id: 'asc' }],
      take: 80,
    });
    const json = await response.json();
    expect(json.data).toHaveLength(1);
    expect(json.data[0]).toMatchObject({
      patient_id: 'patient_missing_contact',
      foundation_summary: {
        items: expect.arrayContaining(['連絡先未設定']),
      },
    });
    expect(json.meta.facets.foundation_issue_counts).toMatchObject({
      needs_confirmation: 2,
      missing_contact: 1,
    });
    expect(json.meta.assigned_total).toBe(2);
    expect(json.meta.total_count).toBe(1);
    expect(json.meta.has_more).toBe(false);
  });
}
