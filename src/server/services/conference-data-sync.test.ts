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
      updateMany: vi.fn(),
      upsert: vi.fn(),
    },
    visitSchedule: {
      findFirst: vi.fn(),
    },
    visitScheduleProposal: {
      create: vi.fn(),
      findFirst: vi.fn(),
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
});
