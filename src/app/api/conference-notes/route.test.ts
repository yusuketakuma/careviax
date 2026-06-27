import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  withAuthContextMock,
  withOrgContextMock,
  conferenceNoteFindManyMock,
  conferenceNoteFindFirstMock,
  conferenceNoteCreateMock,
  conferenceNoteUpdateMock,
  careCaseFindManyMock,
  patientFindFirstMock,
  requireWritablePatientMock,
  // sync-related mocks
  taskFindManyMock,
  taskCreateManyMock,
  billingCandidateUpsertMock,
  visitScheduleProposalFindFirstMock,
  visitScheduleProposalFindManyMock,
  visitScheduleProposalCreateMock,
  visitScheduleProposalUpdateMock,
  visitScheduleFindFirstMock,
  visitScheduleFindManyMock,
  careReportFindManyMock,
  careReportCreateManyMock,
  medicationIssueFindManyMock,
  medicationIssueCreateManyMock,
  careCaseFindFirstMock,
  careCaseUpdateMock,
  residenceFindFirstMock,
  facilityFindFirstMock,
  patientSchedulePreferenceUpsertMock,
  consentRecordFindFirstMock,
  managementPlanFindFirstMock,
  auditLogCreateMock,
  upsertOperationalTaskMock,
  resolveOperationalTasksMock,
} = vi.hoisted(() => ({
  withAuthContextMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  conferenceNoteFindManyMock: vi.fn(),
  conferenceNoteFindFirstMock: vi.fn(),
  conferenceNoteCreateMock: vi.fn(),
  conferenceNoteUpdateMock: vi.fn(),
  careCaseFindManyMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  requireWritablePatientMock: vi.fn(),
  taskFindManyMock: vi.fn(),
  taskCreateManyMock: vi.fn(),
  billingCandidateUpsertMock: vi.fn(),
  visitScheduleProposalFindFirstMock: vi.fn(),
  visitScheduleProposalFindManyMock: vi.fn(),
  visitScheduleProposalCreateMock: vi.fn(),
  visitScheduleProposalUpdateMock: vi.fn(),
  visitScheduleFindFirstMock: vi.fn(),
  visitScheduleFindManyMock: vi.fn(),
  careReportFindManyMock: vi.fn(),
  careReportCreateManyMock: vi.fn(),
  medicationIssueFindManyMock: vi.fn(),
  medicationIssueCreateManyMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  careCaseUpdateMock: vi.fn(),
  residenceFindFirstMock: vi.fn(),
  facilityFindFirstMock: vi.fn(),
  patientSchedulePreferenceUpsertMock: vi.fn(),
  consentRecordFindFirstMock: vi.fn(),
  managementPlanFindFirstMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
  upsertOperationalTaskMock: vi.fn(),
  resolveOperationalTasksMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (
    handler: (
      req: NextRequest,
      ctx: { orgId: string; userId: string; role: 'pharmacist' },
      routeContext: { params: Promise<Record<string, string>> },
    ) => Promise<Response>,
  ) => {
    withAuthContextMock.mockImplementation(handler);
    return (
      req: NextRequest,
      routeContext: { params: Promise<Record<string, string>> } = { params: Promise.resolve({}) },
    ) => handler(req, { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' }, routeContext);
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/operational-tasks', () => ({
  upsertOperationalTask: upsertOperationalTaskMock,
  resolveOperationalTasks: resolveOperationalTasksMock,
}));

vi.mock('@/server/services/patient-write-guard', () => ({
  requireWritablePatient: requireWritablePatientMock,
}));

import { GET as rawGET, POST as rawPOST } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };
const GET = (req: NextRequest) => rawGET(req, emptyRouteContext);
const POST = (req: NextRequest) => rawPOST(req, emptyRouteContext);

function expectNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

function createRequest({
  method = 'GET',
  url = 'http://localhost/api/conference-notes',
  body,
}: {
  method?: 'GET' | 'POST';
  url?: string;
  body?: unknown;
}) {
  return Object.assign(
    new NextRequest(url, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    {
      orgId: 'org_1',
      userId: 'user_1',
    },
  );
}

/** Build a tx mock that covers all the Prisma models used by ConferenceSyncService */
function buildTxMock() {
  return {
    conferenceNote: {
      findMany: conferenceNoteFindManyMock,
      findFirst: conferenceNoteFindFirstMock,
      create: conferenceNoteCreateMock,
      update: conferenceNoteUpdateMock,
    },
    careCase: {
      findMany: careCaseFindManyMock,
      findFirst: careCaseFindFirstMock,
      update: careCaseUpdateMock,
    },
    patient: {
      findFirst: patientFindFirstMock,
    },
    task: {
      findMany: taskFindManyMock,
      createMany: taskCreateManyMock,
    },
    billingCandidate: {
      upsert: billingCandidateUpsertMock,
    },
    visitScheduleProposal: {
      findFirst: visitScheduleProposalFindFirstMock,
      findMany: visitScheduleProposalFindManyMock,
      create: visitScheduleProposalCreateMock,
      update: visitScheduleProposalUpdateMock,
    },
    visitSchedule: {
      findFirst: visitScheduleFindFirstMock,
      findMany: visitScheduleFindManyMock,
    },
    careReport: {
      findMany: careReportFindManyMock,
      createMany: careReportCreateManyMock,
    },
    medicationIssue: {
      findMany: medicationIssueFindManyMock,
      createMany: medicationIssueCreateManyMock,
    },
    consentRecord: {
      findFirst: consentRecordFindFirstMock,
    },
    managementPlan: {
      findFirst: managementPlanFindFirstMock,
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
    auditLog: {
      create: auditLogCreateMock,
    },
  };
}

describe('/api/conference-notes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    withOrgContextMock.mockImplementation(
      async (_orgId: string, callback: (tx: unknown) => unknown) => callback(buildTxMock()),
    );

    // default happy-path mocks
    conferenceNoteFindFirstMock.mockResolvedValue(null);
    visitScheduleFindManyMock.mockResolvedValue([]);
    visitScheduleProposalFindManyMock.mockResolvedValue([]);
    careCaseFindFirstMock.mockResolvedValue({
      id: 'case_1',
      patient_id: 'patient_1',
      primary_pharmacist_id: 'pharm_1',
      required_visit_support: null,
    });
    patientFindFirstMock.mockResolvedValue({ id: 'patient_1' });
    requireWritablePatientMock.mockResolvedValue({
      patient: { id: 'patient_1', archived_at: null },
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
    taskCreateManyMock.mockResolvedValue({ count: 2 });
    conferenceNoteUpdateMock.mockImplementation(
      async (args?: { where?: { id?: string }; data?: { metadata?: unknown } }) => ({
        id: args?.where?.id ?? 'note_updated',
        case_id: 'case_1',
        note_type: 'pre_discharge',
        title: '退院前カンファレンス',
        content: '退院背景: 来週火曜に退院予定',
        structured_content: null,
        metadata: args?.data?.metadata ?? null,
        participants: [{ name: '鈴木薬剤師', role: '薬剤師' }],
        conference_date: new Date('2026-03-28T01:00:00.000Z'),
        action_items: [],
        created_at: new Date('2026-03-28T02:00:00.000Z'),
        updated_at: new Date('2026-03-28T02:00:00.000Z'),
      }),
    );
    billingCandidateUpsertMock.mockResolvedValue({ id: 'billing_new' });
    auditLogCreateMock.mockResolvedValue({ id: 'audit_1' });
    visitScheduleProposalFindFirstMock.mockResolvedValue(null);
    visitScheduleProposalCreateMock.mockResolvedValue({ id: 'proposal_new' });
    visitScheduleProposalUpdateMock.mockResolvedValue({ id: 'proposal_existing' });
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
    careReportFindManyMock.mockImplementation(
      async (args?: {
        where?: {
          report_type?: { in?: string[] };
          content?: { equals?: string };
        };
      }) => {
        if (args?.where?.report_type?.in?.length) {
          return [{ id: 'report_new', report_type: args.where.report_type.in[0] }];
        }
        return [];
      },
    );
    careReportCreateManyMock.mockResolvedValue({ count: 1 });
    medicationIssueFindManyMock.mockResolvedValue([]);
    medicationIssueCreateManyMock.mockResolvedValue({ count: 2 });
    residenceFindFirstMock.mockResolvedValue({
      facility_id: 'facility_1',
    });
    facilityFindFirstMock.mockResolvedValue({
      acceptance_time_from: new Date('1970-01-01T09:00:00.000Z'),
      acceptance_time_to: new Date('1970-01-01T17:00:00.000Z'),
    });
    patientSchedulePreferenceUpsertMock.mockResolvedValue({ id: 'pref_1' });
    consentRecordFindFirstMock.mockResolvedValue({ id: 'consent_1' });
    managementPlanFindFirstMock.mockResolvedValue({ id: 'plan_1' });
    upsertOperationalTaskMock.mockResolvedValue({});
    resolveOperationalTasksMock.mockResolvedValue({ count: 0 });
  });

  // ─── GET ─────────────────────────────────────────────────────────────────

  it('returns expanded conference notes including type, structured content, and metadata', async () => {
    conferenceNoteFindManyMock.mockResolvedValue([
      {
        id: 'note_1',
        org_id: 'org_1',
        case_id: 'case_1',
        patient_id: null,
        facility_id: null,
        note_type: 'pre_discharge',
        title: '退院前カンファ',
        content: '退院背景: 週内退院予定',
        structured_content: {
          template: 'pre_discharge',
          sections: [{ key: 'discharge_background', label: '退院背景', body: '週内退院予定' }],
        },
        metadata: {
          billing: {
            link_status: 'candidate',
            label: '退院時共同指導',
            points: 600,
          },
          visit_brief: {
            patient_id: 'patient_1',
          },
        },
        participants: [{ name: '鈴木薬剤師', role: '薬剤師' }],
        billing_eligible: true,
        billing_code: 'B011-6',
        follow_up_date: new Date('2026-04-05T00:00:00.000Z'),
        follow_up_completed: false,
        generated_report_id: 'report_generated_1',
        conference_date: new Date('2026-03-28T01:00:00.000Z'),
        action_items: [],
        created_at: new Date('2026-03-28T02:00:00.000Z'),
        updated_at: new Date('2026-03-28T02:00:00.000Z'),
      },
    ]);
    careCaseFindManyMock.mockResolvedValue([
      {
        id: 'case_1',
        patient_id: 'patient_1',
        patient: {
          name: '山田 太郎',
        },
      },
    ]);

    const response = await GET(
      createRequest({
        url: 'http://localhost/api/conference-notes?limit=20',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      data: [
        expect.objectContaining({
          id: 'note_1',
          note_type: 'pre_discharge',
          billing_code: 'B011-6',
          generated_report_id: 'report_generated_1',
          structured_content: expect.objectContaining({
            template: 'pre_discharge',
          }),
          metadata: expect.objectContaining({
            billing: expect.objectContaining({
              label: '退院時共同指導',
              points: 600,
            }),
          }),
        }),
      ],
    });
  });

  it('returns no-store validation errors for invalid conference filters', async () => {
    const response = await GET(
      createRequest({
        url: 'http://localhost/api/conference-notes?conference_type=unsupported',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'クエリパラメータが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(conferenceNoteFindManyMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when conference note listing fails unexpectedly', async () => {
    conferenceNoteFindManyMock.mockRejectedValueOnce(
      new Error('raw conference-note participant patient secret'),
    );

    const response = await GET(
      createRequest({
        url: 'http://localhost/api/conference-notes?limit=20',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
    });
    expect(JSON.stringify(body)).not.toContain('participant patient secret');
  });

  it('omits free-text detail fields from summary conference note lists', async () => {
    conferenceNoteFindManyMock.mockResolvedValue([
      {
        id: 'note_1',
        org_id: 'org_1',
        case_id: 'case_1',
        patient_id: 'patient_1',
        facility_id: null,
        note_type: 'pre_discharge',
        title: '退院前カンファ',
        content: '退院後の麻薬管理と家族支援を確認',
        structured_content: {
          template: 'pre_discharge',
          sections: [{ key: 'discharge_background', label: '退院背景', body: '家族が自宅管理' }],
        },
        metadata: {
          billing: {
            link_status: 'candidate',
            code: 'B011-6',
          },
          sync_summary: {
            visit_proposal_id: 'proposal_1',
            tasks_created: 1,
          },
        },
        participants: [{ name: '鈴木薬剤師', role: '薬剤師' }],
        billing_eligible: true,
        billing_code: 'B011-6',
        follow_up_date: null,
        follow_up_completed: false,
        generated_report_id: null,
        conference_date: new Date('2026-03-28T01:00:00.000Z'),
        action_items: [{ title: '麻薬保管説明', assignee: '薬剤師' }],
        created_at: new Date('2026-03-28T02:00:00.000Z'),
        updated_at: new Date('2026-03-28T02:00:00.000Z'),
      },
    ]);
    careCaseFindManyMock.mockResolvedValue([
      {
        id: 'case_1',
        patient_id: 'patient_1',
        patient: {
          name: '山田 太郎',
          residences: [],
        },
      },
    ]);

    const response = await GET(
      createRequest({
        url: 'http://localhost/api/conference-notes?detail_level=summary&date_from=2026-03-01&date_to=2026-03-31',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(conferenceNoteFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 51,
        orderBy: [{ conference_date: 'desc' }, { id: 'desc' }],
        select: expect.objectContaining({
          id: true,
          title: true,
          metadata: true,
          conference_date: true,
        }),
      }),
    );
    expect(conferenceNoteFindManyMock.mock.calls[0]?.[0].select).not.toHaveProperty('content');
    expect(conferenceNoteFindManyMock.mock.calls[0]?.[0].select).not.toHaveProperty(
      'structured_content',
    );
    expect(conferenceNoteFindManyMock.mock.calls[0]?.[0].select).not.toHaveProperty('action_items');
    const payload = await response.json();
    expect(payload.data[0]).toMatchObject({
      id: 'note_1',
      title: '退院前カンファ',
      content: '',
      action_items: null,
      sync_summary: expect.objectContaining({
        visit_proposal_id: 'proposal_1',
        tasks_created: 1,
      }),
    });
    expect(payload.data[0]).not.toHaveProperty('structured_content');
    expect(payload.data[0]).not.toHaveProperty('metadata');
  });

  it('uses stable DB keyset pagination for cursor requests', async () => {
    const cursorDate = new Date('2026-03-28T01:00:00.000Z');
    conferenceNoteFindFirstMock.mockResolvedValue({
      id: 'note_cursor',
      conference_date: cursorDate,
    });
    conferenceNoteFindManyMock.mockResolvedValue([
      {
        id: 'note_older',
        org_id: 'org_1',
        case_id: null,
        patient_id: 'patient_1',
        facility_id: null,
        note_type: 'pre_discharge',
        title: '退院前カンファ',
        metadata: null,
        participants: [],
        billing_eligible: false,
        billing_code: null,
        follow_up_date: null,
        follow_up_completed: false,
        generated_report_id: null,
        conference_date: new Date('2026-03-27T01:00:00.000Z'),
        created_at: new Date('2026-03-27T02:00:00.000Z'),
        updated_at: new Date('2026-03-27T02:00:00.000Z'),
      },
    ]);
    careCaseFindManyMock.mockResolvedValue([]);

    const response = await GET(
      createRequest({
        url: 'http://localhost/api/conference-notes?detail_level=summary&limit=20&cursor=note_cursor',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(conferenceNoteFindFirstMock).toHaveBeenCalledWith({
      where: {
        AND: [expect.objectContaining({ org_id: 'org_1' }), { id: 'note_cursor' }],
      },
      select: { id: true, conference_date: true },
    });
    expect(conferenceNoteFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 21,
        orderBy: [{ conference_date: 'desc' }, { id: 'desc' }],
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({ org_id: 'org_1' }),
            {
              OR: [
                { conference_date: { lt: cursorDate } },
                {
                  conference_date: cursorDate,
                  id: { lt: 'note_cursor' },
                },
              ],
            },
          ]),
        }),
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      data: [expect.objectContaining({ id: 'note_older' })],
      hasMore: false,
    });
  });

  it('supports conference filters including conference_type and billing_eligible', async () => {
    conferenceNoteFindManyMock.mockResolvedValue([
      {
        id: 'note_service_1',
        org_id: 'org_1',
        case_id: 'case_service_1',
        patient_id: 'patient_1',
        facility_id: 'facility_1',
        note_type: 'service_manager',
        title: '担当者会議',
        content: '会議目的: 訪問頻度の見直し',
        structured_content: null,
        metadata: {
          billing: {
            link_status: 'candidate',
            label: '服薬情報等提供料2 ハ',
            points: 20,
          },
        },
        participants: [{ name: '佐藤CM', role: 'care_manager' }],
        billing_eligible: true,
        billing_code: 'MED_INFO_PROVISION_2_HA',
        follow_up_date: null,
        follow_up_completed: false,
        generated_report_id: null,
        conference_date: new Date('2026-03-29T01:00:00.000Z'),
        action_items: [],
        created_at: new Date('2026-03-29T02:00:00.000Z'),
        updated_at: new Date('2026-03-29T02:00:00.000Z'),
      },
    ]);
    careCaseFindManyMock.mockResolvedValueOnce([{ id: 'case_service_1' }]).mockResolvedValueOnce([
      {
        id: 'case_service_1',
        patient_id: 'patient_1',
        patient: {
          name: '山田 太郎',
          residences: [{ facility_id: 'facility_1' }],
        },
      },
    ]);

    const response = await GET(
      createRequest({
        url: 'http://localhost/api/conference-notes?conference_type=service_manager&facility_id=facility_1&billing_eligible=true',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(conferenceNoteFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          note_type: 'service_manager',
          AND: expect.arrayContaining([
            expect.objectContaining({
              OR: expect.arrayContaining([
                { facility_id: 'facility_1' },
                {
                  case_id: { in: ['case_service_1'] },
                },
              ]),
            }),
          ]),
        }),
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      data: [
        expect.objectContaining({
          id: 'note_service_1',
          conference_type: 'service_manager',
          billing_eligible: true,
          billing_code: 'MED_INFO_PROVISION_2_HA',
          facility_id: 'facility_1',
          facility_ids: ['facility_1'],
        }),
      ],
    });
  });

  it('creates a structured conference note and synthesizes summary metadata defaults', async () => {
    conferenceNoteCreateMock.mockResolvedValue({
      id: 'note_2',
      case_id: null,
      note_type: 'pre_discharge',
      title: '退院前カンファ',
      conference_date: new Date('2026-03-28T01:00:00.000Z'),
      participants: [{ name: '鈴木薬剤師', role: '薬剤師' }],
      structured_content: null,
      metadata: null,
      action_items: null,
    });

    const response = await POST(
      createRequest({
        method: 'POST',
        body: {
          note_type: 'pre_discharge',
          patient_id: 'patient_1',
          facility_id: 'facility_1',
          title: '退院前カンファ',
          structured_content: {
            sections: [
              {
                key: 'discharge_background',
                label: '退院背景',
                body: '来週火曜に退院予定',
              },
              {
                key: 'team_roles',
                label: '退院後の役割分担',
                body: '初回訪問は薬局が担当',
              },
            ],
          },
          participants: [
            {
              name: '鈴木薬剤師',
              role: '薬剤師',
              external_professional_id: 'external_1',
              fax: ' 03-1111-2222 ',
            },
          ],
          billing_eligible: true,
          billing_code: 'B011-6',
          follow_up_date: '2026-04-05T00:00:00.000Z',
          follow_up_completed: false,
          conference_date: '2026-03-28T01:00:00.000Z',
        },
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(conferenceNoteCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        patient_id: 'patient_1',
        facility_id: 'facility_1',
        note_type: 'pre_discharge',
        title: '退院前カンファ',
        content: '退院背景: 来週火曜に退院予定\n退院後の役割分担: 初回訪問は薬局が担当',
        structured_content: expect.objectContaining({
          template: 'pre_discharge',
          sections: expect.arrayContaining([
            expect.objectContaining({
              key: 'discharge_background',
              label: '退院背景',
              body: '来週火曜に退院予定',
            }),
          ]),
        }),
        metadata: expect.objectContaining({
          billing: expect.objectContaining({
            link_status: 'candidate',
            label: '退院時共同指導',
            points: 600,
          }),
        }),
        participants: [
          expect.objectContaining({
            name: '鈴木薬剤師',
            external_professional_id: 'external_1',
            fax: '03-1111-2222',
          }),
        ],
        billing_eligible: true,
        billing_code: 'B011-6',
        follow_up_date: new Date('2026-04-05T00:00:00.000Z'),
        follow_up_completed: false,
      }),
    });
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: {
        org_id: 'org_1',
        actor_id: 'user_1',
        actor_pharmacy_id: 'org_1',
        actor_site_id: undefined,
        patient_id: undefined,
        action: 'conference_note.created',
        target_type: 'conference_note',
        target_id: 'note_2',
        changes: {
          conference_note: {
            note_type: 'pre_discharge',
            report_type: null,
            follow_up_date: '2026-04-05T00:00:00.000Z',
            follow_up_completed: false,
            action_item_count: 0,
            billing_eligible: true,
            billing_code: 'B011-6',
          },
        },
        ip_address: undefined,
        user_agent: undefined,
      },
    });
  });

  it('rejects archived patients before creating notes or sync side effects', async () => {
    requireWritablePatientMock.mockResolvedValue({
      response: Response.json(
        { message: 'アーカイブ中の患者は復元するまで更新できません' },
        { status: 409 },
      ),
    });

    const response = await POST(
      createRequest({
        method: 'POST',
        body: {
          note_type: 'pre_discharge',
          patient_id: 'patient_1',
          title: '退院前カンファ',
          structured_content: {
            sections: [
              {
                key: 'discharge_background',
                label: '退院背景',
                body: '来週火曜に退院予定',
              },
            ],
          },
          participants: [{ name: '鈴木薬剤師', role: '薬剤師' }],
          conference_date: '2026-03-28T01:00:00.000Z',
        },
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    expect(conferenceNoteCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(conferenceNoteUpdateMock).not.toHaveBeenCalled();
    expect(taskCreateManyMock).not.toHaveBeenCalled();
    expect(billingCandidateUpsertMock).not.toHaveBeenCalled();
    expect(visitScheduleProposalCreateMock).not.toHaveBeenCalled();
    expect(careReportCreateManyMock).not.toHaveBeenCalled();
    expect(medicationIssueCreateManyMock).not.toHaveBeenCalled();
  });

  it('rejects non-object request bodies before transaction or sync side effects', async () => {
    const response = await POST(
      createRequest({
        method: 'POST',
        body: ['unexpected'],
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(conferenceNoteCreateMock).not.toHaveBeenCalled();
    expect(conferenceNoteUpdateMock).not.toHaveBeenCalled();
    expect(taskCreateManyMock).not.toHaveBeenCalled();
    expect(careReportCreateManyMock).not.toHaveBeenCalled();
  });

  it('rejects malformed participant fax before transaction or sync side effects', async () => {
    const response = await POST(
      createRequest({
        method: 'POST',
        body: {
          note_type: 'pre_discharge',
          title: '退院前カンファ',
          structured_content: {
            sections: [
              {
                key: 'discharge_background',
                label: '退院背景',
                body: '来週火曜に退院予定',
              },
            ],
          },
          participants: [
            {
              name: '鈴木薬剤師',
              role: '薬剤師',
              fax: '03-ABCD-5678',
            },
          ],
          conference_date: '2026-03-28T01:00:00.000Z',
        },
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '入力値が不正です',
    });
    expect(body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: 'FAX番号形式が不正です',
          path: ['participants', 0, 'fax'],
        }),
      ]),
    );
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(conferenceNoteCreateMock).not.toHaveBeenCalled();
    expect(conferenceNoteUpdateMock).not.toHaveBeenCalled();
    expect(taskCreateManyMock).not.toHaveBeenCalled();
    expect(careReportCreateManyMock).not.toHaveBeenCalled();
  });

  it('rejects blank participant names before transaction or sync side effects', async () => {
    const response = await POST(
      createRequest({
        method: 'POST',
        body: {
          note_type: 'pre_discharge',
          title: '退院前カンファ',
          structured_content: {
            sections: [
              {
                key: 'discharge_background',
                label: '退院背景',
                body: '来週火曜に退院予定',
              },
            ],
          },
          participants: [{ name: '   ', role: '薬剤師' }],
          conference_date: '2026-03-28T01:00:00.000Z',
        },
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: expect.arrayContaining([
        expect.objectContaining({
          path: ['participants', 0, 'name'],
        }),
      ]),
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(conferenceNoteCreateMock).not.toHaveBeenCalled();
    expect(taskCreateManyMock).not.toHaveBeenCalled();
  });

  it('rejects blank action item titles before transaction or sync side effects', async () => {
    const response = await POST(
      createRequest({
        method: 'POST',
        body: {
          note_type: 'service_manager',
          title: '担当者会議',
          structured_content: {
            sections: [
              {
                key: 'meeting_purpose',
                label: '会議目的',
                body: '服薬支援の再調整',
              },
            ],
          },
          participants: [],
          action_items: [{ title: '   ', assignee: '薬剤師' }],
          conference_date: '2026-03-28T01:00:00.000Z',
        },
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: expect.arrayContaining([
        expect.objectContaining({
          path: ['action_items', 0, 'title'],
        }),
      ]),
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(conferenceNoteCreateMock).not.toHaveBeenCalled();
    expect(taskCreateManyMock).not.toHaveBeenCalled();
  });

  it('rejects patient-detail conference operations without report tasks before sync side effects', async () => {
    const response = await POST(
      createRequest({
        method: 'POST',
        body: {
          note_type: 'service_manager',
          title: '担当者会議',
          structured_content: {
            sections: [
              {
                key: 'meeting_purpose',
                label: '会議目的',
                body: '訪看への共有内容を確認',
              },
            ],
          },
          participants: [],
          metadata: {
            conference_operation: {
              format: 'mcs',
              organizer: 'visiting_nurse',
            },
          },
          action_items: [],
          conference_date: '2026-03-28T01:00:00.000Z',
        },
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: expect.arrayContaining([
        expect.objectContaining({
          path: ['metadata', 'conference_operation', 'report_type'],
        }),
        expect.objectContaining({
          path: ['action_items'],
        }),
      ]),
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(conferenceNoteCreateMock).not.toHaveBeenCalled();
    expect(taskCreateManyMock).not.toHaveBeenCalled();
    expect(careReportCreateManyMock).not.toHaveBeenCalled();
  });

  it('rejects conference note creation when conference type is omitted', async () => {
    const response = await POST(
      createRequest({
        method: 'POST',
        body: {
          title: '会議種別なし',
          content: '内容だけ入力',
          participants: [{ name: '鈴木薬剤師', role: '薬剤師' }],
          conference_date: '2026-03-28T01:00:00.000Z',
        },
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(conferenceNoteCreateMock).not.toHaveBeenCalled();
  });

  it('rejects conference note creation when case and patient do not match', async () => {
    const response = await POST(
      createRequest({
        method: 'POST',
        body: {
          conference_type: 'pre_discharge',
          case_id: 'case_1',
          patient_id: 'patient_other',
          title: '退院前カンファ',
          structured_content: {
            sections: [
              { key: 'discharge_background', label: '退院背景', body: '週内退院予定' },
              { key: 'medication_changes_on_discharge', label: '退院時変更薬', body: 'ARB増量' },
              { key: 'risk_assessment', label: 'リスク評価', body: '服薬忘れあり' },
            ],
          },
          participants: [{ name: '鈴木薬剤師', role: '薬剤師' }],
          conference_date: '2026-03-28T01:00:00.000Z',
        },
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(conferenceNoteCreateMock).not.toHaveBeenCalled();
  });

  it('rejects patient-only conference note creation when the patient is not visible in the org', async () => {
    patientFindFirstMock.mockResolvedValueOnce(null);

    const response = await POST(
      createRequest({
        method: 'POST',
        body: {
          conference_type: 'service_manager',
          patient_id: 'patient_foreign',
          title: 'サービス担当者会議',
          structured_content: {
            sections: [{ key: 'meeting_purpose', label: '会議目的', body: '服薬支援を確認' }],
          },
          participants: [{ name: '鈴木薬剤師', role: '薬剤師' }],
          conference_date: '2026-03-28T01:00:00.000Z',
        },
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(patientFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'patient_foreign',
        org_id: 'org_1',
      },
      select: {
        id: true,
      },
    });
    expect(conferenceNoteCreateMock).not.toHaveBeenCalled();
  });

  it('rejects conference note creation when top-level and metadata patient IDs differ', async () => {
    const response = await POST(
      createRequest({
        method: 'POST',
        body: {
          conference_type: 'service_manager',
          patient_id: 'patient_1',
          title: 'サービス担当者会議',
          structured_content: {
            sections: [{ key: 'meeting_purpose', label: '会議目的', body: '服薬支援を確認' }],
          },
          metadata: {
            visit_brief: {
              patient_id: 'patient_other',
            },
          },
          participants: [{ name: '鈴木薬剤師', role: '薬剤師' }],
          conference_date: '2026-03-28T01:00:00.000Z',
        },
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(conferenceNoteCreateMock).not.toHaveBeenCalled();
  });

  it('rejects service_manager notes without the required structured sections', async () => {
    const response = await POST(
      createRequest({
        method: 'POST',
        body: {
          conference_type: 'service_manager',
          title: '担当者会議',
          structured_content: {
            sections: [
              { key: 'service_adjustments', label: 'サービス調整', body: '訪問頻度の見直し' },
            ],
          },
          participants: [{ name: '佐藤CM', role: 'care_manager', attended: true }],
          conference_date: '2026-03-28T01:00:00.000Z',
        },
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(conferenceNoteCreateMock).not.toHaveBeenCalled();
  });

  // ─── Sync: pre_discharge ─────────────────────────────────────────────────

  describe('POST pre_discharge — sync side-effects', () => {
    const preDischargeSectionsBody = {
      note_type: 'pre_discharge',
      case_id: 'case_1',
      title: '退院前カンファレンス',
      structured_content: {
        sections: [
          { key: 'discharge_background', label: '退院背景', body: '来週火曜に退院予定' },
          { key: 'target_discharge_date', label: '退院予定日', body: '2026-03-30' },
          {
            key: 'medication_changes_on_discharge',
            label: '退院時薬剤変更',
            body: '退院後は夕食後へ変更\n頓服の使用方法を再説明',
          },
          {
            key: 'risk_assessment',
            label: 'リスク評価',
            body: '転倒リスクあり\n服薬アドヒアランス低下',
          },
          { key: 'next_visit_plan', label: '次回訪問計画', body: '退院翌週に初回訪問予定' },
          { key: 'team_roles', label: '役割分担', body: '薬局担当: 服薬確認' },
        ],
      },
      participants: [{ name: '鈴木薬剤師', role: '薬剤師' }],
      conference_date: '2026-03-28T01:00:00.000Z',
      action_items: [
        { title: '服薬管理計画書を作成する', assignee: '薬剤師' },
        { title: 'かかりつけ医に連絡する', assignee: '薬剤師' },
      ],
    };

    beforeEach(() => {
      conferenceNoteCreateMock.mockResolvedValue({
        id: 'note_pre1',
        case_id: 'case_1',
        note_type: 'pre_discharge',
        title: '退院前カンファレンス',
        conference_date: new Date('2026-03-28T01:00:00.000Z'),
        participants: [{ name: '鈴木薬剤師', role: '薬剤師' }],
        structured_content: {
          template: 'pre_discharge',
          sections: [
            { key: 'discharge_background', label: '退院背景', body: '来週火曜に退院予定' },
            { key: 'target_discharge_date', label: '退院予定日', body: '2026-03-30' },
            {
              key: 'medication_changes_on_discharge',
              label: '退院時薬剤変更',
              body: '退院後は夕食後へ変更\n頓服の使用方法を再説明',
            },
            {
              key: 'risk_assessment',
              label: 'リスク評価',
              body: '転倒リスクあり\n服薬アドヒアランス低下',
            },
            { key: 'next_visit_plan', label: '次回訪問計画', body: '退院翌週に初回訪問予定' },
          ],
        },
        metadata: null,
        action_items: [
          { title: '服薬管理計画書を作成する', assignee: '薬剤師' },
          { title: 'かかりつけ医に連絡する', assignee: '薬剤師' },
        ],
      });
    });

    it('creates tasks from action_items on POST pre_discharge', async () => {
      const response = await POST(
        createRequest({ method: 'POST', body: preDischargeSectionsBody }),
      );

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(201);

      expect(taskFindManyMock).toHaveBeenCalledTimes(1);
      expect(taskCreateManyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              org_id: 'org_1',
              task_type: 'conference_action_item',
              title: '服薬管理計画書を作成する',
              dedupe_key: 'conference-action-item:note_pre1:0',
            }),
            expect.objectContaining({
              title: 'かかりつけ医に連絡する',
              dedupe_key: 'conference-action-item:note_pre1:1',
            }),
          ]),
        }),
      );
    });

    it('creates BillingCandidate with 600 points on POST pre_discharge', async () => {
      const response = await POST(
        createRequest({ method: 'POST', body: preDischargeSectionsBody }),
      );

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(201);

      expect(billingCandidateUpsertMock).toHaveBeenCalledTimes(1);
      expect(billingCandidateUpsertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            org_id_dedupe_key: {
              org_id: 'org_1',
              dedupe_key: 'conference-billing:org_1:patient_1:B011-6:2026-03-01:note_pre1',
            },
          },
          create: expect.objectContaining({
            org_id: 'org_1',
            patient_id: 'patient_1',
            billing_month: new Date('2026-03-01T00:00:00.000Z'),
            billing_code: 'B011-6',
            billing_name: '退院時共同指導料（薬局）',
            points: 600,
            status: 'candidate',
          }),
        }),
      );
    });

    it('creates VisitScheduleProposal when next_visit_plan section exists on POST pre_discharge', async () => {
      const response = await POST(
        createRequest({ method: 'POST', body: preDischargeSectionsBody }),
      );

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(201);

      expect(visitScheduleProposalCreateMock).toHaveBeenCalledTimes(1);
      expect(visitScheduleProposalCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            org_id: 'org_1',
            case_id: 'case_1',
            visit_type: 'regular',
            priority: 'normal',
            proposal_status: 'proposed',
            proposed_pharmacist_id: 'pharm_1',
            proposed_date: expect.any(Date),
            proposal_reason: 'conference-visit-proposal:note_pre1',
          }),
        }),
      );
      expect(
        (
          visitScheduleProposalCreateMock.mock.calls[0]?.[0] as {
            data?: { proposed_date?: Date };
          }
        ).data?.proposed_date
          ?.toISOString()
          .slice(0, 10),
      ).toBe('2026-04-02');
    });

    it('does NOT create VisitScheduleProposal when next_visit_plan section is absent', async () => {
      conferenceNoteCreateMock.mockResolvedValue({
        id: 'note_pre_novp',
        case_id: 'case_1',
        note_type: 'pre_discharge',
        title: '退院前カンファ（訪問計画なし）',
        conference_date: new Date('2026-03-28T01:00:00.000Z'),
        participants: [],
        structured_content: {
          template: 'pre_discharge',
          sections: [{ key: 'discharge_background', label: '退院背景', body: '退院予定' }],
        },
        metadata: null,
        action_items: null,
      });

      const response = await POST(
        createRequest({
          method: 'POST',
          body: {
            note_type: 'pre_discharge',
            case_id: 'case_1',
            title: '退院前カンファ（訪問計画なし）',
            structured_content: {
              sections: [{ key: 'discharge_background', label: '退院背景', body: '退院予定' }],
            },
            participants: [],
            conference_date: '2026-03-28T01:00:00.000Z',
          },
        }),
      );

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(201);
      expect(visitScheduleProposalCreateMock).not.toHaveBeenCalled();
    });

    it('creates CareReport draft with report_type physician_report on POST pre_discharge', async () => {
      const response = await POST(
        createRequest({ method: 'POST', body: preDischargeSectionsBody }),
      );

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(201);

      expect(careReportCreateManyMock).toHaveBeenCalledTimes(1);
      expect(careReportCreateManyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              org_id: 'org_1',
              patient_id: 'patient_1',
              case_id: 'case_1',
              report_type: 'physician_report',
              status: 'draft',
              created_by: 'user_1',
              content: expect.objectContaining({
                conference_note_id: 'note_pre1',
                note_type: 'pre_discharge',
                medication_summary: '退院後は夕食後へ変更\n頓服の使用方法を再説明',
                risks: '転倒リスクあり\n服薬アドヒアランス低下',
                next_visit_plan: '退院翌週に初回訪問予定',
              }),
            }),
          ]),
        }),
      );
    });

    it('creates discharge medication issues and a management plan review task on POST pre_discharge', async () => {
      const response = await POST(
        createRequest({ method: 'POST', body: preDischargeSectionsBody }),
      );

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(201);
      expect(medicationIssueCreateManyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              title: '退院後は夕食後へ変更',
            }),
            expect.objectContaining({
              title: '頓服の使用方法を再説明',
            }),
          ]),
        }),
      );
      expect(upsertOperationalTaskMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          orgId: 'org_1',
          taskType: 'management_plan_review',
          dedupeKey: 'conference-management-plan-review:note_pre1',
        }),
      );
      expect(patientSchedulePreferenceUpsertMock).toHaveBeenCalledWith({
        where: {
          patient_id: 'patient_1',
        },
        create: {
          org_id: 'org_1',
          patient_id: 'patient_1',
          facility_time_from: new Date('1970-01-01T09:00:00.000Z'),
          facility_time_to: new Date('1970-01-01T17:00:00.000Z'),
        },
        update: {
          facility_time_from: new Date('1970-01-01T09:00:00.000Z'),
          facility_time_to: new Date('1970-01-01T17:00:00.000Z'),
        },
      });
    });

    it('exposes sync result in the response body', async () => {
      const response = await POST(
        createRequest({ method: 'POST', body: preDischargeSectionsBody }),
      );

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(201);
      const body = await response.json();

      expect(body).toHaveProperty('sync');
      expect(body.sync).toMatchObject({
        tasks_created: 3,
        billing_candidate_id: 'billing_new',
        visit_proposal_id: 'proposal_new',
        report_draft_ids: ['report_new'],
      });
      expect(conferenceNoteUpdateMock).toHaveBeenCalledWith({
        where: { id: 'note_pre1' },
        data: {
          metadata: expect.objectContaining({
            sync_summary: expect.objectContaining({
              tasks_created: 3,
              billing_candidate_id: 'billing_new',
              visit_proposal_id: 'proposal_new',
              report_draft_ids: ['report_new'],
            }),
          }),
        },
      });
    });
  });

  describe('POST service_manager — sync side-effects', () => {
    beforeEach(() => {
      conferenceNoteCreateMock.mockResolvedValue({
        id: 'note_service_1',
        case_id: 'case_1',
        note_type: 'service_manager',
        title: '担当者会議',
        conference_date: new Date('2026-03-28T01:00:00.000Z'),
        participants: [{ name: '佐藤CM', role: 'care_manager', attended: true }],
        structured_content: {
          template: 'service_manager',
          sections: [
            { key: 'meeting_purpose', label: '会議目的', body: '訪問頻度の見直し' },
            {
              key: 'service_adjustments',
              label: 'サービス調整',
              body: '訪問薬剤管理 月2回→月4回',
            },
            {
              key: 'medication_related_items',
              label: '服薬関連項目',
              body: '飲み忘れが増えている\n一包化の再調整が必要',
            },
            {
              key: 'agreed_actions',
              label: '合意アクション',
              body: '訪問回数変更を反映\n家族へ説明する',
            },
            {
              key: 'coordination_items',
              label: '連携事項',
              body: 'ケアマネへ共有\n訪看へ服薬状況を連絡',
            },
            { key: 'next_meeting_date', label: '次回会議日', body: '2026-04-15' },
          ],
        },
        metadata: null,
        action_items: null,
      });
    });

    it('creates BillingCandidate and CareReport draft for service_manager conferences', async () => {
      const response = await POST(
        createRequest({
          method: 'POST',
          body: {
            conference_type: 'service_manager',
            case_id: 'case_1',
            title: '担当者会議',
            structured_content: {
              sections: [
                { key: 'meeting_purpose', label: '会議目的', body: '訪問頻度の見直し' },
                {
                  key: 'service_adjustments',
                  label: 'サービス調整',
                  body: '訪問薬剤管理 月2回→月4回',
                },
                {
                  key: 'medication_related_items',
                  label: '服薬関連項目',
                  body: '飲み忘れが増えている\n一包化の再調整が必要',
                },
                {
                  key: 'agreed_actions',
                  label: '合意アクション',
                  body: '訪問回数変更を反映\n家族へ説明する',
                },
                {
                  key: 'coordination_items',
                  label: '連携事項',
                  body: 'ケアマネへ共有\n訪看へ服薬状況を連絡',
                },
                { key: 'next_meeting_date', label: '次回会議日', body: '2026-04-15' },
              ],
            },
            participants: [{ name: '佐藤CM', role: 'care_manager', attended: true }],
            conference_date: '2026-03-28T01:00:00.000Z',
          },
        }),
      );

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(201);
      expect(billingCandidateUpsertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            billing_code: 'MED_INFO_PROVISION_2_HA',
            billing_name: '服薬情報等提供料2 ハ',
            points: 20,
          }),
        }),
      );
      expect(careReportCreateManyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              report_type: 'care_manager_report',
              content: expect.objectContaining({
                coordination: 'ケアマネへ共有\n訪看へ服薬状況を連絡',
                service_adjustments: '訪問薬剤管理 月2回→月4回',
              }),
            }),
          ]),
        }),
      );
      expect(medicationIssueCreateManyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ title: '飲み忘れが増えている' }),
            expect.objectContaining({ title: '一包化の再調整が必要' }),
          ]),
        }),
      );
      expect(upsertOperationalTaskMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          taskType: 'conference_action_item',
          title: '担当者会議アクション: 訪問回数変更を反映',
        }),
      );
      expect(visitScheduleProposalCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            proposal_reason: 'conference-recurrence-proposal:note_service_1',
            suggested_recurrence_rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=TU',
          }),
        }),
      );
      await expect(response.json()).resolves.toMatchObject({
        sync: expect.objectContaining({
          visit_proposal_id: 'proposal_new',
        }),
      });
    });

    it('uses the selected conference report purpose when creating CareReport drafts', async () => {
      conferenceNoteCreateMock.mockImplementationOnce(
        async (args?: {
          data?: {
            metadata?: unknown;
            action_items?: unknown;
            structured_content?: unknown;
            content?: string;
          };
        }) => ({
          id: 'note_service_1',
          case_id: 'case_1',
          patient_id: 'patient_1',
          note_type: 'service_manager',
          title: '担当者会議',
          content: args?.data?.content ?? '会議目的: 訪看へ服薬状況を連絡',
          conference_date: new Date('2026-03-28T01:00:00.000Z'),
          participants: [{ name: '佐藤CM', role: 'care_manager', attended: true }],
          structured_content: args?.data?.structured_content ?? null,
          metadata: args?.data?.metadata ?? null,
          action_items: args?.data?.action_items ?? null,
        }),
      );

      const response = await POST(
        createRequest({
          method: 'POST',
          body: {
            conference_type: 'service_manager',
            case_id: 'case_1',
            title: '担当者会議',
            structured_content: {
              sections: [
                { key: 'meeting_purpose', label: '会議目的', body: '訪看へ服薬状況を連絡' },
                { key: 'coordination_items', label: '連携事項', body: '訪看へ共有' },
              ],
            },
            participants: [{ name: '佐藤CM', role: 'care_manager', attended: true }],
            metadata: {
              conference_operation: {
                format: 'mcs',
                location: 'MCS 山田太郎さん在宅チーム',
                organizer: 'visiting_nurse',
                agenda: '訪看への服薬情報共有',
                pharmacy_participants: ['鈴木薬剤師', '田中事務'],
                participant_count: 3,
                report_type: 'nurse_share',
              },
            },
            conference_date: '2026-03-28T01:00:00.000Z',
            action_items: [{ title: '訪看共有内容を確認する', assignee: '薬剤師' }],
          },
        }),
      );

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(201);
      expect(conferenceNoteCreateMock).toHaveBeenCalledWith({
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            conference_operation: {
              format: 'mcs',
              location: 'MCS 山田太郎さん在宅チーム',
              organizer: 'visiting_nurse',
              agenda: '訪看への服薬情報共有',
              pharmacy_participants: ['鈴木薬剤師', '田中事務'],
              participant_count: 3,
              report_type: 'nurse_share',
            },
          }),
        }),
      });
      expect(careReportCreateManyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [
            expect.objectContaining({
              report_type: 'nurse_share',
              content: expect.objectContaining({
                conference_note_id: 'note_service_1',
                disclosure_scope: expect.objectContaining({
                  audience: 'nurse_share',
                }),
              }),
            }),
          ],
        }),
      );
      expect(careReportCreateManyMock).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              report_type: 'care_manager_report',
            }),
          ]),
        }),
      );
    });

    it('stores care plan update in careCase required_visit_support on POST service_manager', async () => {
      conferenceNoteCreateMock.mockResolvedValue({
        id: 'note_service_1',
        case_id: 'case_1',
        note_type: 'service_manager',
        title: '担当者会議',
        conference_date: new Date('2026-03-28T01:00:00.000Z'),
        participants: [{ name: '佐藤CM', role: 'care_manager', attended: true }],
        structured_content: {
          template: 'service_manager',
          sections: [
            { key: 'meeting_purpose', label: '会議目的', body: '訪問頻度の見直し' },
            { key: 'care_plan_changes', label: 'ケアプラン変更点', body: '服薬支援を強化' },
            {
              key: 'service_adjustments',
              label: 'サービス調整',
              body: '訪問薬剤管理 月2回→月4回',
            },
          ],
        },
        metadata: null,
        action_items: null,
      });

      const response = await POST(
        createRequest({
          method: 'POST',
          body: {
            conference_type: 'service_manager',
            case_id: 'case_1',
            title: '担当者会議',
            structured_content: {
              sections: [
                { key: 'meeting_purpose', label: '会議目的', body: '訪問頻度の見直し' },
                { key: 'care_plan_changes', label: 'ケアプラン変更点', body: '服薬支援を強化' },
                {
                  key: 'service_adjustments',
                  label: 'サービス調整',
                  body: '訪問薬剤管理 月2回→月4回',
                },
              ],
            },
            participants: [{ name: '佐藤CM', role: 'care_manager', attended: true }],
            conference_date: '2026-03-28T01:00:00.000Z',
          },
        }),
      );

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(201);
      expect(careCaseUpdateMock).toHaveBeenCalledWith({
        where: { id: 'case_1' },
        data: {
          required_visit_support: expect.objectContaining({
            conference_sync: expect.objectContaining({
              service_manager: expect.objectContaining({
                care_plan_update: expect.objectContaining({
                  note_id: 'note_service_1',
                  summary: '服薬支援を強化',
                }),
              }),
            }),
          }),
        },
      });
    });
  });

  // ─── Sync: death_conference ───────────────────────────────────────────────

  describe('POST death_conference — sync side-effects', () => {
    beforeEach(() => {
      conferenceNoteCreateMock.mockResolvedValue({
        id: 'note_death1',
        case_id: 'case_1',
        note_type: 'death_conference',
        title: 'デスカンファレンス',
        conference_date: new Date('2026-03-25T01:00:00.000Z'),
        participants: [{ name: '田中薬剤師', role: '薬剤師' }],
        structured_content: {
          template: 'death_conference',
          sections: [
            {
              key: 'billing_confirmation',
              label: '請求根拠確認',
              body: 'ターミナルケア管理料算定要件を確認。在宅での最期を患者・家族が希望し、薬剤師が継続支援した記録あり。',
            },
            {
              key: 'improvement_actions',
              label: '改善アクション',
              body: '看取り後説明フローを見直す\n関係者連絡テンプレートを更新する',
            },
            {
              key: 'quality_indicators',
              label: '品質指標',
              body: '看取り後カンファ実施',
            },
            {
              key: 'terminal_process',
              label: 'ターミナル経過',
              body: '看取りまでの服薬支援を記録',
            },
          ],
        },
        metadata: null,
        action_items: null,
      });
    });

    it('creates BillingCandidate with 2500 points on POST death_conference', async () => {
      const response = await POST(
        createRequest({
          method: 'POST',
          body: {
            note_type: 'death_conference',
            case_id: 'case_1',
            title: 'デスカンファレンス',
            structured_content: {
              sections: [
                {
                  key: 'billing_confirmation',
                  label: '請求根拠確認',
                  body: 'ターミナルケア管理料算定要件を確認。',
                },
                {
                  key: 'terminal_process',
                  label: 'ターミナル経過',
                  body: '看取りまでの服薬支援を記録',
                },
              ],
            },
            participants: [{ name: '田中薬剤師', role: '薬剤師' }],
            conference_date: '2026-03-25T01:00:00.000Z',
          },
        }),
      );

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(201);

      expect(billingCandidateUpsertMock).toHaveBeenCalledTimes(1);
      expect(billingCandidateUpsertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            org_id_dedupe_key: {
              org_id: 'org_1',
              dedupe_key: 'conference-billing:org_1:patient_1:C013:2026-03-01:note_death1',
            },
          },
          create: expect.objectContaining({
            org_id: 'org_1',
            patient_id: 'patient_1',
            billing_month: new Date('2026-03-01T00:00:00.000Z'),
            billing_code: 'C013',
            billing_name: 'ターミナルケア管理料（在宅ターミナルケア加算）',
            points: 2500,
            status: 'candidate',
          }),
        }),
      );
    });

    it('creates CareReport draft with report_type internal_record on POST death_conference', async () => {
      const response = await POST(
        createRequest({
          method: 'POST',
          body: {
            note_type: 'death_conference',
            case_id: 'case_1',
            title: 'デスカンファレンス',
            structured_content: {
              sections: [
                {
                  key: 'billing_confirmation',
                  label: '請求根拠確認',
                  body: 'ターミナルケア管理料算定要件を確認。',
                },
              ],
            },
            participants: [{ name: '田中薬剤師', role: '薬剤師' }],
            conference_date: '2026-03-25T01:00:00.000Z',
          },
        }),
      );

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(201);

      expect(careReportCreateManyMock).toHaveBeenCalledTimes(1);
      expect(careReportCreateManyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              org_id: 'org_1',
              patient_id: 'patient_1',
              report_type: 'internal_record',
              status: 'draft',
              content: expect.objectContaining({
                conference_note_id: 'note_death1',
                note_type: 'death_conference',
                terminal_summary: '看取りまでの服薬支援を記録',
              }),
            }),
          ]),
        }),
      );
    });

    it('does NOT create VisitScheduleProposal for death_conference', async () => {
      const response = await POST(
        createRequest({
          method: 'POST',
          body: {
            note_type: 'death_conference',
            case_id: 'case_1',
            title: 'デスカンファレンス',
            structured_content: {
              sections: [
                { key: 'billing_confirmation', label: '請求根拠確認', body: '算定要件確認済み' },
              ],
            },
            participants: [],
            conference_date: '2026-03-25T01:00:00.000Z',
          },
        }),
      );

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(201);
      expect(visitScheduleProposalCreateMock).not.toHaveBeenCalled();
    });

    it('creates case review and improvement tasks for death_conference', async () => {
      const response = await POST(
        createRequest({
          method: 'POST',
          body: {
            note_type: 'death_conference',
            case_id: 'case_1',
            title: 'デスカンファレンス',
            structured_content: {
              sections: [
                { key: 'billing_confirmation', label: '請求根拠確認', body: '算定要件確認済み' },
                {
                  key: 'improvement_actions',
                  label: '改善アクション',
                  body: '看取り後説明フローを見直す\n関係者連絡テンプレートを更新する',
                },
                {
                  key: 'quality_indicators',
                  label: '品質指標',
                  body: '看取り後カンファ実施',
                },
              ],
            },
            participants: [],
            conference_date: '2026-03-25T01:00:00.000Z',
          },
        }),
      );

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(201);
      expect(upsertOperationalTaskMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          taskType: 'conference_case_status_review',
          dedupeKey: 'conference-case-termination:note_death1',
        }),
      );
      expect(upsertOperationalTaskMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          taskType: 'conference_quality_improvement',
          title: '改善アクション: 看取り後説明フローを見直す',
        }),
      );
    });

    it('creates resolved MedicationIssues from medication_at_end on POST death_conference', async () => {
      conferenceNoteCreateMock.mockResolvedValue({
        id: 'note_death1',
        case_id: 'case_1',
        note_type: 'death_conference',
        title: 'デスカンファレンス',
        conference_date: new Date('2026-03-25T01:00:00.000Z'),
        participants: [{ name: '田中薬剤師', role: '薬剤師' }],
        structured_content: {
          template: 'death_conference',
          sections: [
            {
              key: 'billing_confirmation',
              label: '請求根拠確認',
              body: 'ターミナルケア管理料算定要件を確認。',
            },
            {
              key: 'medication_at_end',
              label: '終末期薬剤管理',
              body: '疼痛コントロール目的でオキシコドンへ切替\nレスキュー使用手順を家族へ共有',
            },
          ],
        },
        metadata: null,
        action_items: null,
      });

      const response = await POST(
        createRequest({
          method: 'POST',
          body: {
            note_type: 'death_conference',
            case_id: 'case_1',
            title: 'デスカンファレンス',
            structured_content: {
              sections: [
                {
                  key: 'billing_confirmation',
                  label: '請求根拠確認',
                  body: 'ターミナルケア管理料算定要件を確認。',
                },
                {
                  key: 'medication_at_end',
                  label: '終末期薬剤管理',
                  body: '疼痛コントロール目的でオキシコドンへ切替\nレスキュー使用手順を家族へ共有',
                },
              ],
            },
            participants: [{ name: '田中薬剤師', role: '薬剤師' }],
            conference_date: '2026-03-25T01:00:00.000Z',
          },
        }),
      );

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(201);
      expect(medicationIssueCreateManyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              title: '疼痛コントロール目的でオキシコドンへ切替',
              status: 'resolved',
              category: 'other',
              resolved_by: 'user_1',
            }),
            expect.objectContaining({
              title: 'レスキュー使用手順を家族へ共有',
              status: 'resolved',
            }),
          ]),
        }),
      );
    });
  });

  // ─── Sync: care_team ─────────────────────────────────────────────────────

  describe('POST care_team — sync side-effects', () => {
    beforeEach(() => {
      conferenceNoteCreateMock.mockResolvedValue({
        id: 'note_care1',
        case_id: 'case_1',
        note_type: 'care_team',
        title: '薬剤師間カンファレンス',
        conference_date: new Date('2026-03-29T01:00:00.000Z'),
        participants: [{ name: '鈴木薬剤師', role: '薬剤師' }],
        structured_content: {
          template: 'care_team',
          sections: [
            {
              key: 'medication_issues',
              label: '薬学的課題',
              body: 'アドヒアランス低下を確認\nポリファーマシー対応が必要',
            },
          ],
        },
        metadata: null,
        action_items: null,
      });
    });

    it('creates MedicationIssues from medication_issues section on POST care_team', async () => {
      const response = await POST(
        createRequest({
          method: 'POST',
          body: {
            note_type: 'care_team',
            case_id: 'case_1',
            title: '薬剤師間カンファレンス',
            structured_content: {
              sections: [
                {
                  key: 'medication_issues',
                  label: '薬学的課題',
                  body: 'アドヒアランス低下を確認\nポリファーマシー対応が必要',
                },
              ],
            },
            participants: [{ name: '鈴木薬剤師', role: '薬剤師' }],
            conference_date: '2026-03-29T01:00:00.000Z',
          },
        }),
      );

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(201);

      expect(medicationIssueCreateManyMock).toHaveBeenCalledTimes(1);
      expect(medicationIssueCreateManyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              org_id: 'org_1',
              patient_id: 'patient_1',
              case_id: 'case_1',
              title: 'アドヒアランス低下を確認',
              status: 'open',
              priority: 'medium',
              identified_by: 'user_1',
            }),
            expect.objectContaining({
              title: 'ポリファーマシー対応が必要',
            }),
          ]),
        }),
      );
    });

    it('creates CareReport draft with report_type internal_record on POST care_team', async () => {
      const response = await POST(
        createRequest({
          method: 'POST',
          body: {
            note_type: 'care_team',
            case_id: 'case_1',
            title: '薬剤師間カンファレンス',
            structured_content: {
              sections: [
                {
                  key: 'medication_issues',
                  label: '薬学的課題',
                  body: 'アドヒアランス低下を確認',
                },
              ],
            },
            participants: [{ name: '鈴木薬剤師', role: '薬剤師' }],
            conference_date: '2026-03-29T01:00:00.000Z',
          },
        }),
      );

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(201);

      expect(careReportCreateManyMock).toHaveBeenCalledTimes(1);
      expect(careReportCreateManyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              report_type: 'internal_record',
              status: 'draft',
              content: expect.objectContaining({
                conference_note_id: 'note_care1',
                note_type: 'care_team',
                medication_issues: ['アドヒアランス低下を確認', 'ポリファーマシー対応が必要'],
              }),
            }),
          ]),
        }),
      );
    });

    it('stores case review highlights into visit_brief metadata on POST care_team', async () => {
      conferenceNoteCreateMock.mockResolvedValue({
        id: 'note_care_review',
        case_id: 'case_1',
        note_type: 'care_team',
        title: '多職種カンファレンス',
        conference_date: new Date('2026-03-29T01:00:00.000Z'),
        participants: [{ name: '鈴木薬剤師', role: '薬剤師' }],
        structured_content: {
          template: 'care_team',
          sections: [
            {
              key: 'case_review',
              label: '症例レビュー',
              body: '転倒リスクが上がっている\n服薬自己管理が不安定\n夜間せん妄に注意',
            },
          ],
        },
        metadata: {
          visit_brief: {
            patient_id: 'patient_1',
          },
        },
        action_items: null,
      });

      const response = await POST(
        createRequest({
          method: 'POST',
          body: {
            note_type: 'care_team',
            case_id: 'case_1',
            title: '多職種カンファレンス',
            structured_content: {
              sections: [
                {
                  key: 'case_review',
                  label: '症例レビュー',
                  body: '転倒リスクが上がっている\n服薬自己管理が不安定\n夜間せん妄に注意',
                },
              ],
            },
            participants: [{ name: '鈴木薬剤師', role: '薬剤師' }],
            conference_date: '2026-03-29T01:00:00.000Z',
          },
        }),
      );

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(201);
      expect(conferenceNoteUpdateMock).toHaveBeenCalledWith({
        where: { id: 'note_care_review' },
        data: {
          metadata: expect.objectContaining({
            visit_brief: expect.objectContaining({
              patient_id: 'patient_1',
              summary: '転倒リスクが上がっている\n服薬自己管理が不安定\n夜間せん妄に注意',
              highlighted_risks: [
                '転倒リスクが上がっている',
                '服薬自己管理が不安定',
                '夜間せん妄に注意',
              ],
            }),
          }),
        },
      });
    });

    it('stores intervention outcomes into care_team metadata on POST care_team', async () => {
      conferenceNoteCreateMock.mockResolvedValue({
        id: 'note_care_outcomes',
        case_id: 'case_1',
        note_type: 'care_team',
        title: '多職種カンファレンス',
        conference_date: new Date('2026-03-29T01:00:00.000Z'),
        participants: [{ name: '鈴木薬剤師', role: '薬剤師' }],
        structured_content: {
          template: 'care_team',
          sections: [
            {
              key: 'intervention_outcomes',
              label: '介入結果',
              body: '残薬確認フローを導入して飲み忘れが減少\n家族同席で手技説明し自己注射が安定',
            },
          ],
        },
        metadata: null,
        action_items: null,
      });

      const response = await POST(
        createRequest({
          method: 'POST',
          body: {
            note_type: 'care_team',
            case_id: 'case_1',
            title: '多職種カンファレンス',
            structured_content: {
              sections: [
                {
                  key: 'intervention_outcomes',
                  label: '介入結果',
                  body: '残薬確認フローを導入して飲み忘れが減少\n家族同席で手技説明し自己注射が安定',
                },
              ],
            },
            participants: [{ name: '鈴木薬剤師', role: '薬剤師' }],
            conference_date: '2026-03-29T01:00:00.000Z',
          },
        }),
      );

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(201);
      expect(conferenceNoteUpdateMock).toHaveBeenCalledWith({
        where: { id: 'note_care_outcomes' },
        data: {
          metadata: expect.objectContaining({
            care_team: expect.objectContaining({
              intervention_outcomes: [
                '残薬確認フローを導入して飲み忘れが減少',
                '家族同席で手技説明し自己注射が安定',
              ],
              synced_from_note_id: 'note_care_outcomes',
            }),
          }),
        },
      });
    });

    it('does NOT create MedicationIssues when medication_issues section is absent', async () => {
      conferenceNoteCreateMock.mockResolvedValue({
        id: 'note_care_nomi',
        case_id: 'case_1',
        note_type: 'care_team',
        title: '薬剤師間カンファレンス（課題なし）',
        conference_date: new Date('2026-03-29T01:00:00.000Z'),
        participants: [],
        structured_content: {
          template: 'care_team',
          sections: [{ key: 'discussion_summary', label: '討議要約', body: '情報共有のみ' }],
        },
        metadata: null,
        action_items: null,
      });

      const response = await POST(
        createRequest({
          method: 'POST',
          body: {
            note_type: 'care_team',
            case_id: 'case_1',
            title: '薬剤師間カンファレンス（課題なし）',
            structured_content: {
              sections: [{ key: 'discussion_summary', label: '討議要約', body: '情報共有のみ' }],
            },
            participants: [],
            conference_date: '2026-03-29T01:00:00.000Z',
          },
        }),
      );

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(201);
      expect(medicationIssueCreateManyMock).not.toHaveBeenCalled();
    });

    it('does NOT create BillingCandidate for care_team note type', async () => {
      const response = await POST(
        createRequest({
          method: 'POST',
          body: {
            note_type: 'care_team',
            case_id: 'case_1',
            title: '薬剤師間カンファレンス',
            structured_content: {
              sections: [{ key: 'medication_issues', label: '薬学的課題', body: '課題あり' }],
            },
            participants: [],
            conference_date: '2026-03-29T01:00:00.000Z',
          },
        }),
      );

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(201);
      expect(billingCandidateUpsertMock).not.toHaveBeenCalled();
    });
  });

  describe('POST emergency — sync side-effects', () => {
    beforeEach(() => {
      conferenceNoteCreateMock.mockResolvedValue({
        id: 'note_emergency_1',
        case_id: 'case_1',
        note_type: 'emergency',
        title: '緊急カンファレンス',
        conference_date: new Date('2026-03-30T01:00:00.000Z'),
        participants: [{ name: '鈴木薬剤師', role: '薬剤師' }],
        structured_content: {
          template: 'emergency',
          sections: [
            {
              key: 'immediate_actions',
              label: '即時対応内容',
              body: '主治医へ即時連絡\n当日夕方に再訪',
            },
            {
              key: 'risk_mitigation',
              label: '再発防止',
              body: '服薬セット方法を再評価',
            },
            {
              key: 'incident_summary',
              label: 'インシデント概要',
              body: '内服忘れにより症状悪化',
            },
            {
              key: 'root_cause',
              label: '根本原因',
              body: '服薬カレンダーの運用が崩れていた',
            },
          ],
        },
        metadata: null,
        action_items: [{ title: '家族へ連絡', assignee: '薬剤師' }],
      });
    });

    it('creates urgent immediate-action tasks and high-priority mitigation tasks', async () => {
      const response = await POST(
        createRequest({
          method: 'POST',
          body: {
            note_type: 'emergency',
            case_id: 'case_1',
            title: '緊急カンファレンス',
            structured_content: {
              sections: [
                {
                  key: 'immediate_actions',
                  label: '即時対応内容',
                  body: '主治医へ即時連絡\n当日夕方に再訪',
                },
                {
                  key: 'risk_mitigation',
                  label: '再発防止',
                  body: '服薬セット方法を再評価',
                },
                {
                  key: 'incident_summary',
                  label: 'インシデント概要',
                  body: '内服忘れにより症状悪化',
                },
              ],
            },
            action_items: [{ title: '家族へ連絡', assignee: '薬剤師' }],
            participants: [{ name: '鈴木薬剤師', role: '薬剤師' }],
            conference_date: '2026-03-30T01:00:00.000Z',
          },
        }),
      );

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(201);
      expect(taskCreateManyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              title: '家族へ連絡',
              priority: 'high',
            }),
          ]),
        }),
      );
      expect(upsertOperationalTaskMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          taskType: 'conference_immediate_action',
          title: '即時対応: 主治医へ即時連絡',
          priority: 'urgent',
        }),
      );
      expect(upsertOperationalTaskMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          taskType: 'conference_risk_mitigation',
          title: '再発防止: 服薬セット方法を再評価',
          priority: 'high',
        }),
      );
      await expect(response.json()).resolves.toMatchObject({
        sync: expect.objectContaining({
          tasks_created: 4,
        }),
      });
    });

    it('creates emergency report drafts with structured incident content', async () => {
      const response = await POST(
        createRequest({
          method: 'POST',
          body: {
            note_type: 'emergency',
            case_id: 'case_1',
            title: '緊急カンファレンス',
            structured_content: {
              sections: [
                {
                  key: 'immediate_actions',
                  label: '即時対応内容',
                  body: '主治医へ即時連絡\n当日夕方に再訪',
                },
                {
                  key: 'risk_mitigation',
                  label: '再発防止',
                  body: '服薬セット方法を再評価',
                },
                {
                  key: 'incident_summary',
                  label: 'インシデント概要',
                  body: '内服忘れにより症状悪化',
                },
                {
                  key: 'root_cause',
                  label: '根本原因',
                  body: '服薬カレンダーの運用が崩れていた',
                },
              ],
            },
            action_items: [{ title: '家族へ連絡', assignee: '薬剤師' }],
            participants: [{ name: '鈴木薬剤師', role: '薬剤師' }],
            conference_date: '2026-03-30T01:00:00.000Z',
          },
        }),
      );

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(201);
      expect(careReportCreateManyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              report_type: 'physician_report',
              content: expect.objectContaining({
                sections: [],
                disclosure_scope: expect.objectContaining({
                  audience: 'physician_report',
                  sanitized: true,
                  included_section_keys: expect.arrayContaining([
                    'immediate_actions',
                    'incident_summary',
                  ]),
                  excluded_section_keys: expect.arrayContaining(['risk_mitigation', 'root_cause']),
                }),
                incident_report: expect.objectContaining({
                  summary: '内服忘れにより症状悪化',
                  immediate_actions: ['主治医へ即時連絡', '当日夕方に再訪'],
                }),
              }),
            }),
            expect.objectContaining({
              report_type: 'internal_record',
              content: expect.objectContaining({
                disclosure_scope: expect.objectContaining({
                  audience: 'internal',
                  sanitized: false,
                }),
                incident_report: expect.objectContaining({
                  root_cause: '服薬カレンダーの運用が崩れていた',
                  risk_mitigation: ['服薬セット方法を再評価'],
                }),
              }),
            }),
          ]),
        }),
      );
    });
  });

  // ─── Deduplication guard ─────────────────────────────────────────────────

  it('does not create a duplicate VisitScheduleProposal when one already exists', async () => {
    conferenceNoteCreateMock.mockResolvedValue({
      id: 'note_dup1',
      case_id: 'case_1',
      note_type: 'pre_discharge',
      title: '退院前カンファ（重複）',
      conference_date: new Date('2026-03-28T01:00:00.000Z'),
      participants: [],
      structured_content: {
        template: 'pre_discharge',
        sections: [
          { key: 'discharge_background', label: '退院背景', body: '退院調整済み' },
          { key: 'next_visit_plan', label: '次回訪問計画', body: '退院翌週に初回訪問' },
        ],
      },
      metadata: null,
      action_items: null,
    });

    // Simulate that a proposal already exists for this note
    visitScheduleProposalFindFirstMock.mockResolvedValue({ id: 'existing_proposal' });

    const response = await POST(
      createRequest({
        method: 'POST',
        body: {
          note_type: 'pre_discharge',
          case_id: 'case_1',
          title: '退院前カンファ（重複）',
          structured_content: {
            sections: [
              { key: 'discharge_background', label: '退院背景', body: '退院調整済み' },
              { key: 'next_visit_plan', label: '次回訪問計画', body: '退院翌週に初回訪問' },
            ],
          },
          participants: [],
          conference_date: '2026-03-28T01:00:00.000Z',
        },
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);

    // findFirst found existing → create must NOT be called
    expect(visitScheduleProposalCreateMock).not.toHaveBeenCalled();
    const body = await response.json();
    expect(body.sync.visit_proposal_id).toBe('existing_proposal');
  });
});
