import { describe, expect, it } from 'vitest';
import {
  buildPatientBoardFoundationIssueCounts,
  comparePatientBoardCards,
  derivePatientBoardCard,
  matchesPatientBoardFoundationIssue,
  type DerivedPatientBoardCard,
  type PatientBoardQueryRow,
} from './patient-board-card-model';

function buildPatientRow(overrides: Partial<PatientBoardQueryRow> = {}): PatientBoardQueryRow {
  return {
    id: 'patient_1',
    name: '佐藤 花子',
    name_kana: 'サトウ ハナコ',
    birth_date: new Date('1940-01-15T00:00:00.000Z'),
    medical_insurance_number: null,
    care_insurance_number: null,
    allergy_info: 'なし',
    scheduling_preference: {
      swallowing_route: null,
      preferred_contact_name: '家族連絡先',
      preferred_contact_phone: null,
      visit_before_contact_required: false,
      parking_available: null,
      care_level: null,
    },
    contacts: [
      {
        is_primary: true,
        is_emergency_contact: false,
        phone: '090-RAW-PHI',
        email: null,
        fax: null,
      },
    ],
    residences: [
      {
        facility_id: 'facility_1',
        building_id: null,
        address: '東京都千代田区',
        facility_name: '青空レジデンス',
      } as unknown as PatientBoardQueryRow['residences'][number],
    ],
    lab_observations: [{ id: 'lab_1' }],
    consents: [],
    cases: [
      {
        id: 'case_1',
        status: 'active',
        management_plans: [],
        care_team_links: [],
        care_reports: [],
        medication_cycles: [
          {
            id: 'cycle_1',
            overall_status: 'set_audited',
            exception_status: null,
            updated_at: new Date('2026-06-11T09:00:00+09:00'),
            prescription_intakes: [
              {
                lines: [
                  {
                    packaging_instruction_tags: ['cold_storage'],
                    dispensing_method: 'unit_dose',
                  },
                ],
              },
            ],
            inquiries: [],
            dispense_tasks: [],
            workflow_exceptions: [],
          },
        ],
        visit_schedules: [
          {
            id: 'schedule_1',
            scheduled_date: new Date('2026-06-12T00:00:00.000Z'),
            time_window_start: new Date(Date.UTC(1970, 0, 1, 9, 0)),
            carry_items_status: 'ready',
            facility_batch_id: null,
            facility_batch: null,
            preparation: {
              prepared_at: new Date('2026-06-11T18:00:00+09:00'),
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
    ...overrides,
  };
}

function buildCard(overrides: Partial<DerivedPatientBoardCard>): DerivedPatientBoardCard {
  return {
    patient_id: 'patient',
    name: '患者',
    age: 80,
    residence_kind: 'home',
    residence_label: '在宅',
    attention: 'steady',
    safety_tags: [],
    next_visit_date: null,
    next_visit_time: null,
    next_visit_label: null,
    current_step: null,
    status_text: '状態',
    status_tone: 'neutral',
    operation_summary: [],
    foundation_summary: { status: 'ready', label: '確認済', items: [] },
    foundation_issue_keys: [],
    foundation_href: '/patients/patient#patient-foundation',
    link_label: 'カードへ',
    link_href: '/patients/patient',
    facility_batch_id: null,
    facility_batch_patient_count: 0,
    ...overrides,
  };
}

describe('patient-board-card-model', () => {
  it('derives a PHI-minimized visit-today card with encoded patient and schedule links', () => {
    const rawPatientId = 'patient/1?tab=x#frag';
    const rawScheduleId = '../schedule with space?x=1#frag';
    const card = derivePatientBoardCard(
      buildPatientRow({
        id: rawPatientId,
        cases: [
          {
            ...buildPatientRow().cases[0]!,
            visit_schedules: [
              {
                ...buildPatientRow().cases[0]!.visit_schedules[0]!,
                id: rawScheduleId,
              },
            ],
          },
        ],
      }),
      new Date('2026-06-11T15:30:00.000Z'),
    );

    expect(card).toMatchObject({
      patient_id: rawPatientId,
      attention: 'visit_today',
      next_visit_date: '2026-06-12',
      next_visit_time: '09:00',
      foundation_href: `/patients/${encodeURIComponent(rawPatientId)}#patient-foundation`,
      link_href: `/schedules?focus=schedule&schedule_id=${encodeURIComponent(rawScheduleId)}`,
    });
    expect(card.foundation_issue_keys).toEqual(
      expect.arrayContaining([
        'missing_consent_plan',
        'missing_parking',
        'missing_care_level',
        'missing_insurance',
        'missing_care_team',
      ]),
    );
    const serialized = JSON.stringify(card);
    expect(serialized).not.toContain('090-RAW-PHI');
    expect(serialized).not.toContain('東京都千代田区');
    expect(serialized).not.toContain('青空レジデンス');
    expect(serialized).not.toContain(rawScheduleId);
  });

  it('sorts by attention, foundation status, next visit date, then Japanese patient name', () => {
    const cards = [
      buildCard({
        patient_id: 'steady_missing',
        attention: 'steady',
        foundation_summary: { status: 'missing', label: '停止中', items: [] },
      }),
      buildCard({
        patient_id: 'urgent_ready_no_date_b',
        name: '伊藤',
        attention: 'urgent_now',
        foundation_summary: { status: 'ready', label: '確認済', items: [] },
      }),
      buildCard({
        patient_id: 'urgent_ready',
        attention: 'urgent_now',
        foundation_summary: { status: 'ready', label: '確認済', items: [] },
        next_visit_date: '2026-06-12',
      }),
      buildCard({
        patient_id: 'urgent_missing_late',
        attention: 'urgent_now',
        foundation_summary: { status: 'missing', label: '停止中', items: [] },
        next_visit_date: '2026-06-13',
      }),
      buildCard({
        patient_id: 'urgent_needs_confirmation',
        attention: 'urgent_now',
        foundation_summary: { status: 'needs_confirmation', label: '要確認', items: [] },
        next_visit_date: '2026-06-10',
      }),
      buildCard({
        patient_id: 'urgent_missing_early',
        attention: 'urgent_now',
        foundation_summary: { status: 'missing', label: '停止中', items: [] },
        next_visit_date: '2026-06-11',
      }),
      buildCard({
        patient_id: 'urgent_ready_no_date_a',
        name: '阿部',
        attention: 'urgent_now',
        foundation_summary: { status: 'ready', label: '確認済', items: [] },
      }),
    ];

    expect([...cards].sort(comparePatientBoardCards).map((card) => card.patient_id)).toEqual([
      'urgent_missing_early',
      'urgent_missing_late',
      'urgent_needs_confirmation',
      'urgent_ready',
      'urgent_ready_no_date_a',
      'urgent_ready_no_date_b',
      'steady_missing',
    ]);
  });

  it('counts and filters foundation issues without treating needs_confirmation as a concrete key', () => {
    const cards = [
      buildCard({ patient_id: 'ready' }),
      buildCard({
        patient_id: 'needs_contact',
        foundation_summary: { status: 'needs_confirmation', label: '要確認', items: [] },
        foundation_issue_keys: ['missing_contact'],
      }),
      buildCard({
        patient_id: 'missing_consent',
        foundation_summary: { status: 'missing', label: '停止中', items: [] },
        foundation_issue_keys: ['missing_consent_plan'],
      }),
    ] satisfies DerivedPatientBoardCard[];

    expect(buildPatientBoardFoundationIssueCounts(cards)).toEqual({
      needs_confirmation: 2,
      missing_contact: 1,
      missing_consent_plan: 1,
      missing_parking: 0,
      missing_care_level: 0,
      missing_insurance: 0,
      missing_care_team: 0,
    });
    expect(
      cards
        .filter((card) => matchesPatientBoardFoundationIssue(card, undefined))
        .map((card) => card.patient_id),
    ).toEqual(['ready', 'needs_contact', 'missing_consent']);
    expect(
      cards
        .filter((card) => matchesPatientBoardFoundationIssue(card, 'needs_confirmation'))
        .map((card) => card.patient_id),
    ).toEqual(['needs_contact', 'missing_consent']);
    expect(
      cards
        .filter((card) => matchesPatientBoardFoundationIssue(card, 'missing_contact'))
        .map((card) => card.patient_id),
    ).toEqual(['needs_contact']);
  });

  it('uses a controlled workflow-exception label instead of exposing raw exception descriptions', () => {
    const card = derivePatientBoardCard(
      buildPatientRow({
        cases: [
          {
            ...buildPatientRow().cases[0]!,
            medication_cycles: [
              {
                ...buildPatientRow().cases[0]!.medication_cycles[0]!,
                workflow_exceptions: [
                  {
                    exception_type: 'prescription_structuring_block',
                    description: 'リクシアナ錠と090-RAW-PHIを含む自由記載',
                    created_at: new Date('2026-06-10T09:00:00+09:00'),
                  },
                ],
              },
            ],
          },
        ],
      }),
      new Date('2026-06-10T00:00:00.000Z'),
    );

    expect(card).toMatchObject({
      attention: 'checking',
      status_text: '処方構造化の確認中 — 詳細確認が必要です',
    });
    const serialized = JSON.stringify(card);
    expect(serialized).not.toContain('リクシアナ');
    expect(serialized).not.toContain('090-RAW-PHI');
    expect(serialized).not.toContain('自由記載');
  });

  it('calculates age and server-side status times in Japan time instead of runtime local time', () => {
    const baseCase = buildPatientRow().cases[0]!;
    const auditCard = derivePatientBoardCard(
      buildPatientRow({
        birth_date: new Date('1940-01-15T00:00:00.000Z'),
        cases: [
          {
            ...baseCase,
            visit_schedules: [],
            medication_cycles: [
              {
                ...baseCase.medication_cycles[0]!,
                overall_status: 'dispensed',
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
              },
            ],
          },
        ],
      }),
      new Date('2026-01-14T15:30:00.000Z'),
    );

    expect(auditCard.age).toBe(86);
    expect(auditCard.status_text).toContain('期限09:05');

    const resolvedCard = derivePatientBoardCard(
      buildPatientRow({
        cases: [
          {
            ...baseCase,
            visit_schedules: [],
            medication_cycles: [
              {
                ...baseCase.medication_cycles[0]!,
                overall_status: 'inquiry_resolved',
                inquiries: [
                  {
                    inquired_at: new Date('2026-06-10T00:00:00.000Z'),
                    resolved_at: new Date('2026-06-12T00:05:00.000Z'),
                  },
                ],
              },
            ],
          },
        ],
      }),
      new Date('2026-06-12T01:00:00.000Z'),
    );

    expect(resolvedCard.status_text).toContain('(09:05)');
  });
});
