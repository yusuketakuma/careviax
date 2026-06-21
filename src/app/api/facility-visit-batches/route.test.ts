import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

type TestRouteContext = { params: Promise<Record<string, string>> };

const { withAuthContextMock, withOrgContextMock } = vi.hoisted(() => ({
  withAuthContextMock: vi.fn(
    (
      handler: (
        req: NextRequest,
        ctx: { orgId: string; userId: string; role: 'pharmacist' },
        routeContext: TestRouteContext,
      ) => Promise<Response>,
    ) => {
      return (req: NextRequest, routeContext: TestRouteContext = { params: Promise.resolve({}) }) =>
        handler(req, { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' }, routeContext);
    },
  ),
  withOrgContextMock: vi.fn(),
}));

const { visitScheduleCountMock, notifyWorkflowMutationMock } = vi.hoisted(() => ({
  visitScheduleCountMock: vi.fn(),
  notifyWorkflowMutationMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: withAuthContextMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/workflow-dashboard-cache', () => ({
  notifyWorkflowMutation: notifyWorkflowMutationMock,
}));

import { POST as rawPOST } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };
const POST = (req: NextRequest) => rawPOST(req, emptyRouteContext);

type NextRequestInit = ConstructorParameters<typeof NextRequest>[1];

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/facility-visit-batches', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  } satisfies NextRequestInit);
}

function createMalformedRequest() {
  return new NextRequest('http://localhost/api/facility-visit-batches', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"schedule_ids":',
  } satisfies NextRequestInit);
}

describe('/api/facility-visit-batches POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    visitScheduleCountMock.mockResolvedValue(2);
    notifyWorkflowMutationMock.mockResolvedValue(undefined);
  });

  it('rejects non-object JSON payloads before DB lookup or notification', async () => {
    const response = await POST(createRequest([]));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleCountMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before DB lookup or notification', async () => {
    const response = await POST(createMalformedRequest());

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleCountMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects duplicate schedule ids before DB lookup or notification', async () => {
    const response = await POST(
      createRequest({
        schedule_ids: ['schedule_1', 'schedule_1'],
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '同じ訪問予定IDを複数回指定できません',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleCountMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects duplicate ordered schedule ids before DB lookup or notification', async () => {
    const response = await POST(
      createRequest({
        schedule_ids: ['schedule_1', 'schedule_2'],
        ordered_schedule_ids: ['schedule_2', 'schedule_2'],
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '同じ順序指定IDを複数回指定できません',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleCountMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects schedules that span multiple facilities', async () => {
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        visitSchedule: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'schedule_1',
              site_id: 'site_1',
              pharmacist_id: 'ph_1',
              scheduled_date: new Date('2026-03-28T00:00:00Z'),
              facility_batch_id: null,
              version: 7,
              case_id: 'case_1',
              preparation: null,
              case_: {
                patient: {
                  id: 'patient_1',
                  name: '山田 太郎',
                  residences: [
                    {
                      facility_id: 'facility_a',
                      building_id: 'facility_a',
                      address: '東京都港区1-1-1',
                      unit_name: '101',
                    },
                  ],
                },
              },
            },
            {
              id: 'schedule_2',
              site_id: 'site_1',
              pharmacist_id: 'ph_1',
              scheduled_date: new Date('2026-03-28T00:00:00Z'),
              facility_batch_id: null,
              version: 3,
              case_id: 'case_2',
              preparation: null,
              case_: {
                patient: {
                  id: 'patient_2',
                  name: '山田 花子',
                  residences: [
                    {
                      facility_id: 'facility_b',
                      building_id: 'facility_b',
                      address: '東京都港区2-2-2',
                      unit_name: '102',
                    },
                  ],
                },
              },
            },
          ]),
          count: visitScheduleCountMock,
        },
        facilityVisitBatch: {
          create: vi.fn(),
          update: vi.fn(),
        },
      }),
    );

    const response = await POST(
      createRequest({
        schedule_ids: ['schedule_1', 'schedule_2'],
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '同一施設の訪問予定のみを一括化できます',
      details: {
        facilities: ['facility_a', 'facility_b'],
      },
    });
  });

  it('creates a facility batch, orders schedules, and bulk-confirms carry items', async () => {
    const batchCreateMock = vi.fn().mockResolvedValue({ id: 'batch_1' });
    const scheduleUpdateMock = vi.fn().mockResolvedValue({ count: 1 });
    const preparationUpsertMock = vi.fn();

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        visitSchedule: {
          findFirst: vi.fn().mockResolvedValue(null),
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'schedule_1',
              site_id: 'site_1',
              pharmacist_id: 'ph_1',
              scheduled_date: new Date('2026-03-28T00:00:00Z'),
              facility_batch_id: null,
              version: 7,
              case_id: 'case_1',
              carry_items_status: 'ready',
              preparation: {
                id: 'prep_1',
                checklist: { carry_items_confirmed: false },
                medication_changes_reviewed: true,
                carry_items_confirmed: false,
                previous_issues_reviewed: true,
                route_confirmed: true,
                offline_synced: true,
                prepared_at: null,
              },
              case_: {
                patient: {
                  id: 'patient_1',
                  name: '山田 太郎',
                  residences: [
                    {
                      facility_id: 'facility_a',
                      building_id: 'facility_a',
                      address: '東京都港区1-1-1',
                      unit_name: '201',
                    },
                  ],
                },
              },
            },
            {
              id: 'schedule_2',
              site_id: 'site_1',
              pharmacist_id: 'ph_1',
              scheduled_date: new Date('2026-03-28T00:00:00Z'),
              facility_batch_id: null,
              version: 3,
              case_id: 'case_2',
              carry_items_status: 'ready',
              preparation: {
                id: 'prep_2',
                checklist: {},
                medication_changes_reviewed: false,
                carry_items_confirmed: false,
                previous_issues_reviewed: false,
                route_confirmed: false,
                offline_synced: false,
                prepared_at: null,
              },
              case_: {
                patient: {
                  id: 'patient_2',
                  name: '山田 花子',
                  residences: [
                    {
                      facility_id: 'facility_a',
                      building_id: 'facility_a',
                      address: '東京都港区1-1-1',
                      unit_name: '105',
                    },
                  ],
                },
              },
            },
          ]),
          count: visitScheduleCountMock,
          updateMany: scheduleUpdateMock,
        },
        visitScheduleProposal: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
        facilityVisitBatch: {
          create: batchCreateMock,
          update: vi.fn(),
        },
        visitPreparation: {
          upsert: preparationUpsertMock,
        },
      }),
    );

    const response = await POST(
      createRequest({
        schedule_ids: ['schedule_1', 'schedule_2'],
        ordered_schedule_ids: ['schedule_2', 'schedule_1'],
        carry_items_confirmed: true,
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      batch_id: 'batch_1',
      facility_label: 'facility_a',
      patient_count: 2,
      carry_items_confirmed: true,
      schedules: [
        {
          schedule_id: 'schedule_2',
          patient_name: '山田 花子',
          unit_name: '105',
          route_order: 1,
        },
        {
          schedule_id: 'schedule_1',
          patient_name: '山田 太郎',
          unit_name: '201',
          route_order: 2,
        },
      ],
    });
    expect(batchCreateMock).toHaveBeenCalledTimes(1);
    expect(scheduleUpdateMock).toHaveBeenCalledTimes(2);
    expect(scheduleUpdateMock).toHaveBeenNthCalledWith(1, {
      where: {
        org_id: 'org_1',
        id: 'schedule_2',
        facility_batch_id: null,
        version: 3,
      },
      data: {
        facility_batch_id: 'batch_1',
        route_order: 1,
        version: { increment: 1 },
      },
    });
    expect(preparationUpsertMock).toHaveBeenCalledTimes(2);
  });

  it('rejects facility batch route orders that conflict with an existing schedule', async () => {
    const batchCreateMock = vi.fn();
    const scheduleUpdateMock = vi.fn();
    const scheduleConflictFindFirstMock = vi.fn().mockResolvedValue({ id: 'schedule_other' });
    const proposalConflictFindFirstMock = vi.fn().mockResolvedValue(null);

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        visitSchedule: {
          findFirst: scheduleConflictFindFirstMock,
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'schedule_1',
              site_id: 'site_1',
              pharmacist_id: 'ph_1',
              scheduled_date: new Date('2026-03-28T00:00:00Z'),
              facility_batch_id: null,
              version: 7,
              case_id: 'case_1',
              carry_items_status: 'ready',
              preparation: null,
              case_: {
                patient: {
                  id: 'patient_1',
                  name: '山田 太郎',
                  residences: [
                    {
                      facility_id: 'facility_a',
                      building_id: 'facility_a',
                      address: '東京都港区1-1-1',
                      unit_name: '201',
                    },
                  ],
                },
              },
            },
            {
              id: 'schedule_2',
              site_id: 'site_1',
              pharmacist_id: 'ph_1',
              scheduled_date: new Date('2026-03-28T00:00:00Z'),
              facility_batch_id: null,
              version: 3,
              case_id: 'case_2',
              carry_items_status: 'ready',
              preparation: null,
              case_: {
                patient: {
                  id: 'patient_2',
                  name: '山田 花子',
                  residences: [
                    {
                      facility_id: 'facility_a',
                      building_id: 'facility_a',
                      address: '東京都港区1-1-1',
                      unit_name: '105',
                    },
                  ],
                },
              },
            },
          ]),
          count: visitScheduleCountMock,
          updateMany: scheduleUpdateMock,
        },
        visitScheduleProposal: {
          findFirst: proposalConflictFindFirstMock,
        },
        facilityVisitBatch: {
          create: batchCreateMock,
          update: vi.fn(),
        },
        visitPreparation: {
          upsert: vi.fn(),
        },
      }),
    );

    const response = await POST(
      createRequest({
        schedule_ids: ['schedule_1', 'schedule_2'],
        ordered_schedule_ids: ['schedule_2', 'schedule_1'],
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '同一セル内で route_order は重複できません',
    });
    expect(scheduleConflictFindFirstMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        id: { notIn: ['schedule_2', 'schedule_1'] },
        OR: [
          {
            pharmacist_id: 'ph_1',
            scheduled_date: new Date('2026-03-28'),
            route_order: 1,
          },
          {
            pharmacist_id: 'ph_1',
            scheduled_date: new Date('2026-03-28'),
            route_order: 2,
          },
        ],
      },
      select: { id: true },
    });
    expect(proposalConflictFindFirstMock).toHaveBeenCalled();
    expect(batchCreateMock).not.toHaveBeenCalled();
    expect(scheduleUpdateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects facility batch route orders that conflict with an open proposal', async () => {
    const batchCreateMock = vi.fn();
    const scheduleUpdateMock = vi.fn();
    const scheduleConflictFindFirstMock = vi.fn().mockResolvedValue(null);
    const proposalConflictFindFirstMock = vi.fn().mockResolvedValue({ id: 'proposal_1' });

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        visitSchedule: {
          findFirst: scheduleConflictFindFirstMock,
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'schedule_1',
              site_id: 'site_1',
              pharmacist_id: 'ph_1',
              scheduled_date: new Date('2026-03-28T00:00:00Z'),
              facility_batch_id: null,
              version: 7,
              case_id: 'case_1',
              carry_items_status: 'ready',
              preparation: null,
              case_: {
                patient: {
                  id: 'patient_1',
                  name: '山田 太郎',
                  residences: [
                    {
                      facility_id: 'facility_a',
                      building_id: 'facility_a',
                      address: '東京都港区1-1-1',
                      unit_name: '201',
                    },
                  ],
                },
              },
            },
            {
              id: 'schedule_2',
              site_id: 'site_1',
              pharmacist_id: 'ph_1',
              scheduled_date: new Date('2026-03-28T00:00:00Z'),
              facility_batch_id: null,
              version: 3,
              case_id: 'case_2',
              carry_items_status: 'ready',
              preparation: null,
              case_: {
                patient: {
                  id: 'patient_2',
                  name: '山田 花子',
                  residences: [
                    {
                      facility_id: 'facility_a',
                      building_id: 'facility_a',
                      address: '東京都港区1-1-1',
                      unit_name: '105',
                    },
                  ],
                },
              },
            },
          ]),
          count: visitScheduleCountMock,
          updateMany: scheduleUpdateMock,
        },
        visitScheduleProposal: {
          findFirst: proposalConflictFindFirstMock,
        },
        facilityVisitBatch: {
          create: batchCreateMock,
          update: vi.fn(),
        },
        visitPreparation: {
          upsert: vi.fn(),
        },
      }),
    );

    const response = await POST(
      createRequest({
        schedule_ids: ['schedule_1', 'schedule_2'],
        ordered_schedule_ids: ['schedule_2', 'schedule_1'],
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '同一セル内で route_order は重複できません',
    });
    expect(proposalConflictFindFirstMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        finalized_schedule_id: null,
        proposal_status: {
          in: ['proposed', 'patient_contact_pending', 'reschedule_pending'],
        },
        OR: [
          {
            proposed_pharmacist_id: 'ph_1',
            proposed_date: new Date('2026-03-28'),
            route_order: 1,
          },
          {
            proposed_pharmacist_id: 'ph_1',
            proposed_date: new Date('2026-03-28'),
            route_order: 2,
          },
        ],
      },
      select: { id: true },
    });
    expect(batchCreateMock).not.toHaveBeenCalled();
    expect(scheduleUpdateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('returns conflict when a target schedule changes before guarded batch write', async () => {
    const batchCreateMock = vi.fn().mockResolvedValue({ id: 'batch_1' });
    const scheduleUpdateMock = vi.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({
      count: 0,
    });

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        visitSchedule: {
          findFirst: vi.fn().mockResolvedValue(null),
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'schedule_1',
              site_id: 'site_1',
              pharmacist_id: 'ph_1',
              scheduled_date: new Date('2026-03-28T00:00:00Z'),
              facility_batch_id: null,
              version: 7,
              case_id: 'case_1',
              carry_items_status: 'ready',
              preparation: null,
              case_: {
                patient: {
                  id: 'patient_1',
                  name: '山田 太郎',
                  residences: [
                    {
                      facility_id: 'facility_a',
                      building_id: 'facility_a',
                      address: '東京都港区1-1-1',
                      unit_name: '201',
                    },
                  ],
                },
              },
            },
            {
              id: 'schedule_2',
              site_id: 'site_1',
              pharmacist_id: 'ph_1',
              scheduled_date: new Date('2026-03-28T00:00:00Z'),
              facility_batch_id: null,
              version: 3,
              case_id: 'case_2',
              carry_items_status: 'ready',
              preparation: null,
              case_: {
                patient: {
                  id: 'patient_2',
                  name: '山田 花子',
                  residences: [
                    {
                      facility_id: 'facility_a',
                      building_id: 'facility_a',
                      address: '東京都港区1-1-1',
                      unit_name: '105',
                    },
                  ],
                },
              },
            },
          ]),
          count: visitScheduleCountMock,
          updateMany: scheduleUpdateMock,
        },
        visitScheduleProposal: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
        facilityVisitBatch: {
          create: batchCreateMock,
          update: vi.fn(),
        },
        visitPreparation: {
          upsert: vi.fn(),
        },
      }),
    );

    const response = await POST(
      createRequest({
        schedule_ids: ['schedule_1', 'schedule_2'],
        ordered_schedule_ids: ['schedule_2', 'schedule_1'],
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '施設一括訪問の対象予定が同時に更新されました。再読み込みしてください',
    });
    expect(batchCreateMock).toHaveBeenCalledTimes(1);
    expect(scheduleUpdateMock).toHaveBeenCalledTimes(2);
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it.each([
    ['blocked', '持参薬が未確定です'],
    ['partial', '持参物の一部が未確定です'],
    [null, '持参物ステータス未判定'],
  ] as const)(
    'rejects bulk carry confirmation when a target carry status is %s before side effects',
    async (carryItemsStatus, reason) => {
      const batchCreateMock = vi.fn();
      const scheduleUpdateMock = vi.fn();
      const preparationUpsertMock = vi.fn();

      withOrgContextMock.mockImplementation(async (_orgId, callback) =>
        callback({
          visitSchedule: {
            findMany: vi.fn().mockResolvedValue([
              {
                id: 'schedule_1',
                site_id: 'site_1',
                pharmacist_id: 'ph_1',
                scheduled_date: new Date('2026-03-28T00:00:00Z'),
                facility_batch_id: null,
                case_id: 'case_1',
                carry_items_status: 'ready',
                preparation: null,
                case_: {
                  patient: {
                    id: 'patient_1',
                    name: '山田 太郎',
                    residences: [
                      {
                        facility_id: 'facility_a',
                        building_id: 'facility_a',
                        address: '東京都港区1-1-1',
                        unit_name: '201',
                      },
                    ],
                  },
                },
              },
              {
                id: 'schedule_2',
                site_id: 'site_1',
                pharmacist_id: 'ph_1',
                scheduled_date: new Date('2026-03-28T00:00:00Z'),
                facility_batch_id: null,
                case_id: 'case_2',
                carry_items_status: carryItemsStatus,
                preparation: null,
                case_: {
                  patient: {
                    id: 'patient_2',
                    name: '山田 花子',
                    residences: [
                      {
                        facility_id: 'facility_a',
                        building_id: 'facility_a',
                        address: '東京都港区1-1-1',
                        unit_name: '105',
                      },
                    ],
                  },
                },
              },
            ]),
            count: visitScheduleCountMock,
            updateMany: scheduleUpdateMock,
          },
          facilityVisitBatch: {
            create: batchCreateMock,
            update: vi.fn(),
          },
          visitPreparation: {
            upsert: preparationUpsertMock,
          },
        }),
      );

      const response = await POST(
        createRequest({
          schedule_ids: ['schedule_1', 'schedule_2'],
          ordered_schedule_ids: ['schedule_2', 'schedule_1'],
          carry_items_confirmed: true,
        }),
      );

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: '未解決の持参物があるため、施設一括の持参確認はできません',
        details: {
          unsafe_carry_items: [
            {
              schedule_id: 'schedule_2',
              patient_name: '山田 花子',
              unit_name: '105',
              carry_items_status: carryItemsStatus,
              reason,
            },
          ],
        },
      });
      expect(batchCreateMock).not.toHaveBeenCalled();
      expect(scheduleUpdateMock).not.toHaveBeenCalled();
      expect(preparationUpsertMock).not.toHaveBeenCalled();
      expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
    },
  );

  it('groups schedules by local calendar date before creating a facility batch', async () => {
    const batchCreateMock = vi.fn().mockResolvedValue({ id: 'batch_local_day' });
    const scheduleUpdateMock = vi.fn().mockResolvedValue({ count: 1 });

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        visitSchedule: {
          findFirst: vi.fn().mockResolvedValue(null),
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'schedule_midnight',
              site_id: 'site_1',
              pharmacist_id: 'ph_1',
              scheduled_date: new Date(2026, 2, 28, 0, 0, 0),
              facility_batch_id: null,
              version: 11,
              case_id: 'case_1',
              preparation: null,
              case_: {
                patient: {
                  id: 'patient_1',
                  name: '山田 太郎',
                  residences: [
                    {
                      facility_id: 'facility_a',
                      building_id: 'facility_a',
                      address: '東京都港区1-1-1',
                      unit_name: '201',
                    },
                  ],
                },
              },
            },
            {
              id: 'schedule_daytime',
              site_id: 'site_1',
              pharmacist_id: 'ph_1',
              scheduled_date: new Date(2026, 2, 28, 13, 0, 0),
              facility_batch_id: null,
              version: 12,
              case_id: 'case_2',
              preparation: null,
              case_: {
                patient: {
                  id: 'patient_2',
                  name: '山田 花子',
                  residences: [
                    {
                      facility_id: 'facility_a',
                      building_id: 'facility_a',
                      address: '東京都港区1-1-1',
                      unit_name: '105',
                    },
                  ],
                },
              },
            },
          ]),
          count: visitScheduleCountMock,
          updateMany: scheduleUpdateMock,
        },
        visitScheduleProposal: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
        facilityVisitBatch: {
          create: batchCreateMock,
          update: vi.fn(),
        },
        visitPreparation: {
          upsert: vi.fn(),
        },
      }),
    );

    const response = await POST(
      createRequest({
        schedule_ids: ['schedule_midnight', 'schedule_daytime'],
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      batch_id: 'batch_local_day',
      facility_label: 'facility_a',
      patient_count: 2,
    });
    expect(batchCreateMock).toHaveBeenCalledTimes(1);
    expect(scheduleUpdateMock).toHaveBeenCalledTimes(2);
    expect(notifyWorkflowMutationMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      payload: { source: 'facility_visit_batches_upsert' },
    });
  });

  it('rejects schedules that span multiple facility units', async () => {
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        visitSchedule: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'schedule_1',
              site_id: 'site_1',
              pharmacist_id: 'ph_1',
              scheduled_date: new Date('2026-03-28T00:00:00Z'),
              facility_batch_id: null,
              version: 21,
              case_id: 'case_1',
              preparation: null,
              case_: {
                patient: {
                  id: 'patient_1',
                  name: '山田 太郎',
                  residences: [
                    {
                      facility_id: 'facility_a',
                      facility_unit_id: 'unit_1',
                      building_id: 'facility_a',
                      address: '東京都港区1-1-1',
                      unit_name: '101',
                    },
                  ],
                },
              },
            },
            {
              id: 'schedule_2',
              site_id: 'site_1',
              pharmacist_id: 'ph_1',
              scheduled_date: new Date('2026-03-28T00:00:00Z'),
              facility_batch_id: null,
              version: 22,
              case_id: 'case_2',
              preparation: null,
              case_: {
                patient: {
                  id: 'patient_2',
                  name: '山田 花子',
                  residences: [
                    {
                      facility_id: 'facility_a',
                      facility_unit_id: 'unit_2',
                      building_id: 'facility_a',
                      address: '東京都港区1-1-1',
                      unit_name: '102',
                    },
                  ],
                },
              },
            },
          ]),
          count: visitScheduleCountMock,
        },
        facilityVisitBatch: {
          create: vi.fn(),
          update: vi.fn(),
        },
      }),
    );

    const response = await POST(
      createRequest({
        schedule_ids: ['schedule_1', 'schedule_2'],
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '同一ユニットの訪問予定のみを一括化できます',
    });
  });

  it('auto-loads facility schedules when facility_id, scheduled_date, and pharmacist_id are given', async () => {
    const batchCreateMock = vi.fn().mockResolvedValue({ id: 'batch_auto_1' });
    const scheduleUpdateMock = vi.fn().mockResolvedValue({ count: 1 });

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        visitSchedule: {
          findFirst: vi.fn().mockResolvedValue(null),
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'schedule_auto_1',
              site_id: 'site_1',
              pharmacist_id: 'ph_1',
              scheduled_date: new Date('2026-03-28T00:00:00Z'),
              facility_batch_id: null,
              case_id: 'case_1',
              preparation: null,
              case_: {
                patient: {
                  id: 'patient_1',
                  name: '山田 太郎',
                  residences: [
                    {
                      facility_id: 'facility_a',
                      building_id: 'facility_a',
                      address: '東京都港区1-1-1',
                      unit_name: '201',
                    },
                  ],
                },
              },
            },
            {
              id: 'schedule_auto_2',
              site_id: 'site_1',
              pharmacist_id: 'ph_1',
              scheduled_date: new Date('2026-03-28T00:00:00Z'),
              facility_batch_id: null,
              case_id: 'case_2',
              preparation: null,
              case_: {
                patient: {
                  id: 'patient_2',
                  name: '山田 花子',
                  residences: [
                    {
                      facility_id: 'facility_a',
                      building_id: 'facility_a',
                      address: '東京都港区1-1-1',
                      unit_name: '105',
                    },
                  ],
                },
              },
            },
          ]),
          count: visitScheduleCountMock,
          updateMany: scheduleUpdateMock,
        },
        visitScheduleProposal: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
        facilityVisitBatch: {
          create: batchCreateMock,
          update: vi.fn(),
        },
        visitPreparation: {
          upsert: vi.fn(),
        },
      }),
    );

    const response = await POST(
      createRequest({
        facility_id: 'facility_a',
        scheduled_date: '2026-03-28',
        pharmacist_id: 'ph_1',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      batch_id: 'batch_auto_1',
      facility_label: 'facility_a',
      patient_count: 2,
    });
    expect(batchCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          facility_id: 'facility_a',
          pharmacist_id: 'ph_1',
          patient_ids: ['patient_2', 'patient_1'],
        }),
      }),
    );
  });

  it('does not assignment-scope requested schedule lookups for org-wide roles', async () => {
    const batchCreateMock = vi.fn().mockResolvedValue({ id: 'batch_org_wide' });
    const batchUpdateMock = vi.fn();
    const scheduleUpdateMock = vi.fn().mockResolvedValue({ count: 1 });
    const preparationUpsertMock = vi.fn();
    const scheduleFindManyMock = vi.fn().mockResolvedValue([
      {
        id: 'schedule_1',
        site_id: 'site_1',
        pharmacist_id: 'other_user',
        scheduled_date: new Date('2026-03-28T00:00:00Z'),
        facility_batch_id: null,
        version: 1,
        case_id: 'case_1',
        carry_items_status: 'ready',
        preparation: null,
        case_: {
          patient: {
            id: 'patient_1',
            name: '山田 太郎',
            residences: [
              {
                facility_id: 'facility_a',
                building_id: 'facility_a',
                address: '東京都港区1-1-1',
                unit_name: '201',
              },
            ],
          },
        },
      },
      {
        id: 'schedule_2',
        site_id: 'site_1',
        pharmacist_id: 'other_user',
        scheduled_date: new Date('2026-03-28T00:00:00Z'),
        facility_batch_id: null,
        version: 1,
        case_id: 'case_2',
        carry_items_status: 'ready',
        preparation: null,
        case_: {
          patient: {
            id: 'patient_2',
            name: '山田 花子',
            residences: [
              {
                facility_id: 'facility_a',
                building_id: 'facility_a',
                address: '東京都港区1-1-1',
                unit_name: '105',
              },
            ],
          },
        },
      },
    ]);

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        visitSchedule: {
          findFirst: vi.fn().mockResolvedValue(null),
          findMany: scheduleFindManyMock,
          count: visitScheduleCountMock,
          updateMany: scheduleUpdateMock,
        },
        visitScheduleProposal: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
        facilityVisitBatch: {
          create: batchCreateMock,
          update: batchUpdateMock,
        },
        visitPreparation: {
          upsert: preparationUpsertMock,
        },
      }),
    );

    const response = await POST(
      createRequest({
        schedule_ids: ['schedule_1', 'schedule_2'],
        carry_items_confirmed: true,
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    // org-wide ロール(pharmacist)は担当割当をバイパスするため、
    // 取得 where に AND の割当条件は付かず、件数突合のための count も行われない。
    expect(scheduleFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          id: { in: ['schedule_1', 'schedule_2'] },
        },
      }),
    );
    expect(visitScheduleCountMock).not.toHaveBeenCalled();
    expect(batchCreateMock).toHaveBeenCalledTimes(1);
    expect(notifyWorkflowMutationMock).toHaveBeenCalled();
  });

  it('does not assignment-scope auto-loaded facility schedules for org-wide roles', async () => {
    const batchCreateMock = vi.fn().mockResolvedValue({ id: 'batch_auto_org_wide' });
    const scheduleUpdateMock = vi.fn().mockResolvedValue({ count: 1 });
    const scheduleFindManyMock = vi.fn().mockResolvedValue([
      {
        id: 'schedule_auto_1',
        site_id: 'site_1',
        pharmacist_id: 'ph_1',
        scheduled_date: new Date('2026-03-28T00:00:00Z'),
        facility_batch_id: null,
        version: 1,
        case_id: 'case_1',
        carry_items_status: 'ready',
        preparation: null,
        case_: {
          patient: {
            id: 'patient_1',
            name: '山田 太郎',
            residences: [
              {
                facility_id: 'facility_a',
                building_id: 'facility_a',
                address: '東京都港区1-1-1',
                unit_name: '201',
              },
            ],
          },
        },
      },
      {
        id: 'schedule_auto_2',
        site_id: 'site_1',
        pharmacist_id: 'ph_1',
        scheduled_date: new Date('2026-03-28T00:00:00Z'),
        facility_batch_id: null,
        version: 1,
        case_id: 'case_2',
        carry_items_status: 'ready',
        preparation: null,
        case_: {
          patient: {
            id: 'patient_2',
            name: '山田 花子',
            residences: [
              {
                facility_id: 'facility_a',
                building_id: 'facility_a',
                address: '東京都港区1-1-1',
                unit_name: '105',
              },
            ],
          },
        },
      },
    ]);

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        visitSchedule: {
          findFirst: vi.fn().mockResolvedValue(null),
          findMany: scheduleFindManyMock,
          count: visitScheduleCountMock,
          updateMany: scheduleUpdateMock,
        },
        visitScheduleProposal: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
        facilityVisitBatch: {
          create: batchCreateMock,
          update: vi.fn(),
        },
        visitPreparation: {
          upsert: vi.fn(),
        },
      }),
    );

    const response = await POST(
      createRequest({
        facility_id: 'facility_a',
        scheduled_date: '2026-03-28',
        pharmacist_id: 'ph_1',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    // org-wide ロールは担当割当の件数突合を行わないため count は呼ばれない
    expect(visitScheduleCountMock).not.toHaveBeenCalled();
    expect(batchCreateMock).toHaveBeenCalledTimes(1);
    expect(scheduleUpdateMock).toHaveBeenCalledTimes(2);
    expect(notifyWorkflowMutationMock).toHaveBeenCalled();
  });

  it('does not run stale-batch access counts for org-wide roles on existing batches', async () => {
    const batchUpdateMock = vi.fn().mockResolvedValue({ id: 'batch_stale', notes: null });
    const scheduleUpdateMock = vi.fn().mockResolvedValue({ count: 1 });
    const preparationUpsertMock = vi.fn().mockResolvedValue({});

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        visitSchedule: {
          findFirst: vi.fn().mockResolvedValue(null),
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'schedule_1',
              site_id: 'site_1',
              pharmacist_id: 'user_1',
              scheduled_date: new Date('2026-03-28T00:00:00Z'),
              facility_batch_id: 'batch_stale',
              version: 1,
              case_id: 'case_1',
              carry_items_status: 'ready',
              preparation: null,
              case_: {
                patient: {
                  id: 'patient_1',
                  name: '山田 太郎',
                  residences: [
                    {
                      facility_id: 'facility_a',
                      building_id: 'facility_a',
                      address: '東京都港区1-1-1',
                      unit_name: '201',
                    },
                  ],
                },
              },
            },
            {
              id: 'schedule_2',
              site_id: 'site_1',
              pharmacist_id: 'user_1',
              scheduled_date: new Date('2026-03-28T00:00:00Z'),
              facility_batch_id: 'batch_stale',
              version: 1,
              case_id: 'case_2',
              carry_items_status: 'ready',
              preparation: null,
              case_: {
                patient: {
                  id: 'patient_2',
                  name: '山田 花子',
                  residences: [
                    {
                      facility_id: 'facility_a',
                      building_id: 'facility_a',
                      address: '東京都港区1-1-1',
                      unit_name: '105',
                    },
                  ],
                },
              },
            },
          ]),
          count: visitScheduleCountMock,
          updateMany: scheduleUpdateMock,
        },
        visitScheduleProposal: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
        facilityVisitBatch: {
          create: vi.fn(),
          update: batchUpdateMock,
        },
        visitPreparation: {
          upsert: preparationUpsertMock,
        },
      }),
    );

    const response = await POST(
      createRequest({
        schedule_ids: ['schedule_1', 'schedule_2'],
        carry_items_confirmed: true,
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    // org-wide ロールは既存バッチの担当アクセス突合(count)を一切行わない
    expect(visitScheduleCountMock).not.toHaveBeenCalled();
    expect(batchUpdateMock).toHaveBeenCalledTimes(1);
    expect(scheduleUpdateMock).toHaveBeenCalledTimes(2);
    expect(notifyWorkflowMutationMock).toHaveBeenCalled();
  });
});
