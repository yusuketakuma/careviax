import { beforeEach, describe, expect, it, vi } from 'vitest';

const { syncOnCreateMock, syncOnUpdateMock } = vi.hoisted(() => ({
  syncOnCreateMock: vi.fn(),
  syncOnUpdateMock: vi.fn(),
}));

vi.mock('@/server/services/conference-sync', () => ({
  ConferenceSyncService: {
    syncOnCreate: syncOnCreateMock,
    syncOnUpdate: syncOnUpdateMock,
  },
}));

import { ConferenceDataSyncService, type PersistedConferenceNote } from './conference-data-sync';

const baseNote: PersistedConferenceNote = {
  id: 'note_1',
  case_id: null,
  patient_id: 'patient_1',
  facility_id: null,
  note_type: 'care_team',
  title: 'ケアチーム会議',
  content: '本文',
  structured_content: {
    sections: [
      ['unexpected'],
      { key: 123, label: 'invalid', body: '無視される' },
      { key: 'case_review', label: 123, body: '無視される' },
      { key: 'case_review', label: 'ケースレビュー', body: 123 },
      {
        key: 'case_review',
        label: 'ケースレビュー',
        body: '服薬不安あり\n転倒リスクあり',
      },
    ],
  },
  metadata: {
    visit_brief: {
      existing_flag: true,
    },
  },
  billing_eligible: false,
  billing_code: null,
  follow_up_date: null,
  follow_up_completed: false,
  generated_report_id: null,
  participants: [],
  conference_date: new Date('2026-04-01T00:00:00Z'),
  action_items: null,
};

function createTx() {
  return {
    billingCandidate: {
      upsert: vi.fn(),
    },
    careCase: {
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
    },
    careReport: {
      create: vi.fn(),
      createMany: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    conferenceNote: {
      update: vi.fn(async ({ data }) => ({ ...baseNote, ...data })),
    },
    consentRecord: {
      findFirst: vi.fn(),
    },
    facility: {
      findFirst: vi.fn(),
    },
    managementPlan: {
      findFirst: vi.fn(),
    },
    medicationIssue: {
      createMany: vi.fn(),
      findMany: vi.fn(),
    },
    patientSchedulePreference: {
      upsert: vi.fn(),
    },
    residence: {
      findFirst: vi.fn(),
    },
    task: {
      create: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      upsert: vi.fn().mockResolvedValue({ id: 'task_1', display_id: 't0000000001' }),
    },
    visitSchedule: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    visitScheduleProposal: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  };
}

describe('ConferenceDataSyncService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    syncOnCreateMock.mockResolvedValue({
      report_draft_ids: [],
      billing_candidate_id: null,
      visit_proposal_id: null,
      tasks_created: 0,
      medication_issues_created: 0,
    });
    syncOnUpdateMock.mockResolvedValue({
      report_draft_ids: [],
      billing_candidate_id: null,
      visit_proposal_id: null,
      tasks_created: 0,
      medication_issues_created: 0,
    });
  });

  it('merges derived care-team metadata and sync summary before saving', async () => {
    syncOnCreateMock.mockResolvedValueOnce({
      report_draft_ids: ['report_1'],
      billing_candidate_id: 'billing_1',
      visit_proposal_id: null,
      tasks_created: 2,
      medication_issues_created: 1,
    });
    const tx = createTx();

    await ConferenceDataSyncService.syncSavedNote(tx, 'org_1', 'user_1', baseNote, {
      mode: 'create',
    });

    expect(tx.conferenceNote.update).toHaveBeenCalledWith({
      where: { id: 'note_1' },
      data: {
        metadata: {
          visit_brief: {
            existing_flag: true,
            summary: '服薬不安あり\n転倒リスクあり',
            highlighted_risks: ['服薬不安あり', '転倒リスクあり'],
          },
          sync_summary: {
            report_draft_ids: ['report_1'],
            billing_candidate_id: 'billing_1',
            visit_proposal_id: null,
            tasks_created: 2,
            medication_issues_created: 1,
          },
        },
      },
    });
  });

  it('skips metadata updates when create sync produces no metadata changes', async () => {
    const tx = createTx();
    const note: PersistedConferenceNote = {
      ...baseNote,
      note_type: 'unknown',
      structured_content: null,
      metadata: null,
    };

    const result = await ConferenceDataSyncService.syncSavedNote(tx, 'org_1', 'user_1', note);

    expect(tx.conferenceNote.update).not.toHaveBeenCalled();
    expect(result.note).toBe(note);
  });

  it('allocates service manager recurrence proposal route order after active and open route cells', async () => {
    const tx = createTx();
    const note: PersistedConferenceNote = {
      ...baseNote,
      case_id: 'case_1',
      note_type: 'service_manager',
      structured_content: {
        sections: [
          {
            key: 'service_adjustments',
            label: 'サービス調整',
            body: '月2回へ訪問頻度を変更',
          },
        ],
      },
    };
    tx.careCase.findFirst.mockResolvedValue({
      id: 'case_1',
      patient_id: 'patient_1',
      primary_pharmacist_id: 'pharmacist_1',
      required_visit_support: null,
    });
    tx.visitSchedule.findFirst.mockResolvedValue({
      id: 'schedule_1',
      cycle_id: 'cycle_1',
      site_id: 'site_1',
      visit_type: 'regular',
      priority: 'normal',
      scheduled_date: new Date('2026-04-01T00:00:00.000Z'),
      time_window_start: null,
      time_window_end: null,
      medication_end_date: null,
      visit_deadline_date: null,
      route_order: 2,
      recurrence_rule: null,
    });
    tx.visitSchedule.findMany.mockResolvedValue([
      {
        pharmacist_id: 'pharmacist_1',
        scheduled_date: new Date('2026-04-08T12:00:00.000Z'),
        route_order: 4,
      },
    ]);
    tx.visitScheduleProposal.findFirst.mockResolvedValue(null);
    tx.visitScheduleProposal.findMany.mockResolvedValue([
      {
        proposed_pharmacist_id: 'pharmacist_1',
        proposed_date: new Date('2026-04-08T12:00:00.000Z'),
        route_order: 6,
        reschedule_source_schedule_id: null,
      },
    ]);
    tx.visitScheduleProposal.create.mockResolvedValue({ id: 'proposal_1' });

    const result = await ConferenceDataSyncService.syncSavedNote(tx, 'org_1', 'user_1', note);

    expect(result.sync.visit_proposal_id).toBe('proposal_1');
    expect(tx.visitSchedule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          OR: [
            {
              pharmacist_id: 'pharmacist_1',
              scheduled_date: new Date('2026-04-08T00:00:00.000Z'),
            },
          ],
        }),
      }),
    );
    expect(tx.visitScheduleProposal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          OR: [
            {
              proposed_pharmacist_id: 'pharmacist_1',
              proposed_date: new Date('2026-04-08T00:00:00.000Z'),
            },
          ],
        }),
      }),
    );
    expect(tx.visitScheduleProposal.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        proposed_pharmacist_id: 'pharmacist_1',
        // JST 民間日(2026-04-01)+7 の @db.Date sentinel(UTC 深夜)。
        proposed_date: new Date('2026-04-08T00:00:00.000Z'),
        route_order: 7,
      }),
      select: { id: true },
    });
  });

  it('derives the +7 recurrence proposal date from the JST civil day of a late-UTC conference note (CE16)', async () => {
    const originalTimezone = process.env.TZ;
    process.env.TZ = 'UTC';
    try {
      const tx = createTx();
      const note: PersistedConferenceNote = {
        ...baseNote,
        case_id: 'case_1',
        note_type: 'service_manager',
        // UTC 2026-04-01T20:00Z = JST 2026-04-02 05:00。getUTCDate ベースだと 04-01 起点で
        // +7 が 04-08 に前倒しされる。JST 民間日 04-02 起点なら 04-09 が正しい。
        conference_date: new Date('2026-04-01T20:00:00Z'),
        structured_content: {
          sections: [
            {
              key: 'service_adjustments',
              label: 'サービス調整',
              body: '月2回へ訪問頻度を変更',
            },
          ],
        },
      };
      tx.careCase.findFirst.mockResolvedValue({
        id: 'case_1',
        patient_id: 'patient_1',
        primary_pharmacist_id: 'pharmacist_1',
        required_visit_support: null,
      });
      tx.visitSchedule.findFirst.mockResolvedValue({
        id: 'schedule_1',
        cycle_id: 'cycle_1',
        site_id: 'site_1',
        visit_type: 'regular',
        priority: 'normal',
        scheduled_date: new Date('2026-04-01T00:00:00.000Z'),
        time_window_start: null,
        time_window_end: null,
        medication_end_date: null,
        visit_deadline_date: null,
        route_order: 2,
        recurrence_rule: null,
      });
      tx.visitSchedule.findMany.mockResolvedValue([]);
      tx.visitScheduleProposal.findFirst.mockResolvedValue(null);
      tx.visitScheduleProposal.findMany.mockResolvedValue([]);
      tx.visitScheduleProposal.create.mockResolvedValue({ id: 'proposal_1' });

      await ConferenceDataSyncService.syncSavedNote(tx, 'org_1', 'user_1', note);

      expect(tx.visitScheduleProposal.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          proposed_date: new Date('2026-04-09T00:00:00.000Z'),
        }),
        select: { id: true },
      });
    } finally {
      if (originalTimezone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = originalTimezone;
      }
    }
  });
});
