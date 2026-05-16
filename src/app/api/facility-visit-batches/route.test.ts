import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const { withAuthMock, withOrgContextMock } = vi.hoisted(() => ({
  withAuthMock: vi.fn(
    (handler: (req: NextRequest & { orgId: string; userId: string }) => Promise<Response>) => {
      return (req: NextRequest) =>
        handler({
          ...req,
          orgId: 'org_1',
          userId: 'user_1',
        } as NextRequest & { orgId: string; userId: string });
    },
  ),
  withOrgContextMock: vi.fn(),
}));

const { visitScheduleCountMock, notifyWorkflowMutationMock } = vi.hoisted(() => ({
  visitScheduleCountMock: vi.fn(),
  notifyWorkflowMutationMock: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: withAuthMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/workflow-dashboard-cache', () => ({
  notifyWorkflowMutation: notifyWorkflowMutationMock,
}));

import { POST } from './route';

function createRequest(body: unknown) {
  return {
    json: async () => body,
  } as unknown as NextRequest;
}

describe('/api/facility-visit-batches POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    visitScheduleCountMock.mockResolvedValue(2);
    notifyWorkflowMutationMock.mockResolvedValue(undefined);
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
              case_id: 'case_2',
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
          update: scheduleUpdateMock,
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
    expect(preparationUpsertMock).toHaveBeenCalledTimes(2);
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
    const scheduleUpdateMock = vi.fn();

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        visitSchedule: {
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
          update: scheduleUpdateMock,
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

  it('denies requested schedules outside assignment before batch, schedule, preparation, or notify side effects', async () => {
    const batchCreateMock = vi.fn();
    const batchUpdateMock = vi.fn();
    const scheduleUpdateMock = vi.fn();
    const preparationUpsertMock = vi.fn();
    visitScheduleCountMock.mockResolvedValue(2);

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        visitSchedule: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'schedule_1',
              site_id: 'site_1',
              pharmacist_id: 'user_1',
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
          ]),
          count: visitScheduleCountMock,
          update: scheduleUpdateMock,
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
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_FORBIDDEN',
      message: '施設一括訪問に含まれる訪問予定へのアクセス権限がありません',
    });
    expect(visitScheduleCountMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        id: { in: ['schedule_1', 'schedule_2'] },
      },
    });
    expect(batchCreateMock).not.toHaveBeenCalled();
    expect(batchUpdateMock).not.toHaveBeenCalled();
    expect(scheduleUpdateMock).not.toHaveBeenCalled();
    expect(preparationUpsertMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('denies auto-loaded facility schedules outside assignment before side effects', async () => {
    const batchCreateMock = vi.fn();
    const scheduleUpdateMock = vi.fn();
    visitScheduleCountMock.mockResolvedValue(3);

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        visitSchedule: {
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
          update: scheduleUpdateMock,
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
    expect(response.status).toBe(403);
    expect(batchCreateMock).not.toHaveBeenCalled();
    expect(scheduleUpdateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('denies existing batches with inaccessible stale child schedules before side effects', async () => {
    const batchUpdateMock = vi.fn();
    const scheduleUpdateMock = vi.fn();
    const preparationUpsertMock = vi.fn();
    visitScheduleCountMock
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(2);

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        visitSchedule: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'schedule_1',
              site_id: 'site_1',
              pharmacist_id: 'user_1',
              scheduled_date: new Date('2026-03-28T00:00:00Z'),
              facility_batch_id: 'batch_stale',
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
              id: 'schedule_2',
              site_id: 'site_1',
              pharmacist_id: 'user_1',
              scheduled_date: new Date('2026-03-28T00:00:00Z'),
              facility_batch_id: 'batch_stale',
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
          update: scheduleUpdateMock,
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
    expect(response.status).toBe(403);
    expect(visitScheduleCountMock).toHaveBeenNthCalledWith(2, {
      where: { org_id: 'org_1', facility_batch_id: 'batch_stale' },
    });
    expect(visitScheduleCountMock).toHaveBeenNthCalledWith(3, {
      where: {
        org_id: 'org_1',
        facility_batch_id: 'batch_stale',
        AND: [
          {
            OR: [
              { pharmacist_id: 'user_1' },
              { case_: { primary_pharmacist_id: 'user_1' } },
              { case_: { backup_pharmacist_id: 'user_1' } },
            ],
          },
        ],
      },
    });
    expect(batchUpdateMock).not.toHaveBeenCalled();
    expect(scheduleUpdateMock).not.toHaveBeenCalled();
    expect(preparationUpsertMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });
});
