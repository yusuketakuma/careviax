import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createRequest,
  setupVisitPreparationGetMocks,
  visitPreparationRouteTestMocks,
} from './route-support';
import { GET } from '../route';

const {
  visitScheduleFindFirstMock,
  visitRecordFindFirstMock,
  visitRecordFindManyMock,
  medicationCycleFindManyMock,
  peerVisitScheduleFindManyMock,
  prescriptionIntakeFindManyMock,
  conferenceNoteFindManyMock,
  patientHomeCareFeatureSummaryMock,
  scheduleVisitBriefMock,
} = visitPreparationRouteTestMocks;

describe('/api/visit-preparations/[scheduleId] GET', () => {
  const originalTimeZone = process.env.TZ;

  beforeAll(() => {
    process.env.TZ = 'Asia/Tokyo';
  });

  afterAll(() => {
    if (originalTimeZone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTimeZone;
    }
  });

  beforeEach(setupVisitPreparationGetMocks);

  it('summarizes previous visit dates by the local pharmacy calendar day', async () => {
    visitRecordFindFirstMock.mockResolvedValue({
      id: 'record_1',
      visit_date: new Date('2026-03-19T15:30:00.000Z'),
      outcome_status: 'completed',
      soap_plan: '残薬確認を強化する',
      version: 2,
      updated_at: new Date('2026-03-19T16:00:00.000Z'),
      structured_soap: null,
      next_visit_suggestion_date: new Date('2026-04-02T15:30:00.000Z'),
    });

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ scheduleId: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        pack: {
          previous_visit: expect.objectContaining({
            summary: expect.stringMatching(/前回 2026-03-20.*次回提案: 2026-04-03/),
          }),
        },
      },
    });
  });

  it('keeps duplicate same-drug prescription lines distinct in preparation change summaries', async () => {
    prescriptionIntakeFindManyMock.mockResolvedValueOnce([
      {
        id: 'intake_current_duplicate',
        source_type: 'paper',
        prescribed_date: new Date('2026-03-26T00:00:00Z'),
        lines: [
          {
            drug_name: 'ロキソプロフェン錠60mg',
            drug_code: '222',
            dose: '1回2錠',
            frequency: '夕食後',
            days: 7,
            start_date: new Date('2026-03-27T00:00:00Z'),
            end_date: new Date('2026-04-02T00:00:00Z'),
          },
        ],
      },
      {
        id: 'intake_previous_duplicate',
        source_type: 'paper',
        prescribed_date: new Date('2026-03-10T00:00:00Z'),
        lines: [
          {
            drug_name: 'ロキソプロフェン錠60mg',
            drug_code: '222',
            dose: '1回1錠',
            frequency: '朝食後',
            days: 7,
            start_date: new Date('2026-03-10T00:00:00Z'),
            end_date: new Date('2026-03-16T00:00:00Z'),
          },
          {
            drug_name: 'ロキソプロフェン錠60mg',
            drug_code: '222',
            dose: '1回1錠',
            frequency: '夕食後',
            days: 7,
            start_date: new Date('2026-03-10T00:00:00Z'),
            end_date: new Date('2026-03-16T00:00:00Z'),
          },
        ],
      },
    ]);

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ scheduleId: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        pack: {
          prescription_changes: {
            changed: [
              expect.objectContaining({
                drug_name: 'ロキソプロフェン錠60mg',
                drug_code: '222',
                previous_drug_name: 'ロキソプロフェン錠60mg',
                previous_drug_code: '222',
                reasons: ['用量 1回1錠 → 1回2錠'],
              }),
            ],
            removed: ['ロキソプロフェン錠60mg'],
            removed_medications: [{ drug_name: 'ロキソプロフェン錠60mg', drug_code: '222' }],
          },
        },
      },
    });
  });

  it('returns medication identities for initial prescription preparation summaries', async () => {
    prescriptionIntakeFindManyMock.mockResolvedValueOnce([
      {
        id: 'intake_initial',
        source_type: 'paper',
        prescribed_date: new Date('2026-03-26T00:00:00Z'),
        lines: [
          {
            drug_name: '同名薬',
            drug_code: 'YJ001',
            dose: '1回1錠',
            frequency: '朝食後',
            days: 7,
            start_date: new Date('2026-03-27T00:00:00Z'),
            end_date: new Date('2026-04-02T00:00:00Z'),
          },
          {
            drug_name: '同名薬',
            drug_code: null,
            dose: '1回1錠',
            frequency: '夕食後',
            days: 7,
            start_date: new Date('2026-03-27T00:00:00Z'),
            end_date: new Date('2026-04-02T00:00:00Z'),
          },
        ],
      },
    ]);

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ scheduleId: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        pack: {
          prescription_changes: {
            added: ['同名薬', '同名薬'],
            added_medications: [
              { drug_name: '同名薬', drug_code: 'YJ001' },
              { drug_name: '同名薬', drug_code: null },
            ],
            changed: [],
            removed: [],
            removed_medications: [],
          },
        },
      },
    });
  });

  it('rejects blank schedule ids before schedule lookup', async () => {
    const response = await GET(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ scheduleId: '   ' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    await expect(response.json()).resolves.toMatchObject({
      message: '訪問予定IDが不正です',
    });
    expect(visitScheduleFindFirstMock).not.toHaveBeenCalled();
    expect(scheduleVisitBriefMock).not.toHaveBeenCalled();
  });

  it('returns no-store not found before loading preparation dependencies', async () => {
    visitScheduleFindFirstMock.mockResolvedValueOnce(null);

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ scheduleId: 'schedule_missing' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    await expect(response.json()).resolves.toMatchObject({
      message: '訪問予定が見つかりません',
    });
    expect(visitRecordFindManyMock).not.toHaveBeenCalled();
    expect(medicationCycleFindManyMock).not.toHaveBeenCalled();
    expect(scheduleVisitBriefMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when preparation loading fails unexpectedly', async () => {
    visitScheduleFindFirstMock.mockRejectedValueOnce(
      new Error('患者 山田太郎 住所 東京都港区1-1-1 raw visit preparation detail'),
    );

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ scheduleId: 'schedule_1' }),
    });

    expect(response.status).toBe(500);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');

    const json = await response.json();
    expect(json).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(JSON.stringify(json)).not.toContain('山田太郎');
    expect(JSON.stringify(json)).not.toContain('東京都港区1-1-1');
    expect(JSON.stringify(json)).not.toContain('raw visit preparation detail');
  });

  it('ignores malformed conference JSON sections and sync summaries', async () => {
    conferenceNoteFindManyMock.mockResolvedValue([
      {
        id: 'conf_malformed',
        note_type: 'pre_discharge',
        title: '退院前カンファ',
        conference_date: new Date('2026-03-24T00:00:00Z'),
        participants: [
          ['unexpected'],
          { name: '病院薬剤師', role: 'hospital_pharmacist' },
          { name: 123, role: ['invalid'] },
        ],
        structured_content: {
          sections: [
            ['unexpected'],
            { key: 123, label: '退院予定日', body: '2026-03-27' },
            { key: 'target_discharge_date', label: ['invalid'], body: 123 },
            { key: 'next_visit_plan', label: '初回訪問計画', body: '退院翌週に初回訪問' },
          ],
        },
        metadata: {
          sync_summary: {
            visit_proposal_id: 123,
            report_draft_ids: ['report_1', 456],
            tasks_created: 2,
          },
        },
        action_items: [['unexpected'], { title: 123 }, { title: '退院時変更薬を確認する' }],
      },
    ]);

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ scheduleId: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        pack: {
          conference_context: [
            {
              participants: [
                { name: '病院薬剤師', role: 'hospital_pharmacist' },
                { name: null, role: null },
              ],
              highlights: ['初回訪問計画: 退院翌週に初回訪問'],
              action_items: ['退院時変更薬を確認する'],
              sync_summary: {
                billing_candidate_id: null,
                visit_proposal_id: null,
                report_draft_ids: ['report_1'],
                tasks_created: 2,
              },
            },
          ],
        },
      },
    });
  });

  it('includes intake_context with structured scheduling preference and home_visit_intake fields', async () => {
    visitScheduleFindFirstMock.mockResolvedValue({
      id: 'schedule_1',
      case_id: 'case_1',
      scheduled_date: new Date('2026-03-27T00:00:00Z'),
      time_window_start: new Date('1970-01-01T10:00:00Z'),
      time_window_end: new Date('1970-01-01T11:00:00Z'),
      schedule_status: 'planned',
      priority: 'normal',
      pharmacist_id: 'user_1',
      assignment_mode: 'primary',
      escalation_reason: null,
      confirmed_at: null,
      site: null,
      preparation: null,
      override_request: null,
      applied_override: null,
      case_: {
        id: 'case_1',
        primary_pharmacist_id: 'user_1',
        backup_pharmacist_id: null,
        required_visit_support: {
          home_visit_intake: {
            money_management: 'family',
            family_key_person: '長男 田中',
            care_level: 'care_2',
            adl_level: 'a',
            dementia_level: 'i',
            special_medical_procedures: ['narcotics', 'home_oxygen'],
            special_medical_notes: '麻薬処方あり',
            narcotics_base: true,
            narcotics_rescue: false,
            infection_isolation: 'contact',
            residual_medication_status: 'none',
            medication_support_methods: ['unit_dose'],
          },
        },
        management_plans: [],
        patient: {
          id: 'patient_1',
          name: '田中 三郎',
          residences: [{ address: '東京都新宿区1-1-1', building_id: null }],
          contacts: [],
          consents: [],
          scheduling_preference: {
            visit_before_contact_required: true,
            first_visit_preferred_date: null,
            first_visit_time_slot: 'morning',
            first_visit_time_note: '9時以降希望',
            parking_available: false,
            primary_contact_preference: 'phone',
            mcs_linked: true,
          },
        },
        care_team_links: [],
      },
    });

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ scheduleId: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        pack: {
          intake_context: {
            // from scheduling_preference (HVI-01B structured fields)
            visit_before_contact_required: true,
            first_visit_time_slot: 'morning',
            first_visit_time_note: '9時以降希望',
            parking_available: false,
            primary_contact_preference: 'phone',
            mcs_linked: true,
            // from home_visit_intake JSON (HVI-01C)
            money_management: 'family',
            special_medical_procedures: ['narcotics', 'home_oxygen'],
            infection_isolation: 'contact',
            narcotics_base: true,
          },
        },
      },
    });
  });

  it('allows an org-wide pharmacist who is not assigned to the visit or case but withholds parallel-visit context', async () => {
    visitScheduleFindFirstMock.mockResolvedValueOnce({
      id: 'schedule_1',
      case_id: 'case_1',
      scheduled_date: new Date('2026-03-27T00:00:00Z'),
      time_window_start: null,
      time_window_end: null,
      visit_type: 'regular',
      schedule_status: 'planned',
      priority: 'normal',
      pharmacist_id: 'user_other',
      facility_batch_id: null,
      facility_batch: null,
      route_order: null,
      medication_start_date: null,
      medication_end_date: null,
      assignment_mode: 'primary',
      escalation_reason: null,
      confirmed_at: null,
      site: null,
      visit_record: null,
      preparation: null,
      override_request: null,
      applied_override: null,
      case_: {
        id: 'case_1',
        primary_pharmacist_id: 'user_primary',
        backup_pharmacist_id: null,
        required_visit_support: null,
        patient: {
          id: 'patient_1',
          name: '山田 太郎',
          name_kana: 'ヤマダ タロウ',
          birth_date: new Date('1940-01-01T00:00:00Z'),
          gender: 'male',
          residences: [],
          contacts: [],
          consents: [],
          scheduling_preference: null,
        },
        care_team_links: [],
        management_plans: [],
      },
    });

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ scheduleId: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    // 並行訪問コンテキストは担当者(または owner/admin)に限定されるため、未担当の組織内薬剤師には公開しない。
    expect(peerVisitScheduleFindManyMock).not.toHaveBeenCalled();
    expect(patientHomeCareFeatureSummaryMock).toHaveBeenCalled();
  });

  it('builds the same grouped-visit context for same-home private visits', async () => {
    visitScheduleFindFirstMock.mockResolvedValue({
      id: 'home_schedule_1',
      case_id: 'home_case_1',
      scheduled_date: new Date('2026-03-27T00:00:00Z'),
      time_window_start: null,
      time_window_end: null,
      visit_type: 'regular',
      schedule_status: 'planned',
      priority: 'normal',
      pharmacist_id: 'user_1',
      facility_batch_id: null,
      facility_batch: null,
      route_order: 1,
      medication_start_date: null,
      medication_end_date: null,
      assignment_mode: 'primary',
      escalation_reason: null,
      confirmed_at: null,
      site: null,
      preparation: null,
      override_request: null,
      applied_override: null,
      case_: {
        id: 'home_case_1',
        primary_pharmacist_id: 'user_1',
        backup_pharmacist_id: null,
        required_visit_support: null,
        management_plans: [],
        patient: {
          id: 'home_patient_1',
          name: '山田 太郎',
          name_kana: 'ヤマダ タロウ',
          birth_date: new Date('1940-01-01T00:00:00Z'),
          gender: 'male',
          residences: [
            {
              address: '東京都港区個人宅1-1-1',
              facility_id: null,
              facility_unit_id: null,
              building_id: '山田宅',
              unit_name: null,
            },
          ],
          contacts: [],
          consents: [],
          scheduling_preference: null,
        },
        care_team_links: [],
      },
    });
    peerVisitScheduleFindManyMock.mockResolvedValue([
      {
        id: 'home_schedule_2',
        route_order: 2,
        schedule_status: 'planned',
        medication_start_date: null,
        medication_end_date: null,
        preparation: null,
        visit_record: null,
        case_: {
          patient: {
            id: 'home_patient_2',
            name: '山田 花子',
            name_kana: 'ヤマダ ハナコ',
            birth_date: new Date('1945-02-03T00:00:00Z'),
            gender: 'female',
            residences: [
              {
                address: '東京都港区個人宅1-1-1',
                facility_id: null,
                facility_unit_id: null,
                building_id: '山田宅',
                unit_name: null,
              },
            ],
          },
        },
      },
    ]);
    prescriptionIntakeFindManyMock.mockResolvedValue([]);

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ scheduleId: 'home_schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        pack: {
          facility_parallel_context: {
            label: '山田宅',
            place_kind: 'home_group',
            patients: [
              expect.objectContaining({
                schedule_id: 'home_schedule_1',
                patient_id: 'home_patient_1',
                patient_name: '山田 太郎',
                patient_name_kana: 'ヤマダ タロウ',
                patient_birth_date: '1940-01-01',
                patient_gender: 'male',
              }),
              expect.objectContaining({
                schedule_id: 'home_schedule_2',
                patient_id: 'home_patient_2',
                patient_name: '山田 花子',
                patient_name_kana: 'ヤマダ ハナコ',
                patient_birth_date: '1945-02-03',
                patient_gender: 'female',
              }),
            ],
          },
        },
      },
    });
  });
});
