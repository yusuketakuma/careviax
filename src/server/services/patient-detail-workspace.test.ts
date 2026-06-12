import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  prisma: {},
}));

const batchResolveNamesMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/utils/name-resolver', () => ({
  batchResolveNames: batchResolveNamesMock,
}));

import { buildPatientWorkspace } from './patient-detail-workspace';

function buildDb(cycle: unknown) {
  return {
    medicationCycle: {
      findFirst: vi.fn().mockResolvedValue(cycle),
    },
    patientLabObservation: {
      findFirst: vi.fn().mockResolvedValue({
        value_numeric: 42,
        value_text: null,
        measured_at: new Date(2026, 5, 1, 10, 0),
      }),
    },
    visitSchedule: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'visit_1',
          time_window_start: new Date(2026, 5, 12, 13, 30),
        },
      ]),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  batchResolveNamesMock.mockResolvedValue(new Map([['user_audit', '監査 花子']]));
});

describe('buildPatientWorkspace', () => {
  it('skips cycle fan-out when the patient has no assigned cases', async () => {
    const db = buildDb(null);

    const result = await buildPatientWorkspace(
      db as unknown as Parameters<typeof buildPatientWorkspace>[0],
      {
        orgId: 'org_1',
        patientId: 'patient_1',
        caseIds: [],
        allergyInfo: null,
        conditions: [],
        swallowingRoute: null,
      },
    );

    expect(result).toBeNull();
    expect(db.medicationCycle.findFirst).not.toHaveBeenCalled();
  });

  it('builds prescription safety, activity, and same-day task read models', async () => {
    const currentLine = {
      id: 'line_current',
      drug_name: 'モルヒネ錠',
      drug_code: 'drug_1',
      dose: '1錠',
      frequency: '朝夕',
      days: 7,
      quantity: 14,
      unit: '錠',
      start_date: new Date(2026, 5, 12),
      end_date: new Date(2026, 5, 18),
      dispensing_method: 'unit_dose',
      packaging_instruction_tags: ['separate_pack', 'narcotic'],
    };
    const previousLine = {
      ...currentLine,
      id: 'line_previous',
      dose: '0.5錠',
      quantity: 7,
      start_date: new Date(2026, 5, 5),
      end_date: new Date(2026, 5, 11),
    };
    const cycle = {
      id: 'cycle_1',
      overall_status: 'dispensed',
      exception_status: 'open',
      prescription_intakes: [
        {
          id: 'intake_current',
          prescribed_date: new Date(2026, 5, 12),
          original_document_url: 's3://prescription.pdf',
          prescription_category: 'regular',
          prescriber_institution: '在宅クリニック',
          created_at: new Date(2026, 5, 12, 7, 0),
          lines: [currentLine],
        },
        {
          id: 'intake_previous',
          prescribed_date: new Date(2026, 5, 5),
          original_document_url: null,
          prescription_category: 'regular',
          prescriber_institution: '在宅クリニック',
          created_at: new Date(2026, 5, 5, 7, 0),
          lines: [previousLine],
        },
      ],
      set_plans: [
        {
          id: 'set_plan_1',
          set_method: 'calendar',
          notes: '夕食後注意',
          target_period_start: new Date(2026, 5, 12),
          target_period_end: new Date(2026, 5, 18),
        },
      ],
      workflow_exceptions: [
        {
          id: 'exception_1',
          exception_type: 'audit_blocker',
          description: '麻薬監査待ち',
          severity: 'critical',
          created_at: new Date(2026, 5, 12, 8, 15),
        },
        {
          id: 'exception_2',
          exception_type: 'note',
          description: '確認メモ',
          severity: 'info',
          created_at: new Date(2026, 5, 12, 8, 20),
        },
      ],
      transition_logs: [
        {
          id: 'transition_1',
          from_status: 'dispensing',
          to_status: 'dispensed',
          actor_id: 'user_audit',
          created_at: new Date(2026, 5, 12, 9, 0),
        },
      ],
      inquiries: [
        {
          id: 'inquiry_1',
          reason: '用量確認',
          inquired_at: new Date(2026, 5, 12, 8, 0),
          resolved_at: new Date(2026, 5, 12, 10, 0),
        },
      ],
      dispense_tasks: [
        {
          id: 'dispense_task_1',
          due_date: new Date(2026, 5, 12, 9, 30),
        },
      ],
    };
    const db = buildDb(cycle);

    const result = await buildPatientWorkspace(
      db as unknown as Parameters<typeof buildPatientWorkspace>[0],
      {
        orgId: 'org_1',
        patientId: 'patient_1',
        caseIds: ['case_1'],
        allergyInfo: [{ drug_name: 'NSAIDs', reaction: '発疹', noted_year: 2024 }],
        conditions: [
          {
            condition_type: 'problem',
            name: '嚥下注意',
            is_active: true,
            noted_at: null,
            notes: 'とろみ',
          },
        ],
        swallowingRoute: ' ゼリー ',
      },
    );

    expect(result).toMatchObject({
      cycle_id: 'cycle_1',
      overall_status: 'dispensed',
      current_intake: {
        id: 'intake_current',
        prescribed_date: new Date(2026, 5, 12).toISOString(),
      },
      safety: {
        allergy: 'NSAIDs(発疹 2024)',
        renal: 'eGFR 42(6/1)',
        handling_tags: ['narcotic', 'unit_dose', 'separate_pack'],
        swallowing: 'ゼリー',
        cautions: ['嚥下注意(とろみ)'],
      },
      prescription_lines: [
        expect.objectContaining({
          id: 'line_current',
          drug_name: 'モルヒネ錠',
          packaging_instruction_tags: ['separate_pack', 'narcotic'],
        }),
      ],
      open_exceptions: [
        expect.objectContaining({ id: 'exception_1', severity: 'critical' }),
        expect.objectContaining({ id: 'exception_2', severity: 'warning' }),
      ],
      set_plan: expect.objectContaining({
        id: 'set_plan_1',
        processing: {
          unit_dose: true,
          separate_pack: true,
          crushed: false,
        },
      }),
      prescription_document_url: 's3://prescription.pdf',
    });
    expect(result?.recent_activities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'inquiry-inquiry_1',
          label: '用量確認 → 疑義照会 回答受領',
        }),
        expect.objectContaining({
          id: 'transition-transition_1',
          label: '調剤 完了',
          actor: '監査 花子',
        }),
      ]),
    );
    expect(result?.today_tasks).toEqual([
      {
        id: 'audit-cycle_1',
        tone: 'deadline',
        time_label: '期限 09:30',
        label: '麻薬監査',
        href: '/auditing',
        action_label: '監査へ',
        due_time: '09:30',
      },
      expect.objectContaining({
        id: 'set-cycle_1',
        label: 'セット作成',
      }),
      expect.objectContaining({
        id: 'visit-visit_1',
        time_label: '13:30',
      }),
    ]);
    expect(result?.recent_activities).toHaveLength(4);
  });
});
