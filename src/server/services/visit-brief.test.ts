import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  generateVisitBriefAiSummaryMock,
  listCommunicationQueueMock,
  listBillingEvidenceBlockersMock,
  buildPatientStateSnapshotMock,
} = vi.hoisted(() => ({
  generateVisitBriefAiSummaryMock: vi.fn(),
  listCommunicationQueueMock: vi.fn(),
  listBillingEvidenceBlockersMock: vi.fn(),
  buildPatientStateSnapshotMock: vi.fn(),
}));

vi.mock('./visit-brief-ai', () => ({
  generateVisitBriefAiSummary: generateVisitBriefAiSummaryMock,
}));

vi.mock('./patient-state-snapshot', () => ({
  buildPatientStateSnapshot: buildPatientStateSnapshotMock,
}));

vi.mock('./communication-queue', () => ({
  listCommunicationQueue: listCommunicationQueueMock,
}));

vi.mock('./billing-evidence', () => ({
  listBillingEvidenceBlockers: listBillingEvidenceBlockersMock,
}));

import {
  getPatientVisitBrief,
  getScheduleVisitBriefsForPatients,
  getScheduleVisitBriefsForSchedules,
} from './visit-brief';

const originalTimezone = process.env.TZ;

beforeAll(() => {
  process.env.TZ = 'Asia/Tokyo';
});

afterAll(() => {
  if (originalTimezone === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = originalTimezone;
  }
});

// patient_changes 結線テスト用の最小 db(全 delegate を空返しで満たす)
function buildMinimalBriefDb() {
  return {
    careCase: {
      findMany: vi.fn().mockResolvedValue([{ id: 'case_1' }]),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    patient: {
      findFirst: vi.fn().mockResolvedValue({ id: 'patient_1', name: '患者A' }),
    },
    prescriptionIntake: { findMany: vi.fn().mockResolvedValue([]) },
    medicationProfile: { findMany: vi.fn().mockResolvedValue([]) },
    setPlan: { findFirst: vi.fn().mockResolvedValue(null) },
    patientSelfReport: { findMany: vi.fn().mockResolvedValue([]) },
    communicationEvent: { findMany: vi.fn().mockResolvedValue([]) },
    communicationRequest: { findMany: vi.fn().mockResolvedValue([]) },
    visitScheduleContactLog: { findMany: vi.fn().mockResolvedValue([]) },
    task: { findMany: vi.fn().mockResolvedValue([]) },
    medicationIssue: { findMany: vi.fn().mockResolvedValue([]) },
    inquiryRecord: { findMany: vi.fn().mockResolvedValue([]) },
    billingEvidence: { findMany: vi.fn().mockResolvedValue([]) },
    visitRecord: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue({ soap_plan: null }),
    },
    medicationCycle: { findMany: vi.fn().mockResolvedValue([]) },
    drugMaster: { findMany: vi.fn().mockResolvedValue([]) },
    drugPackageInsert: { findMany: vi.fn().mockResolvedValue([]) },
    conferenceNote: { findMany: vi.fn().mockResolvedValue([]) },
    residence: { findFirst: vi.fn().mockResolvedValue(null) },
    jahisSupplementalRecord: { findMany: vi.fn().mockResolvedValue([]) },
    auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit_1' }) },
  };
}

const previousPatientSnapshot = {
  case_id: 'case_1',
  patient: { name: '患者A', phone: '090-0000-0000' },
  primary_residence: null,
  scheduling_preference: { care_level: '要介護2', infection_isolation: false },
  conditions: [],
  contacts: [],
  care_team_links: [],
  home_visit_intake: {
    special_medical_procedures: [],
    narcotics_base: false,
    narcotics_rescue: false,
  },
  insurances: [],
};
const currentPatientSnapshot = {
  ...previousPatientSnapshot,
  scheduling_preference: { care_level: '要介護4', infection_isolation: false },
};

describe('getPatientVisitBrief', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generateVisitBriefAiSummaryMock.mockResolvedValue({
      provider: 'rule',
      requested_provider: 'disabled',
      is_fallback: true,
      model: null,
      fallback_reason: 'provider_unavailable',
      headline: '直近処方で 2 件の変更があります。',
      bullets: ['処方変更: アムロジピン 5mg → 2.5mg'],
      must_check_today: ['直近の処方変更内容と残薬の整合'],
      source_refs: ['処方履歴'],
      generated_at: '2026-03-27T00:00:00.000Z',
    });
    listCommunicationQueueMock.mockResolvedValue({
      summary: {
        pending_count: 2,
        overdue_count: 1,
        self_reports: 1,
        callback_followups: 0,
        open_requests: 1,
        delivery_backlog: 1,
        expiring_external_shares: 0,
        unconfirmed_count: 1,
        reply_waiting_count: 1,
        failed_count: 0,
      },
      items: [],
      timeline: [
        {
          id: 'delivery_record:delivery_1',
          source_type: 'delivery_record',
          patient_id: 'patient_1',
          patient_name: '患者A',
          title: 'care_report の送達',
          summary: '訪看ステーション / fax / response_waiting',
          status: 'response_waiting',
          occurred_at: '2026-03-27T10:00:00.000Z',
          action_href: '/reports',
          action_label: '送達履歴を確認',
        },
      ],
      emergency_drafts: [],
    });
    listBillingEvidenceBlockersMock.mockResolvedValue([
      {
        id: 'billing_1',
        visit_record_id: 'visit_record_1',
        validation_notes: null,
        blockers: [
          {
            key: 'missing_visit_consent',
            reason: '同意未確認',
            action_href: '/workflow',
            action_label: '同意状況を確認',
            severity: 'urgent',
          },
        ],
      },
    ]);
  });

  it('aggregates prescription, dispensing, communication, and unresolved items', async () => {
    const db = {
      careCase: {
        findMany: vi.fn().mockResolvedValue([{ id: 'case_1' }]),
      },
      conferenceNote: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'conference_1',
            title: '退院前カンファレンス',
            conference_date: new Date('2026-03-20T00:00:00Z'),
            action_items: [
              { label: '訪問初回日の調整', converted_task_id: 'task_1' },
              { label: '家族へ持参薬説明', converted_task_id: null },
            ],
            metadata: {
              visit_brief: {
                summary: '退院直後の服薬支援を重点確認',
                highlighted_risks: ['転倒', 123, '', '飲み忘れ'],
              },
            },
          },
        ]),
      },
      patient: {
        findFirst: vi.fn().mockResolvedValue({ id: 'patient_1', name: '患者A' }),
      },
      patientLabObservation: {
        findMany: vi.fn().mockResolvedValue([
          {
            analyte_code: 'egfr',
            measured_at: new Date('2025-01-01T00:00:00Z'),
            value_numeric: 38,
            unit: 'mL/min/1.73m2',
            abnormal_flag: 'L',
          },
          {
            analyte_code: 'k',
            measured_at: new Date('2025-01-02T00:00:00Z'),
            value_numeric: 5.4,
            unit: 'mEq/L',
            abnormal_flag: 'H',
          },
        ]),
      },
      prescriptionIntake: {
        findMany: vi.fn().mockResolvedValue([
          {
            prescribed_date: new Date('2026-03-26T00:00:00Z'),
            prescriber_name: '田中医師',
            lines: [
              {
                drug_name: 'アムロジピン錠',
                drug_code: '123',
                dosage_form: '錠剤',
                dose: '2.5mg 1錠',
                frequency: '1日1回朝食後',
                route: 'internal',
                dispensing_method: 'unit_dose',
                packaging_instructions: '朝夕で一包化',
                start_date: new Date('2026-03-26T00:00:00Z'),
                end_date: new Date('2026-04-24T00:00:00Z'),
              },
              {
                drug_name: 'マグミット錠',
                drug_code: '456',
                dosage_form: '錠剤',
                dose: '330mg 2錠',
                frequency: '1日2回朝夕食後',
                route: 'internal',
                dispensing_method: null,
                packaging_instructions: null,
                start_date: new Date('2026-03-26T00:00:00Z'),
                end_date: new Date('2026-04-24T00:00:00Z'),
              },
              {
                drug_name: 'ロキソニンテープ',
                drug_code: '999',
                dosage_form: '貼付剤',
                dose: '1枚',
                frequency: '1日1回',
                route: 'external',
                dispensing_method: null,
                packaging_instructions: null,
                packaging_instruction_tags: [],
                notes: null,
                unit: '枚',
                start_date: new Date('2026-03-26T00:00:00Z'),
                end_date: new Date('2026-04-24T00:00:00Z'),
              },
            ],
          },
          {
            prescribed_date: new Date('2026-03-01T00:00:00Z'),
            prescriber_name: '田中医師',
            lines: [
              {
                drug_name: 'アムロジピン錠',
                drug_code: '123',
                dosage_form: '錠剤',
                dose: '5mg 1錠',
                frequency: '1日1回朝食後',
                route: 'internal',
                dispensing_method: null,
                packaging_instructions: null,
                start_date: new Date('2026-03-01T00:00:00Z'),
                end_date: new Date('2026-03-30T00:00:00Z'),
              },
              {
                drug_name: '睡眠薬A',
                drug_code: '789',
                dosage_form: '錠剤',
                dose: '1錠',
                frequency: '眠前',
                route: 'internal',
                dispensing_method: null,
                packaging_instructions: null,
                start_date: new Date('2026-03-01T00:00:00Z'),
                end_date: new Date('2026-03-30T00:00:00Z'),
              },
            ],
          },
        ]),
      },
      medicationProfile: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      setPlan: {
        findFirst: vi.fn().mockResolvedValue({
          set_method: 'facility_calendar',
          target_period_start: new Date('2026-03-26T15:30:00Z'),
          target_period_end: new Date('2026-04-01T15:30:00Z'),
          notes: '昼は別包',
          audits: [{ result: 'approved' }],
        }),
      },
      patientSelfReport: {
        findMany: vi.fn().mockResolvedValue([
          {
            subject: '飲み忘れあり',
            category: '副作用・体調変化',
            content: '朝夕の内服タイミングがずれて飲み忘れがある',
            status: 'submitted',
            reported_by_name: '家族A',
            requested_callback: true,
            created_at: new Date('2026-03-27T08:00:00Z'),
          },
        ]),
      },
      communicationEvent: {
        findMany: vi.fn().mockResolvedValue([
          {
            event_type: 'nurse_share',
            subject: '訪看連携',
            content: '午前の飲み忘れあり',
            counterpart_name: '訪看B',
            occurred_at: new Date('2026-03-27T07:00:00Z'),
            direction: 'inbound',
            channel: 'phone',
          },
        ]),
      },
      communicationRequest: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'request/1?x=y#frag',
            patient_id: 'patient_1',
            request_type: 'prescriber_followup',
            subject: '降圧薬の減量相談',
            content: 'ふらつき継続のため確認',
            related_entity_type: 'care_report',
            related_entity_id: 'report/1?x=y#frag',
            status: 'escalated',
            due_date: new Date('2026-03-27T12:00:00Z'),
            requested_at: new Date('2026-03-27T06:00:00Z'),
          },
        ]),
      },
      visitScheduleContactLog: {
        findMany: vi.fn().mockResolvedValue([
          {
            outcome: 'attempted',
            contact_name: '長男',
            note: '昼に再架電',
            callback_due_at: new Date('2026-03-27T11:00:00Z'),
            called_at: new Date('2026-03-27T09:00:00Z'),
          },
        ]),
      },
      task: {
        findMany: vi.fn().mockResolvedValue([
          {
            task_type: 'report_delivery_followup',
            title: '訪問前確認',
            description: '残薬チェックを完了してください',
            priority: 'high',
            related_entity_type: 'care_report',
            related_entity_id: 'report/2?x=y#frag',
          },
        ]),
      },
      medicationIssue: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'issue/1?x=y#frag',
            title: 'ふらつきリスク',
            description: '降圧薬調整の検討が必要',
            priority: 'high',
            category: '副作用',
          },
        ]),
      },
      inquiryRecord: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'inquiry/1?x=y#frag',
            reason: '用量疑義',
            inquiry_content: 'アムロジピン減量の適否を確認中',
          },
        ]),
      },
      billingEvidence: {
        findMany: vi.fn().mockResolvedValue([
          {
            exclusion_reason: '同意未確認',
            validation_notes: null,
          },
        ]),
      },
      visitRecord: {
        findMany: vi.fn().mockResolvedValue([{ id: 'visit_record_1' }]),
        findFirst: vi.fn().mockResolvedValue({
          soap_plan: '残薬確認を継続する',
        }),
      },
      medicationCycle: {
        findMany: vi.fn().mockResolvedValue([{ id: 'cycle_1' }]),
      },
      drugMaster: {
        findMany: vi.fn().mockResolvedValue([
          {
            yj_code: '123',
            drug_price: { toNumber: () => 12.5 },
            is_generic: false,
            is_narcotic: false,
            is_psychotropic: false,
            therapeutic_category: '2171',
          },
          {
            yj_code: '456',
            drug_price: { toNumber: () => 5.7 },
            is_generic: true,
            is_narcotic: false,
            is_psychotropic: false,
            therapeutic_category: '2344',
          },
        ]),
      },
      drugPackageInsert: {
        findMany: vi.fn().mockResolvedValue([
          {
            drug_master: { yj_code: '123', drug_name: 'アムロジピン錠' },
            contraindications: [
              '重度低血圧の患者',
              null,
              { text: '妊婦' },
              { value: 'ignored' },
              '',
            ],
            adverse_effects: [
              { text: '血管浮腫', severity: ' serious ' },
              'めまい',
              { description: '浮腫' },
              null,
            ],
            precautions_elderly: ['過度の降圧に注意', { name: '転倒に注意' }, 42],
          },
        ]),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue({ id: 'audit_1' }),
      },
    };

    const result = await getPatientVisitBrief(db, {
      orgId: 'org_1',
      patientId: 'patient_1',
      context: 'patient',
      caseIds: ['case_1'],
    });

    expect(result.patient).toEqual({ id: 'patient_1', name: '患者A' });
    // role/userId 未指定経路では前回訪問差分は算出されない(perf/後方互換のピン)
    expect(result.patient_changes).toEqual([]);
    expect(db.prescriptionIntake.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          cycle: expect.objectContaining({
            case_id: { in: ['case_1'] },
          }),
        }),
      }),
    );
    expect(db.setPlan.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          cycle: expect.objectContaining({
            case_id: { in: ['case_1'] },
          }),
        }),
      }),
    );
    expect(db.communicationRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: [{ OR: [{ case_id: null }, { case_id: { in: ['case_1'] } }] }],
        }),
      }),
    );
    expect(db.visitScheduleContactLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          case_id: { in: ['case_1'] },
        }),
      }),
    );
    expect(db.medicationIssue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: [{ OR: [{ case_id: null }, { case_id: { in: ['case_1'] } }] }],
        }),
      }),
    );
    expect(db.visitRecord.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          schedule: {
            case_id: { in: ['case_1'] },
          },
        }),
      }),
    );
    expect(db.patientLabObservation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          patient_id: 'patient_1',
          analyte_code: expect.objectContaining({
            in: expect.arrayContaining(['egfr', 'k', 'hba1c']),
          }),
        }),
        take: 50,
      }),
    );
    expect(listCommunicationQueueMock).toHaveBeenCalledWith(expect.anything(), {
      orgId: 'org_1',
      patientId: 'patient_1',
      caseIds: ['case_1'],
      limit: 6,
    });
    expect(result.medication_changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          drug_name: 'アムロジピン錠',
          drug_code: '123',
          change_type: 'dose_changed',
        }),
        expect.objectContaining({
          drug_name: '睡眠薬A',
          drug_code: '789',
          change_type: 'removed',
        }),
      ]),
    );
    expect(generateVisitBriefAiSummaryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        medicationChanges: expect.arrayContaining([
          'アムロジピン錠 [123] / dose_changed / 2.5mg 1錠 / 1日1回朝食後',
          '睡眠薬A [789] / removed / 中止',
        ]),
        fallbackBullets: expect.arrayContaining([expect.stringContaining('アムロジピン錠 [123]')]),
        latestLabs: expect.arrayContaining([
          'eGFR 38 mL/min/1.73m2 / 2025-01-01 / 異常L / 測定日確認',
          'K 5.4 mEq/L / 2025-01-02 / 異常H / 測定日確認',
        ]),
      }),
    );
    expect(result.drug_cautions).toHaveLength(7);
    expect(result.drug_cautions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          drug_name: 'アムロジピン錠',
          caution_type: 'contraindication',
          severity: 'critical',
          summary: '重度低血圧の患者',
        }),
        expect.objectContaining({
          caution_type: 'adverse_effect',
          severity: 'critical',
          summary: '血管浮腫',
        }),
        expect.objectContaining({
          caution_type: 'adverse_effect',
          severity: 'warning',
          summary: 'めまい',
        }),
        expect.objectContaining({
          caution_type: 'elderly_precaution',
          severity: 'warning',
          summary: '転倒に注意',
        }),
      ]),
    );
    expect(result.dispensing_items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          drug_name: 'アムロジピン錠',
          dispensing_method: '一包化',
          set_period_label: '2026-03-27 - 2026-04-02',
        }),
        expect.objectContaining({
          drug_name: 'ロキソニンテープ',
          outside_med_kind: 'topical',
          outside_med_label: '外用',
        }),
      ]),
    );
    expect(result.delivery_status).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: 'care_report の送達',
          status_bucket: 'reply_waiting',
        }),
      ]),
    );
    expect(result.latest_labs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          analyte_code: 'egfr',
          analyte_label: 'eGFR',
          value_label: '38 mL/min/1.73m2',
          measured_at_label: '2025-01-01',
          stale: true,
          abnormal: true,
          abnormal_flag: 'L',
        }),
        expect.objectContaining({
          analyte_code: 'k',
          analyte_label: 'K',
          value_label: '5.4 mEq/L',
          measured_at_label: '2025-01-02',
          stale: true,
          abnormal: true,
          abnormal_flag: 'H',
        }),
      ]),
    );
    expect(result.dosage_form_support).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'unit_dose',
        }),
      ]),
    );
    expect(result.multidisciplinary_updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source_type: 'self_report',
          counterpart: '家族A',
        }),
        expect.objectContaining({
          source_type: 'request',
          summary: '処方医フォロー / escalated / ふらつき継続のため確認',
          action_href:
            '/communications/requests?status=escalated&request_type=prescriber_followup&patient_id=patient_1&request_id=request%2F1%3Fx%3Dy%23frag&related_entity_type=care_report&related_entity_id=report%2F1%3Fx%3Dy%23frag',
          action_label: '依頼を確認',
        }),
      ]),
    );
    expect(result.unresolved_items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source_type: 'task',
          title: '訪問前確認',
          href: '/reports/report%2F2%3Fx%3Dy%23frag',
        }),
        expect.objectContaining({
          source_type: 'issue',
          title: 'ふらつきリスク',
          href: '/patients/patient_1/safety-check',
        }),
        expect.objectContaining({
          source_type: 'inquiry',
          title: '疑義照会 用量疑義',
          href: '/communications/requests?patient_id=patient_1&related_entity_type=inquiry_record&related_entity_id=inquiry%2F1%3Fx%3Dy%23frag',
        }),
      ]),
    );
    expect(result.must_check_today).toEqual(
      expect.arrayContaining(['直近の処方変更内容と残薬の整合', '一包化の運用と服薬タイミング']),
    );
    expect(result.rule_summary).toEqual(
      expect.objectContaining({
        headline: '訪問前確認 が未解決です。',
      }),
    );
    expect(generateVisitBriefAiSummaryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        patientName: '患者A',
        context: 'patient',
      }),
    );
    expect(listCommunicationQueueMock).toHaveBeenCalledWith(db, {
      orgId: 'org_1',
      patientId: 'patient_1',
      caseIds: ['case_1'],
      limit: 6,
    });
    expect(listBillingEvidenceBlockersMock).toHaveBeenCalledWith(db, {
      orgId: 'org_1',
      patientId: 'patient_1',
      visitRecordIds: ['visit_record_1'],
      cycleIds: ['cycle_1'],
      limit: 2,
    });
    expect(result.ai_summary.headline).toBe('直近処方で 2 件の変更があります。');
    expect(db.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'visit_brief_generated_fallback',
        target_type: 'visit_brief',
        changes: expect.objectContaining({
          patient_id: 'patient_1',
          context: 'patient',
          provider: 'rule',
          requested_provider: 'disabled',
          fallback_reason: 'provider_unavailable',
          source_refs: ['処方履歴'],
          generated_at: '2026-03-27T00:00:00.000Z',
        }),
      }),
    });
    expect(result.conference_summary).toEqual(
      expect.objectContaining({
        recent_conferences: 1,
        pending_action_items: 1,
        last_conference_type: '退院前カンファレンス',
        summary: '退院直後の服薬支援を重点確認',
        highlighted_risks: ['転倒', '飲み忘れ'],
      }),
    );
  });

  it('computes patient_changes when context=patient with role/userId and a previous snapshot', async () => {
    buildPatientStateSnapshotMock.mockResolvedValue(currentPatientSnapshot);
    const db = buildMinimalBriefDb();
    db.visitRecord.findFirst = vi.fn().mockResolvedValue({
      soap_plan: null,
      patient_state_snapshot: previousPatientSnapshot,
    });

    const result = await getPatientVisitBrief(db, {
      orgId: 'org_1',
      patientId: 'patient_1',
      context: 'patient',
      caseIds: ['case_1'],
      role: 'pharmacist',
      userId: 'user_1',
    });

    expect(buildPatientStateSnapshotMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ caseId: 'case_1', role: 'pharmacist', userId: 'user_1' }),
    );
    expect(result.patient_changes.length).toBeGreaterThan(0);
    expect(result.patient_changes.some((change) => change.category === 'care_level')).toBe(true);
  });

  it('returns empty patient_changes when role/userId are absent (no snapshot built)', async () => {
    const db = buildMinimalBriefDb();
    db.visitRecord.findFirst = vi.fn().mockResolvedValue({
      soap_plan: null,
      patient_state_snapshot: previousPatientSnapshot,
    });

    const result = await getPatientVisitBrief(db, {
      orgId: 'org_1',
      patientId: 'patient_1',
      context: 'patient',
      caseIds: ['case_1'],
    });

    expect(result.patient_changes).toEqual([]);
    expect(buildPatientStateSnapshotMock).not.toHaveBeenCalled();
  });
});

describe('getScheduleVisitBriefsForPatients', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generateVisitBriefAiSummaryMock.mockResolvedValue({
      provider: 'rule',
      requested_provider: 'disabled',
      is_fallback: true,
      model: null,
      fallback_reason: 'provider_unavailable',
      headline: '要点なし',
      bullets: [],
      must_check_today: [],
      source_refs: [],
      generated_at: '2026-03-27T00:00:00.000Z',
    });
    listCommunicationQueueMock.mockResolvedValue({
      summary: {
        pending_count: 0,
        overdue_count: 0,
        self_reports: 0,
        callback_followups: 0,
        open_requests: 0,
        delivery_backlog: 0,
        expiring_external_shares: 0,
        unconfirmed_count: 0,
        reply_waiting_count: 0,
        failed_count: 0,
      },
      items: [],
      timeline: [],
      emergency_drafts: [],
    });
    listBillingEvidenceBlockersMock.mockResolvedValue([]);
  });

  it('dedupes repeated patient ids before building schedule briefs', async () => {
    const db = {
      careCase: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      billingEvidence: { findMany: vi.fn().mockResolvedValue([]) },
      patient: {
        findFirst: vi.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve({ id: where.id, name: where.id === 'patient_1' ? '患者A' : '患者B' }),
        ),
      },
      prescriptionIntake: { findMany: vi.fn().mockResolvedValue([]) },
      medicationProfile: { findMany: vi.fn().mockResolvedValue([]) },
      setPlan: { findFirst: vi.fn().mockResolvedValue(null) },
      patientSelfReport: { findMany: vi.fn().mockResolvedValue([]) },
      communicationEvent: { findMany: vi.fn().mockResolvedValue([]) },
      communicationRequest: { findMany: vi.fn().mockResolvedValue([]) },
      visitScheduleContactLog: { findMany: vi.fn().mockResolvedValue([]) },
      task: { findMany: vi.fn().mockResolvedValue([]) },
      medicationIssue: { findMany: vi.fn().mockResolvedValue([]) },
      inquiryRecord: { findMany: vi.fn().mockResolvedValue([]) },
      visitRecord: { findFirst: vi.fn().mockResolvedValue(null) },
      medicationCycle: { findMany: vi.fn().mockResolvedValue([]) },
      conferenceNote: { findMany: vi.fn().mockResolvedValue([]) },
      residence: { findFirst: vi.fn().mockResolvedValue(null) },
      drugPackageInsert: { findMany: vi.fn().mockResolvedValue([]) },
    };

    const result = await getScheduleVisitBriefsForPatients(db, {
      orgId: 'org_1',
      patientIds: ['patient_1', 'patient_1', 'patient_2'],
    });

    expect(db.patient.findFirst).toHaveBeenCalledTimes(2);
    expect([...result.keys()]).toEqual(['patient_1', 'patient_2']);
    expect(result.get('patient_1')).toEqual(
      expect.objectContaining({
        patient: { id: 'patient_1', name: '患者A' },
        context: 'schedule',
      }),
    );
  });

  it('bounds concurrent schedule brief builds to protect DB and AI providers', async () => {
    const originalConcurrency = process.env.VISIT_BRIEF_BATCH_CONCURRENCY;
    process.env.VISIT_BRIEF_BATCH_CONCURRENCY = '2';
    let activePatientLookups = 0;
    let maxActivePatientLookups = 0;
    const db = {
      careCase: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      billingEvidence: { findMany: vi.fn().mockResolvedValue([]) },
      patient: {
        findFirst: vi.fn(async ({ where }: { where: { id: string } }) => {
          activePatientLookups += 1;
          maxActivePatientLookups = Math.max(maxActivePatientLookups, activePatientLookups);
          await new Promise((resolve) => setTimeout(resolve, 5));
          activePatientLookups -= 1;
          return { id: where.id, name: where.id };
        }),
      },
      prescriptionIntake: { findMany: vi.fn().mockResolvedValue([]) },
      medicationProfile: { findMany: vi.fn().mockResolvedValue([]) },
      setPlan: { findFirst: vi.fn().mockResolvedValue(null) },
      patientSelfReport: { findMany: vi.fn().mockResolvedValue([]) },
      communicationEvent: { findMany: vi.fn().mockResolvedValue([]) },
      communicationRequest: { findMany: vi.fn().mockResolvedValue([]) },
      visitScheduleContactLog: { findMany: vi.fn().mockResolvedValue([]) },
      task: { findMany: vi.fn().mockResolvedValue([]) },
      medicationIssue: { findMany: vi.fn().mockResolvedValue([]) },
      inquiryRecord: { findMany: vi.fn().mockResolvedValue([]) },
      visitRecord: { findFirst: vi.fn().mockResolvedValue(null) },
      medicationCycle: { findMany: vi.fn().mockResolvedValue([]) },
      conferenceNote: { findMany: vi.fn().mockResolvedValue([]) },
      residence: { findFirst: vi.fn().mockResolvedValue(null) },
      drugPackageInsert: { findMany: vi.fn().mockResolvedValue([]) },
    };

    try {
      const result = await getScheduleVisitBriefsForPatients(db, {
        orgId: 'org_1',
        patientIds: ['patient_1', 'patient_2', 'patient_3', 'patient_4', 'patient_5'],
      });

      expect(maxActivePatientLookups).toBeLessThanOrEqual(2);
      expect([...result.keys()]).toEqual([
        'patient_1',
        'patient_2',
        'patient_3',
        'patient_4',
        'patient_5',
      ]);
    } finally {
      if (originalConcurrency === undefined) {
        delete process.env.VISIT_BRIEF_BATCH_CONCURRENCY;
      } else {
        process.env.VISIT_BRIEF_BATCH_CONCURRENCY = originalConcurrency;
      }
    }
  });
});

describe('getScheduleVisitBriefsForSchedules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generateVisitBriefAiSummaryMock.mockResolvedValue({
      provider: 'rule',
      requested_provider: 'disabled',
      is_fallback: true,
      model: null,
      fallback_reason: 'provider_unavailable',
      headline: '要点なし',
      bullets: [],
      must_check_today: [],
      source_refs: [],
      generated_at: '2026-03-27T00:00:00.000Z',
    });
    listCommunicationQueueMock.mockResolvedValue({
      summary: {
        pending_count: 0,
        overdue_count: 0,
        self_reports: 0,
        callback_followups: 0,
        open_requests: 0,
        delivery_backlog: 0,
        expiring_external_shares: 0,
        unconfirmed_count: 0,
        reply_waiting_count: 0,
        failed_count: 0,
      },
      items: [],
      timeline: [],
      emergency_drafts: [],
    });
    listBillingEvidenceBlockersMock.mockResolvedValue([]);
  });

  it('builds schedule briefs with each schedule case scope', async () => {
    const db = {
      careCase: {
        findMany: vi.fn().mockResolvedValue([{ id: 'case_1' }, { id: 'case_2' }]),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      billingEvidence: { findMany: vi.fn().mockResolvedValue([]) },
      patient: {
        findFirst: vi.fn().mockResolvedValue({ id: 'patient_1', name: '患者A' }),
      },
      prescriptionIntake: { findMany: vi.fn().mockResolvedValue([]) },
      medicationProfile: { findMany: vi.fn().mockResolvedValue([]) },
      setPlan: { findFirst: vi.fn().mockResolvedValue(null) },
      patientSelfReport: { findMany: vi.fn().mockResolvedValue([]) },
      communicationEvent: { findMany: vi.fn().mockResolvedValue([]) },
      communicationRequest: { findMany: vi.fn().mockResolvedValue([]) },
      visitScheduleContactLog: { findMany: vi.fn().mockResolvedValue([]) },
      task: { findMany: vi.fn().mockResolvedValue([]) },
      medicationIssue: { findMany: vi.fn().mockResolvedValue([]) },
      inquiryRecord: { findMany: vi.fn().mockResolvedValue([]) },
      visitRecord: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      medicationCycle: { findMany: vi.fn().mockResolvedValue([]) },
      conferenceNote: { findMany: vi.fn().mockResolvedValue([]) },
      residence: { findFirst: vi.fn().mockResolvedValue(null) },
      drugPackageInsert: { findMany: vi.fn().mockResolvedValue([]) },
      drugMaster: { findMany: vi.fn().mockResolvedValue([]) },
    };

    const result = await getScheduleVisitBriefsForSchedules(db, {
      schedules: [
        {
          scheduleId: 'schedule_1',
          orgId: 'org_1',
          patientId: 'patient_1',
          caseId: 'case_1',
          scheduledDate: new Date('2026-06-10T00:00:00.000Z'),
        },
        {
          scheduleId: 'schedule_2',
          orgId: 'org_1',
          patientId: 'patient_1',
          caseId: 'case_2',
          scheduledDate: new Date('2026-06-17T00:00:00.000Z'),
        },
      ],
    });

    expect([...result.keys()]).toEqual(['schedule_1', 'schedule_2']);
    expect(db.visitScheduleContactLog.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({ case_id: { in: ['case_1'] } }),
      }),
    );
    expect(db.visitScheduleContactLog.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({ case_id: { in: ['case_2'] } }),
      }),
    );
    expect(db.visitRecord.findFirst).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          schedule_id: { not: 'schedule_1' },
          visit_date: { lt: new Date('2026-06-10T00:00:00.000Z') },
          schedule: { case_id: { in: ['case_1'] } },
        }),
      }),
    );
    expect(db.visitRecord.findFirst).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          schedule_id: { not: 'schedule_2' },
          visit_date: { lt: new Date('2026-06-17T00:00:00.000Z') },
          schedule: { case_id: { in: ['case_2'] } },
        }),
      }),
    );
  });

  it('builds independent schedule briefs for the same patient and case scope', async () => {
    const db = {
      careCase: {
        findMany: vi.fn().mockResolvedValue([{ id: 'case_1' }]),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      billingEvidence: { findMany: vi.fn().mockResolvedValue([]) },
      patient: {
        findFirst: vi.fn().mockResolvedValue({ id: 'patient_1', name: '患者A' }),
      },
      prescriptionIntake: { findMany: vi.fn().mockResolvedValue([]) },
      medicationProfile: { findMany: vi.fn().mockResolvedValue([]) },
      setPlan: { findFirst: vi.fn().mockResolvedValue(null) },
      patientSelfReport: { findMany: vi.fn().mockResolvedValue([]) },
      communicationEvent: { findMany: vi.fn().mockResolvedValue([]) },
      communicationRequest: { findMany: vi.fn().mockResolvedValue([]) },
      visitScheduleContactLog: { findMany: vi.fn().mockResolvedValue([]) },
      task: { findMany: vi.fn().mockResolvedValue([]) },
      medicationIssue: { findMany: vi.fn().mockResolvedValue([]) },
      inquiryRecord: { findMany: vi.fn().mockResolvedValue([]) },
      visitRecord: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      medicationCycle: { findMany: vi.fn().mockResolvedValue([]) },
      conferenceNote: { findMany: vi.fn().mockResolvedValue([]) },
      residence: { findFirst: vi.fn().mockResolvedValue(null) },
      drugPackageInsert: { findMany: vi.fn().mockResolvedValue([]) },
      drugMaster: { findMany: vi.fn().mockResolvedValue([]) },
    };

    const result = await getScheduleVisitBriefsForSchedules(db, {
      schedules: [
        {
          scheduleId: 'schedule_1',
          orgId: 'org_1',
          patientId: 'patient_1',
          caseId: 'case_1',
          scheduledDate: new Date('2026-06-10T00:00:00.000Z'),
        },
        {
          scheduleId: 'schedule_2',
          orgId: 'org_1',
          patientId: 'patient_1',
          caseId: 'case_1',
          scheduledDate: new Date('2026-06-10T00:00:00.000Z'),
        },
      ],
    });

    expect([...result.keys()]).toEqual(['schedule_1', 'schedule_2']);
    expect(result.get('schedule_1')).not.toBe(result.get('schedule_2'));
    expect(db.patient.findFirst).toHaveBeenCalledTimes(2);
    expect(db.visitScheduleContactLog.findMany).toHaveBeenCalledTimes(2);
    expect(generateVisitBriefAiSummaryMock).toHaveBeenCalledTimes(2);
  });
});
