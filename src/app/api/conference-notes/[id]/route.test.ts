import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  conferenceNoteFindFirstMock,
  conferenceNoteUpdateMock,
  careCaseFindFirstMock,
  careCaseUpdateMock,
  taskFindManyMock,
  taskCreateManyMock,
  billingCandidateUpsertMock,
  visitScheduleFindFirstMock,
  visitScheduleFindManyMock,
  visitScheduleProposalFindFirstMock,
  visitScheduleProposalFindManyMock,
  visitScheduleProposalCreateMock,
  visitScheduleProposalUpdateMock,
  careReportFindManyMock,
  careReportCreateManyMock,
  residenceFindFirstMock,
  facilityFindFirstMock,
  patientSchedulePreferenceUpsertMock,
  withOrgContextMock,
  upsertOperationalTaskMock,
  resolveOperationalTasksMock,
} = vi.hoisted(() => ({
  conferenceNoteFindFirstMock: vi.fn(),
  conferenceNoteUpdateMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  careCaseUpdateMock: vi.fn(),
  taskFindManyMock: vi.fn(),
  taskCreateManyMock: vi.fn(),
  billingCandidateUpsertMock: vi.fn(),
  visitScheduleFindFirstMock: vi.fn(),
  visitScheduleFindManyMock: vi.fn(),
  visitScheduleProposalFindFirstMock: vi.fn(),
  visitScheduleProposalFindManyMock: vi.fn(),
  visitScheduleProposalCreateMock: vi.fn(),
  visitScheduleProposalUpdateMock: vi.fn(),
  careReportFindManyMock: vi.fn(),
  careReportCreateManyMock: vi.fn(),
  residenceFindFirstMock: vi.fn(),
  facilityFindFirstMock: vi.fn(),
  patientSchedulePreferenceUpsertMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  upsertOperationalTaskMock: vi.fn(),
  resolveOperationalTasksMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => unknown) => {
    return (req: NextRequest, routeContext: { params: Promise<{ id: string }> }) =>
      handler(req, { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' }, routeContext);
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    conferenceNote: {
      findFirst: conferenceNoteFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/operational-tasks', () => ({
  upsertOperationalTask: upsertOperationalTaskMock,
  resolveOperationalTasks: resolveOperationalTasksMock,
}));

import { GET, PATCH } from './route';

function createRequest(body?: unknown) {
  return new NextRequest('http://localhost/api/conference-notes/note_1', {
    method: 'PATCH',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe('/api/conference-notes/[id] PATCH', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    conferenceNoteFindFirstMock.mockResolvedValue({
      id: 'note_1',
      case_id: 'case_1',
      patient_id: 'patient_1',
      facility_id: 'facility_1',
      note_type: 'service_manager',
      title: '担当者会議',
      content: '会議目的: 訪問頻度の見直し',
      structured_content: {
        template: 'service_manager',
        sections: [{ key: 'meeting_purpose', label: '会議目的', body: '訪問頻度の見直し' }],
      },
      metadata: {
        generated_report_id: 'report_prev',
        legacy_note: 'preserve me',
        sync_summary: {
          report_draft_ids: ['report_prev'],
        },
      },
      billing_eligible: true,
      billing_code: 'MED_INFO_PROVISION_2_HA',
      follow_up_date: new Date('2026-04-15T00:00:00.000Z'),
      follow_up_completed: false,
      generated_report_id: 'report_prev',
      participants: [{ name: '佐藤CM', role: 'care_manager', legacy_debug: undefined }],
      conference_date: new Date('2026-03-30T10:00:00.000Z'),
      action_items: [{ title: 'サービス調整を反映', assignee: '薬剤師', legacy_debug: undefined }],
    });
    conferenceNoteUpdateMock.mockImplementation(
      async (args?: { data?: { metadata?: unknown } }) => ({
        id: 'note_1',
        case_id: 'case_1',
        patient_id: 'patient_1',
        facility_id: 'facility_1',
        note_type: 'service_manager',
        title: '担当者会議（更新）',
        content: '会議目的: 訪問頻度の見直し\nサービス調整: 月2回から月4回へ変更',
        structured_content: {
          template: 'service_manager',
          sections: [
            { key: 'meeting_purpose', label: '会議目的', body: '訪問頻度の見直し' },
            { key: 'care_plan_changes', label: 'ケアプラン変更点', body: '服薬支援を強化' },
            { key: 'service_adjustments', label: 'サービス調整', body: '月2回から月4回へ変更' },
          ],
        },
        metadata: (args?.data?.metadata as Record<string, unknown> | undefined) ?? {
          billing: {
            link_status: 'candidate',
            code: 'MED_INFO_PROVISION_2_HA',
            label: '服薬情報等提供料2 ハ',
            points: 20,
          },
          sync_summary: {
            report_draft_ids: ['report_prev'],
          },
        },
        billing_eligible: true,
        billing_code: 'MED_INFO_PROVISION_2_HA',
        follow_up_date: new Date('2026-04-15T00:00:00.000Z'),
        follow_up_completed: false,
        generated_report_id: 'report_prev',
        participants: [{ name: '佐藤CM', role: 'care_manager', attended: true }],
        conference_date: new Date('2026-03-30T10:00:00.000Z'),
        action_items: [{ title: 'サービス調整を反映', assignee: '薬剤師' }],
      }),
    );
    careCaseFindFirstMock.mockResolvedValue({
      id: 'case_1',
      patient_id: 'patient_1',
      primary_pharmacist_id: 'pharm_1',
      required_visit_support: null,
    });
    careCaseUpdateMock.mockResolvedValue({
      id: 'case_1',
      required_visit_support: {
        conference_sync: {
          service_manager: {
            care_plan_update: {
              summary: '服薬支援を強化',
            },
          },
        },
      },
    });
    taskFindManyMock.mockResolvedValue([]);
    taskCreateManyMock.mockResolvedValue({ count: 1 });
    billingCandidateUpsertMock.mockResolvedValue({ id: 'billing_1' });
    visitScheduleFindFirstMock.mockResolvedValue({
      id: 'schedule_latest',
      cycle_id: 'cycle_1',
      site_id: 'site_1',
      visit_type: 'regular',
      priority: 'normal',
      scheduled_date: new Date('2026-03-25T00:00:00.000Z'),
      time_window_start: new Date('1970-01-01T09:00:00.000Z'),
      time_window_end: new Date('1970-01-01T10:00:00.000Z'),
      medication_end_date: null,
      visit_deadline_date: null,
      route_order: 1,
      recurrence_rule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU',
    });
    visitScheduleProposalFindFirstMock.mockResolvedValue(null);
    visitScheduleProposalCreateMock.mockResolvedValue({ id: 'proposal_new' });
    visitScheduleProposalUpdateMock.mockResolvedValue({ id: 'proposal_existing' });
    careReportFindManyMock.mockImplementation(
      async (args?: {
        where?: {
          report_type?: { in?: string[] };
        };
      }) => {
        if (args?.where?.report_type?.in?.length) {
          return [{ id: 'report_cm_1', report_type: args.where.report_type.in[0] }];
        }
        return [];
      },
    );
    careReportCreateManyMock.mockResolvedValue({ count: 1 });
    residenceFindFirstMock.mockResolvedValue({ facility_id: 'facility_1' });
    facilityFindFirstMock.mockResolvedValue({
      acceptance_time_from: new Date('1970-01-01T09:00:00.000Z'),
      acceptance_time_to: new Date('1970-01-01T17:00:00.000Z'),
    });
    patientSchedulePreferenceUpsertMock.mockResolvedValue({ id: 'pref_1' });
    upsertOperationalTaskMock.mockResolvedValue({});
    resolveOperationalTasksMock.mockResolvedValue({ count: 0 });
    visitScheduleFindManyMock.mockResolvedValue([]);
    visitScheduleProposalFindManyMock.mockResolvedValue([]);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        conferenceNote: {
          update: conferenceNoteUpdateMock,
        },
        careCase: {
          findFirst: careCaseFindFirstMock,
          update: careCaseUpdateMock,
        },
        task: {
          findMany: taskFindManyMock,
          createMany: taskCreateManyMock,
        },
        billingCandidate: {
          upsert: billingCandidateUpsertMock,
        },
        visitSchedule: {
          findFirst: visitScheduleFindFirstMock,
          findMany: visitScheduleFindManyMock,
        },
        visitScheduleProposal: {
          findFirst: visitScheduleProposalFindFirstMock,
          findMany: visitScheduleProposalFindManyMock,
          create: visitScheduleProposalCreateMock,
          update: visitScheduleProposalUpdateMock,
        },
        careReport: {
          findMany: careReportFindManyMock,
          createMany: careReportCreateManyMock,
        },
        residence: {
          findFirst: residenceFindFirstMock,
        },
        facility: {
          findFirst: facilityFindFirstMock,
        },
        patientSchedulePreference: {
          upsert: patientSchedulePreferenceUpsertMock,
        },
      }),
    );
  });

  it('updates the note, preserves generated report metadata, and refreshes sync summary', async () => {
    const response = await PATCH(
      createRequest({
        title: '担当者会議（更新）',
        structured_content: {
          sections: [
            { key: 'meeting_purpose', label: '会議目的', body: '訪問頻度の見直し' },
            { key: 'care_plan_changes', label: 'ケアプラン変更点', body: '服薬支援を強化' },
            { key: 'service_adjustments', label: 'サービス調整', body: '月2回から月4回へ変更' },
          ],
        },
        participants: [
          {
            name: '佐藤CM',
            role: 'care_manager',
            attended: true,
            fax: ' 03-1111-2222 ',
          },
        ],
      }),
      {
        params: Promise.resolve({ id: 'note_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(conferenceNoteUpdateMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { id: 'note_1' },
        data: expect.objectContaining({
          note_type: 'service_manager',
          title: '担当者会議（更新）',
          billing_eligible: true,
          billing_code: 'MED_INFO_PROVISION_2_HA',
          generated_report_id: 'report_prev',
          metadata: expect.objectContaining({
            billing: expect.objectContaining({
              code: 'MED_INFO_PROVISION_2_HA',
              points: 20,
            }),
            legacy_note: 'preserve me',
            sync_summary: expect.objectContaining({
              report_draft_ids: ['report_prev'],
            }),
          }),
        }),
      }),
    );
    const savedData = conferenceNoteUpdateMock.mock.calls[0][0].data as {
      participants: Array<Record<string, unknown>>;
      action_items: Array<Record<string, unknown>>;
    };
    expect(savedData.participants[0].legacy_debug).toBeUndefined();
    expect(savedData.participants[0].fax).toBe('03-1111-2222');
    expect(savedData.action_items[0].legacy_debug).toBeUndefined();
    expect(conferenceNoteUpdateMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { id: 'note_1' },
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            sync_summary: expect.objectContaining({
              billing_candidate_id: 'billing_1',
              report_draft_ids: ['report_cm_1'],
              tasks_created: 2,
              visit_proposal_id: 'proposal_new',
            }),
          }),
        }),
      }),
    );
    expect(careCaseUpdateMock).toHaveBeenCalledWith({
      where: { id: 'case_1' },
      data: {
        required_visit_support: expect.objectContaining({
          conference_sync: expect.objectContaining({
            service_manager: expect.objectContaining({
              care_plan_update: expect.objectContaining({
                note_id: 'note_1',
                summary: '服薬支援を強化',
              }),
            }),
          }),
        }),
      },
    });
    expect(billingCandidateUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          billing_code: 'MED_INFO_PROVISION_2_HA',
          points: 20,
        }),
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      data: expect.objectContaining({
        note_type: 'service_manager',
        conference_type: 'service_manager',
        generated_report_id: 'report_prev',
      }),
      sync: expect.objectContaining({
        billing_candidate_id: 'billing_1',
        report_draft_ids: ['report_cm_1'],
        tasks_created: 2,
        visit_proposal_id: 'proposal_new',
      }),
    });
  });

  it('rejects non-object request bodies before loading or syncing the note', async () => {
    const response = await PATCH(createRequest(['unexpected']), {
      params: Promise.resolve({ id: 'note_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(conferenceNoteFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(conferenceNoteUpdateMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(taskCreateManyMock).not.toHaveBeenCalled();
    expect(careReportCreateManyMock).not.toHaveBeenCalled();
  });

  it('rejects blank note ids before loading or syncing the note', async () => {
    const response = await PATCH(
      createRequest({
        title: '担当者会議（更新）',
      }),
      {
        params: Promise.resolve({ id: '   ' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'カンファレンス記録IDが不正です',
    });
    expect(conferenceNoteFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(conferenceNoteUpdateMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(taskCreateManyMock).not.toHaveBeenCalled();
    expect(careReportCreateManyMock).not.toHaveBeenCalled();
  });

  it('rejects malformed participant fax before loading or syncing the note', async () => {
    const response = await PATCH(
      createRequest({
        participants: [{ name: '佐藤CM', role: 'care_manager', fax: '03-ABCD-5678' }],
      }),
      {
        params: Promise.resolve({ id: 'note_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '入力値が不正です',
      details: {
        participants: expect.arrayContaining(['FAX番号形式が不正です']),
      },
    });
    expect(conferenceNoteFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(conferenceNoteUpdateMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(taskCreateManyMock).not.toHaveBeenCalled();
    expect(careReportCreateManyMock).not.toHaveBeenCalled();
  });
});

describe('/api/conference-notes/[id] GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    conferenceNoteFindFirstMock.mockResolvedValue({
      id: 'note_1',
      org_id: 'org_1',
      case_id: 'case_1',
      patient_id: 'patient_1',
      facility_id: 'facility_1',
      note_type: 'service_manager',
      title: '担当者会議',
      content: '会議目的: 訪問頻度の見直し',
      structured_content: {
        template: 'service_manager',
        sections: [{ key: 'meeting_purpose', label: '会議目的', body: '訪問頻度の見直し' }],
      },
      metadata: {
        billing: {
          link_status: 'candidate',
          code: 'MED_INFO_PROVISION_2_HA',
        },
        sync_summary: {
          report_draft_ids: ['report_1'],
          billing_candidate_id: 'billing_1',
          visit_proposal_id: 'proposal_1',
          tasks_created: 2,
          medication_issues_created: 1,
        },
      },
      billing_eligible: false,
      billing_code: null,
      follow_up_date: null,
      follow_up_completed: false,
      generated_report_id: null,
      participants: [{ name: '佐藤CM', role: 'care_manager' }],
      conference_date: new Date('2026-03-30T10:00:00.000Z'),
      action_items: [{ title: 'サービス調整を反映', assignee: '薬剤師' }],
      created_at: new Date('2026-03-30T11:00:00.000Z'),
      updated_at: new Date('2026-03-30T11:30:00.000Z'),
    });
  });

  it('returns full conference note detail scoped to the current org', async () => {
    const response = await GET(createRequest(), { params: Promise.resolve({ id: 'note_1' }) });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(conferenceNoteFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'note_1',
          org_id: 'org_1',
        },
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      data: {
        id: 'note_1',
        conference_type: 'service_manager',
        content: '会議目的: 訪問頻度の見直し',
        structured_content: {
          template: 'service_manager',
        },
        metadata: expect.objectContaining({
          billing: expect.objectContaining({
            code: 'MED_INFO_PROVISION_2_HA',
          }),
        }),
        action_items: [{ title: 'サービス調整を反映', assignee: '薬剤師' }],
        billing_eligible: true,
        billing_code: 'MED_INFO_PROVISION_2_HA',
        sync_summary: expect.objectContaining({
          billing_candidate_id: 'billing_1',
          visit_proposal_id: 'proposal_1',
        }),
      },
    });
  });

  it('returns 404 when the conference note is not visible in the org', async () => {
    conferenceNoteFindFirstMock.mockResolvedValueOnce(null);

    const response = await GET(createRequest(), { params: Promise.resolve({ id: 'missing' }) });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
  });

  it('rejects an invalid conference note id before querying', async () => {
    const response = await GET(createRequest(), { params: Promise.resolve({ id: '   ' }) });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(conferenceNoteFindFirstMock).not.toHaveBeenCalled();
  });
});
