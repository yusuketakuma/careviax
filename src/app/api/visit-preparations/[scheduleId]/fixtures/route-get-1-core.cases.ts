import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createRequest,
  setupVisitPreparationGetMocks,
  visitPreparationRouteTestMocks,
} from './route-support';
import { GET } from '../route';

const {
  membershipFindFirstMock,
  visitScheduleFindFirstMock,
  visitRecordFindFirstMock,
  taskFindManyMock,
  taskFindFirstMock,
  visitScheduleContactLogFindManyMock,
  peerVisitScheduleFindManyMock,
  prescriptionIntakeFindManyMock,
  conferenceNoteFindManyMock,
  billingCandidateFindManyMock,
  billingEvidenceBlockersMock,
  patientHomeCareFeatureSummaryMock,
  scheduleFeatureHighlightsMock,
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

  it('returns preparation and pre-visit pack data', async () => {
    const response = await GET(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ scheduleId: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    expect(peerVisitScheduleFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          schedule_status: {
            in: ['planned', 'in_preparation', 'ready', 'departed', 'in_progress', 'completed'],
          },
        }),
      }),
    );
    expect(visitScheduleContactLogFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 4,
        orderBy: [{ called_at: 'desc' }],
        select: {
          outcome: true,
          contact_method: true,
          note: true,
          callback_due_at: true,
          called_at: true,
        },
      }),
    );
    const body = await response.json();
    expect(body).toMatchObject({
      data: {
        preparation: {
          id: 'prep_1',
        },
        pack: {
          patient: {
            name: '山田 太郎',
          },
          handoff: {
            assignment_mode: 'fallback',
          },
          readiness_blockers: ['薬歴・前回変更の確認', '前回課題の確認', 'オフライン同期確認'],
          facility_mode: {
            same_day_patient_count: 2,
            same_day_patient_names: expect.arrayContaining(['山田 太郎', '山田 花子']),
          },
          facility_parallel_context: {
            batch_id: 'batch_1',
            place_kind: 'facility',
            common_notes: '感染対策で受付に声かけしてから入室',
            site_name: '本店',
            current_schedule_id: 'schedule_1',
            patients: [
              expect.objectContaining({
                schedule_id: 'schedule_1',
                patient_id: 'patient_1',
                patient_name: '山田 太郎',
                patient_name_kana: 'ヤマダ タロウ',
                patient_birth_date: '1940-01-01',
                patient_gender: 'male',
                unit_name: '201',
                medication_start_date: '2026-03-27',
                medication_end_date: '2026-04-09',
                visit_record_id: 'record_current',
                visit_outcome_status: 'completed',
                preparation_blockers_count: 3,
              }),
              expect.objectContaining({
                schedule_id: 'schedule_2',
                patient_id: 'patient_2',
                patient_name: '山田 花子',
                patient_name_kana: 'ヤマダ ハナコ',
                patient_birth_date: '1945-02-03',
                patient_gender: 'female',
                preparation_blockers_count: 1,
              }),
            ],
          },
          care_team: [
            expect.objectContaining({
              name: '佐藤 医師',
            }),
          ],
          conference_context: [
            expect.objectContaining({
              note_type: 'pre_discharge',
              title: '退院前カンファ',
              highlights: expect.arrayContaining([
                expect.stringContaining('退院予定'),
                expect.stringContaining('初回訪問計画'),
              ]),
              action_items: expect.arrayContaining(['退院時変更薬を確認する']),
            }),
          ],
          home_care_feature_highlights: [
            expect.objectContaining({
              key: 'consent_plan_huddle',
              status: 'blocked',
            }),
          ],
          previous_visit: expect.objectContaining({
            source_revision: {
              version: 4,
              updated_at: '2026-03-20T08:30:00.000Z',
            },
            summary: expect.stringContaining('残薬確認を強化する'),
            structured_reuse: expect.objectContaining({
              source_visit_record_id: 'record_1',
              source_visit_record_version: 4,
              source_visit_record_updated_at: '2026-03-20T08:30:00.000Z',
              carry_forward_items: expect.arrayContaining([
                '眠気とふらつきの継続確認',
                '継続観察: 昼分の飲み忘れ',
                expect.stringContaining('前回残薬'),
                '副作用再確認: 眠気',
              ]),
              handoff: expect.objectContaining({
                next_check_items: ['眠気とふらつきの継続確認'],
                ongoing_monitoring: ['昼分の飲み忘れ'],
                decision_rationale: '前回残薬と副作用訴えあり',
              }),
            }),
          }),
          medication_period: {
            schedule_start_date: '2026-03-27',
            schedule_end_date: '2026-04-09',
            prescription_start_date: '2026-03-27',
            prescription_end_date: '2026-04-09',
          },
          billing_collection_context: {
            candidate_id: 'candidate_current',
            billing_name: '在宅患者訪問薬剤管理指導料',
            current_billed_amount: 3920,
            current_collection_amount: 3920,
            previous_unpaid_amount: 1080,
            total_collection_amount: 5000,
            collection_method: 'cash',
            collection_method_label: '現金',
            collection_timing: 'per_visit',
            collection_timing_label: '毎回',
            payer_name: '山田 次郎',
            payer_relation: '長男',
            receipt_issue: 'paper',
            receipt_issue_label: '紙',
            receipt_issue_status: 'not_issued',
            receipt_issue_status_label: '未発行',
            collector_user_id: 'user_billing',
          },
          prescription_changes: {
            added: ['アムロジピンOD錠5mg'],
            added_medications: [{ drug_name: 'アムロジピンOD錠5mg', drug_code: '111' }],
            changed: [
              expect.objectContaining({
                drug_name: 'ロキソプロフェン錠60mg',
                drug_code: '222',
                previous_drug_code: '222',
              }),
            ],
            removed: ['マグミット錠330mg'],
            removed_medications: [{ drug_name: 'マグミット錠330mg', drug_code: '333' }],
          },
          visit_brief: {
            context: 'schedule',
            ai_summary: {
              provider: 'rule',
            },
          },
          open_tasks: [
            expect.objectContaining({
              title: '訪問準備が未完了です',
              action_label: '準備を完了',
            }),
          ],
          recent_contact_logs: [
            {
              outcome: 'attempted',
              contact_method: 'phone',
              has_note: true,
              callback_due_at: '2026-03-26T09:00:00.000Z',
              called_at: '2026-03-26T08:00:00.000Z',
            },
            {
              outcome: 'confirmed',
              contact_method: 'email',
              has_note: false,
              callback_due_at: null,
              called_at: '2026-03-25T08:00:00.000Z',
            },
          ],
          onboarding_readiness: expect.objectContaining({
            consent_obtained: true,
            emergency_contact_set: true,
            first_visit_doc_delivered: true,
          }),
          emergency_contacts: [
            expect.objectContaining({
              name: '山田 次郎',
            }),
          ],
          first_visit_document: expect.objectContaining({
            delivered_to: '山田 次郎',
          }),
        },
      },
    });
    expect(JSON.stringify(body.data.pack.recent_contact_logs)).not.toContain('log_1');
    expect(JSON.stringify(body.data.pack.recent_contact_logs)).not.toContain('log_2');
    expect(JSON.stringify(body.data.pack.recent_contact_logs)).not.toContain('家族A');
    expect(JSON.stringify(body.data.pack.recent_contact_logs)).not.toContain('家族B');
    expect(JSON.stringify(body.data.pack.recent_contact_logs)).not.toContain('090-0000-0000');
    expect(JSON.stringify(body.data.pack.recent_contact_logs)).not.toContain('080-1111-2222');
    expect(JSON.stringify(body.data.pack.recent_contact_logs)).not.toContain('夕方に再架電予定');
    expect(JSON.stringify(body.data.pack.recent_contact_logs)).not.toContain('user_1');
    expect(JSON.stringify(body.data.pack.recent_contact_logs)).not.toContain('user_2');
    expect(JSON.stringify(body.data.pack.recent_contact_logs)).not.toContain('contact-key-secret');
    expect(JSON.stringify(body.data.pack.recent_contact_logs)).not.toContain(
      'contact-fingerprint-secret',
    );
    expect(patientHomeCareFeatureSummaryMock).toHaveBeenCalledWith(expect.anything(), {
      orgId: 'org_1',
      patientId: 'patient_1',
    });
    expect(scheduleFeatureHighlightsMock).toHaveBeenCalledOnce();
    expect(scheduleVisitBriefMock).toHaveBeenCalledWith(expect.anything(), {
      orgId: 'org_1',
      patientId: 'patient_1',
      caseIds: ['case_1'],
      currentScheduleId: 'schedule_1',
      scheduledDate: new Date('2026-03-27T00:00:00Z'),
      billingContext: {
        visitRecordIds: ['record_1'],
        cycleIds: ['cycle_1'],
        blockers: [],
      },
    });
    expect(billingEvidenceBlockersMock).toHaveBeenCalledWith(expect.anything(), {
      orgId: 'org_1',
      patientId: 'patient_1',
      visitRecordIds: ['record_1'],
      cycleIds: ['cycle_1'],
      limit: 4,
    });
    expect(billingCandidateFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          patient_id: 'patient_1',
          cycle_id: { in: ['cycle_1'] },
          status: { not: 'excluded' },
        }),
      }),
    );
    expect(billingCandidateFindManyMock.mock.calls[0]?.[0]).not.toHaveProperty('take');
    expect(taskFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          task_type: 'patient_billing_payment_profile',
          related_entity_type: 'patient',
          related_entity_id: 'patient_1',
        }),
      }),
    );
    expect(prescriptionIntakeFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          cycle: expect.objectContaining({
            patient_id: 'patient_1',
            case_id: 'case_1',
          }),
        }),
      }),
    );
    expect(conferenceNoteFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ case_id: 'case_1' }, { patient_id: 'patient_1', case_id: null }],
        }),
      }),
    );
  });

  it('starts independent visit-context reads while billing reads are still pending', async () => {
    let releaseBillingCandidates!: () => void;
    let billingCandidatesResolved = false;
    const pendingBillingCandidates = new Promise<never[]>((resolve) => {
      releaseBillingCandidates = () => {
        billingCandidatesResolved = true;
        resolve([]);
      };
    });
    billingCandidateFindManyMock.mockReturnValueOnce(pendingBillingCandidates);

    const responsePromise = GET(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ scheduleId: 'schedule_1' }),
    });

    await vi.waitFor(() => {
      expect(visitRecordFindFirstMock).toHaveBeenCalledOnce();
      expect(taskFindManyMock).toHaveBeenCalledOnce();
      expect(visitScheduleContactLogFindManyMock).toHaveBeenCalledOnce();
      expect(peerVisitScheduleFindManyMock).toHaveBeenCalledOnce();
    });
    expect(billingCandidatesResolved).toBe(false);

    releaseBillingCandidates();
    await expect(responsePromise).resolves.toMatchObject({ status: 200 });
  });

  it('projects outside-med classification from the latest prescription lines (§11-7)', async () => {
    const startDate = new Date('2026-03-27T00:00:00Z');
    const endDate = new Date('2026-04-09T00:00:00Z');
    prescriptionIntakeFindManyMock.mockResolvedValue([
      {
        id: 'intake_current',
        source_type: 'paper',
        prescribed_date: new Date('2026-03-26T00:00:00Z'),
        lines: [
          {
            id: 'line_topical',
            drug_name: 'モーラステープ',
            drug_code: 'T1',
            dose: '1日1枚',
            frequency: '1日1回',
            days: 14,
            start_date: startDate,
            end_date: endDate,
            route: 'external',
            dosage_form: '貼付剤',
            unit: '枚',
            packaging_instructions: null,
            packaging_instruction_tags: [],
            notes: null,
          },
          {
            id: 'line_cold',
            drug_name: 'ナウゼリン坐剤',
            drug_code: 'C1',
            dose: '1回1個',
            frequency: '発熱時',
            days: 5,
            start_date: startDate,
            end_date: endDate,
            route: 'internal',
            dosage_form: '坐剤',
            unit: '個',
            packaging_instructions: null,
            packaging_instruction_tags: ['cold_storage'],
            notes: null,
          },
          {
            id: 'line_prn',
            drug_name: 'ロキソプロフェン錠60mg',
            drug_code: 'P1',
            dose: '1回1錠',
            frequency: '疼痛時',
            days: 7,
            start_date: startDate,
            end_date: endDate,
            route: 'internal',
            dosage_form: '錠',
            unit: '錠',
            packaging_instructions: null,
            packaging_instruction_tags: [],
            notes: null,
          },
          {
            id: 'line_plain',
            drug_name: 'アムロジピンOD錠5mg',
            drug_code: 'A1',
            dose: '1回1錠',
            frequency: '1日1回朝食後',
            days: 14,
            start_date: startDate,
            end_date: endDate,
            route: 'internal',
            dosage_form: '錠',
            unit: '錠',
            packaging_instructions: null,
            packaging_instruction_tags: [],
            notes: null,
          },
        ],
      },
    ]);

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ scheduleId: 'schedule_1' }),
    });
    if (!response) throw new Error('response is required');
    const body = await response.json();

    // 外用/冷所/頓服が同一語彙で projection され、通常内服(line_plain)はその他薬でないため除外される。
    // 冷所は頓服シグナル(発熱時)より優先される。
    expect(body.data.pack.outside_meds).toEqual([
      {
        line_id: 'line_topical',
        drug_name: 'モーラステープ',
        outside_med_kind: 'topical',
        outside_med_label: '外用',
      },
      {
        line_id: 'line_cold',
        drug_name: 'ナウゼリン坐剤',
        outside_med_kind: 'cold',
        outside_med_label: '冷所',
      },
      {
        line_id: 'line_prn',
        drug_name: 'ロキソプロフェン錠60mg',
        outside_med_kind: 'prn',
        outside_med_label: '頓服',
      },
    ]);
    expect(
      body.data.pack.outside_meds.map((item: { line_id: string }) => item.line_id),
    ).not.toContain('line_plain');
  });

  it('masks billing payer and receipt details for visit users without billing permission', async () => {
    membershipFindFirstMock.mockResolvedValueOnce({ role: 'pharmacist_trainee' });

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ scheduleId: 'schedule_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        pack: {
          billing_collection_context: {
            current_collection_amount: 3920,
            previous_unpaid_amount: 1080,
            total_collection_amount: 5000,
            collection_method_label: '現金',
            payer_name: null,
            payer_relation: null,
            receipt_number: null,
            collector_user_id: null,
          },
        },
      },
    });
  });

  it.each(['partial', 'blocked'] as const)(
    'includes unresolved carry item status %s in readiness blockers',
    async (carryItemsStatus) => {
      const baseSchedule = await visitScheduleFindFirstMock();
      visitScheduleFindFirstMock.mockClear();
      visitScheduleFindFirstMock.mockResolvedValueOnce({
        ...baseSchedule,
        carry_items_status: carryItemsStatus,
      });

      const response = await GET(createRequest({ 'x-org-id': 'org_1' }), {
        params: Promise.resolve({ scheduleId: 'schedule_1' }),
      });

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        data: {
          pack: {
            readiness_blockers: [
              '持参物ステータス未解決',
              '薬歴・前回変更の確認',
              '前回課題の確認',
              'オフライン同期確認',
            ],
          },
        },
      });
      expect(visitScheduleFindFirstMock).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            carry_items_status: true,
          }),
        }),
      );
      expect(visitRecordFindFirstMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            schedule: { case_id: 'case_1' },
            schedule_id: { not: 'schedule_1' },
            visit_date: { lt: new Date('2026-03-27T00:00:00.000Z') },
          }),
          orderBy: [{ visit_date: 'desc' }, { created_at: 'desc' }, { id: 'desc' }],
        }),
      );
    },
  );
});
