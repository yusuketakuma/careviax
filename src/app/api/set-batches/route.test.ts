import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';

const { authMock, prismaMock, withOrgContextMock, txMock, notifyWorkflowMutationMock } = vi.hoisted(
  () => ({
    authMock: vi.fn(),
    prismaMock: {
      membership: { findFirst: vi.fn() },
      setBatch: { findMany: vi.fn() },
    },
    withOrgContextMock: vi.fn(),
    notifyWorkflowMutationMock: vi.fn(),
    txMock: {
      setPlan: { findFirst: vi.fn(), updateMany: vi.fn() },
      prescriptionIntake: { findFirst: vi.fn() },
      prescriptionLine: { findFirst: vi.fn() },
      drugMaster: { findMany: vi.fn() },
      setBatch: { findFirst: vi.fn(), aggregate: vi.fn(), create: vi.fn() },
      setBatchChangeLog: { create: vi.fn() },
    },
  }),
);

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/workflow-dashboard-cache', () => ({
  notifyWorkflowMutation: notifyWorkflowMutationMock,
}));

import { GET, POST } from './route';

const CURRENT_PLAN_UPDATED_AT = '2026-06-18T00:00:00.000Z';
const CURRENT_PLAN_UPDATED_AT_DATE = new Date(CURRENT_PLAN_UPDATED_AT);

function buildSerializableConflictError() {
  return new Prisma.PrismaClientKnownRequestError('Serializable transaction conflict', {
    code: 'P2034',
    clientVersion: 'test',
  });
}

function createRequest(body: unknown) {
  const bodyWithDefaults =
    body &&
    typeof body === 'object' &&
    !Array.isArray(body) &&
    'plan_id' in body &&
    !Object.prototype.hasOwnProperty.call(body, 'expected_updated_at')
      ? { ...body, expected_updated_at: CURRENT_PLAN_UPDATED_AT }
      : body;

  return new NextRequest('http://localhost/api/set-batches', {
    method: 'POST',
    headers: {
      'x-org-id': 'org_1',
      'content-type': 'application/json',
    },
    body: JSON.stringify(bodyWithDefaults),
  });
}

function createMalformedPostRequest() {
  return new NextRequest('http://localhost/api/set-batches', {
    method: 'POST',
    headers: {
      'x-org-id': 'org_1',
      'content-type': 'application/json',
    },
    body: '{"plan_id":',
  });
}

function createGetRequest(url: string) {
  return new NextRequest(url, {
    headers: {
      'x-org-id': 'org_1',
    },
  });
}

describe('set-batches POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    prismaMock.membership.findFirst.mockResolvedValue({ role: 'admin' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) => callback(txMock));
    txMock.prescriptionIntake.findFirst.mockResolvedValue({ id: 'intake_current' });
    txMock.setPlan.updateMany.mockResolvedValue({ count: 1 });
    txMock.setBatch.aggregate.mockResolvedValue({ _sum: { quantity: 0 } });
    txMock.drugMaster.findMany.mockResolvedValue([]);
  });

  it('returns an empty batch list for trainee users when the plan belongs to an unassigned case', async () => {
    prismaMock.membership.findFirst.mockResolvedValue({ role: 'pharmacist_trainee' });
    prismaMock.setBatch.findMany.mockResolvedValue([]);

    const response = await GET(
      createGetRequest('http://localhost/api/set-batches?plan_id=plan_1'),
      {
        params: Promise.resolve({}),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    await expect(response.json()).resolves.toMatchObject({ data: [] });
    expect(prismaMock.setBatch.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          plan_id: 'plan_1',
          org_id: 'org_1',
        },
      }),
    );
  });

  it('returns a no-store validation error when plan_id is missing', async () => {
    const response = await GET(createGetRequest('http://localhost/api/set-batches'), {
      params: Promise.resolve({}),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'plan_id は必須パラメータです',
    });
    expect(prismaMock.setBatch.findMany).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when set-batch list lookup fails unexpectedly', async () => {
    prismaMock.setBatch.findMany.mockRejectedValueOnce(
      new Error('患者 山田太郎 raw set batch list drug packaging instruction'),
    );

    const response = await GET(
      createGetRequest('http://localhost/api/set-batches?plan_id=plan_1'),
      {
        params: Promise.resolve({}),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(JSON.stringify(body)).not.toContain('山田太郎');
    expect(JSON.stringify(body)).not.toContain('raw set batch list');
    expect(JSON.stringify(body)).not.toContain('drug packaging instruction');
  });

  it('rejects lines that do not belong to the plan cycle', async () => {
    txMock.setPlan.findFirst.mockResolvedValue({
      id: 'plan_1',
      cycle_id: 'cycle_1',
      updated_at: CURRENT_PLAN_UPDATED_AT_DATE,
      cycle: {
        overall_status: 'setting',
        case_: {
          patient: {
            packaging_profile: null,
          },
        },
      },
    });
    txMock.prescriptionLine.findFirst.mockResolvedValue({
      id: 'line_1',
      drug_name: 'Drug A',
      packaging_method: null,
      packaging_instructions: null,
      packaging_instruction_tags: [],
      notes: null,
      intake: { cycle_id: 'cycle_2' },
    });

    const response = await POST(
      createRequest({
        plan_id: 'plan_1',
        line_id: 'line_1',
        slot: 'morning',
        day_number: 1,
        quantity: 1,
        carry_type: 'carry',
      }),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
  });

  it('rejects prescription lines from stale intakes before batch creation', async () => {
    txMock.setPlan.findFirst.mockResolvedValue({
      id: 'plan_1',
      cycle_id: 'cycle_1',
      updated_at: CURRENT_PLAN_UPDATED_AT_DATE,
      cycle: {
        overall_status: 'setting',
        case_: {
          patient: {
            packaging_profile: null,
          },
        },
      },
    });
    txMock.prescriptionIntake.findFirst.mockResolvedValue({ id: 'intake_current' });
    txMock.prescriptionLine.findFirst.mockResolvedValue(null);

    const response = await POST(
      createRequest({
        plan_id: 'plan_1',
        line_id: 'line_stale',
        slot: 'morning',
        day_number: 1,
        quantity: 1,
        carry_type: 'carry',
      }),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expect(txMock.prescriptionLine.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'line_stale',
          org_id: 'org_1',
          intake_id: 'intake_current',
        },
      }),
    );
    expect(txMock.setBatch.findFirst).not.toHaveBeenCalled();
    expect(txMock.setBatch.aggregate).not.toHaveBeenCalled();
    expect(txMock.setBatch.create).not.toHaveBeenCalled();
    expect(txMock.setBatchChangeLog.create).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects non-object create payloads before transaction side effects', async () => {
    const response = await POST(createRequest([]), { params: Promise.resolve({}) });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(txMock.setPlan.findFirst).not.toHaveBeenCalled();
    expect(txMock.prescriptionLine.findFirst).not.toHaveBeenCalled();
    expect(txMock.setBatch.findFirst).not.toHaveBeenCalled();
    expect(txMock.setBatch.create).not.toHaveBeenCalled();
    expect(txMock.setBatchChangeLog.create).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before transaction side effects', async () => {
    const response = await POST(createMalformedPostRequest(), { params: Promise.resolve({}) });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(txMock.setPlan.findFirst).not.toHaveBeenCalled();
    expect(txMock.prescriptionLine.findFirst).not.toHaveBeenCalled();
    expect(txMock.setBatch.findFirst).not.toHaveBeenCalled();
    expect(txMock.setBatch.create).not.toHaveBeenCalled();
    expect(txMock.setBatchChangeLog.create).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('returns 404 for unassigned pharmacist batch creation before line lookup or writes', async () => {
    prismaMock.membership.findFirst.mockResolvedValue({ role: 'pharmacist' });
    txMock.setPlan.findFirst.mockResolvedValue(null);

    const response = await POST(
      createRequest({
        plan_id: 'plan_1',
        line_id: 'line_1',
        slot: 'morning',
        day_number: 1,
        quantity: 1,
        carry_type: 'carry',
      }),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expect(txMock.setPlan.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'plan_1',
        org_id: 'org_1',
      },
      select: expect.any(Object),
    });
    expect(txMock.prescriptionLine.findFirst).not.toHaveBeenCalled();
    expect(txMock.setBatch.create).not.toHaveBeenCalled();
    expect(txMock.setBatchChangeLog.create).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('requires expected_updated_at before transaction side effects', async () => {
    const response = await POST(
      createRequest({
        plan_id: 'plan_1',
        line_id: 'line_1',
        expected_updated_at: undefined,
        slot: 'morning',
        day_number: 1,
        quantity: 1,
        carry_type: 'carry',
      }),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      details: {
        expected_updated_at: expect.any(Array),
      },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(txMock.setPlan.findFirst).not.toHaveBeenCalled();
    expect(txMock.setPlan.updateMany).not.toHaveBeenCalled();
    expect(txMock.prescriptionIntake.findFirst).not.toHaveBeenCalled();
    expect(txMock.setBatch.create).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects stale set plan versions before intake reads or writes', async () => {
    txMock.setPlan.findFirst.mockResolvedValue({
      id: 'plan_1',
      cycle_id: 'cycle_1',
      updated_at: new Date('2026-06-18T00:01:00.000Z'),
      cycle: {
        overall_status: 'setting',
        case_: {
          patient: {
            packaging_profile: null,
          },
        },
      },
    });

    const response = await POST(
      createRequest({
        plan_id: 'plan_1',
        line_id: 'line_1',
        slot: 'morning',
        day_number: 1,
        quantity: 1,
        carry_type: 'carry',
      }),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      details: {
        current_updated_at: '2026-06-18T00:01:00.000Z',
        expected_updated_at: CURRENT_PLAN_UPDATED_AT,
      },
    });
    expect(txMock.prescriptionIntake.findFirst).not.toHaveBeenCalled();
    expect(txMock.setPlan.updateMany).not.toHaveBeenCalled();
    expect(txMock.setBatch.create).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects manual creation when the cycle is no longer in setting status', async () => {
    txMock.setPlan.findFirst.mockResolvedValue({
      id: 'plan_1',
      cycle_id: 'cycle_1',
      updated_at: CURRENT_PLAN_UPDATED_AT_DATE,
      cycle: {
        overall_status: 'set_audited',
        case_: {
          patient: {
            packaging_profile: null,
          },
        },
      },
    });

    const response = await POST(
      createRequest({
        plan_id: 'plan_1',
        line_id: 'line_1',
        slot: 'morning',
        day_number: 1,
        quantity: 1,
        carry_type: 'carry',
      }),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      details: {
        current_status: 'set_audited',
        required_status: 'setting',
      },
    });
    expect(txMock.prescriptionIntake.findFirst).not.toHaveBeenCalled();
    expect(txMock.setPlan.updateMany).not.toHaveBeenCalled();
    expect(txMock.setBatch.create).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects duplicate plan-line-slot-day combinations', async () => {
    txMock.setPlan.findFirst.mockResolvedValue({
      id: 'plan_1',
      cycle_id: 'cycle_1',
      updated_at: CURRENT_PLAN_UPDATED_AT_DATE,
      cycle: {
        overall_status: 'setting',
        case_: {
          patient: {
            packaging_profile: null,
          },
        },
      },
    });
    txMock.prescriptionLine.findFirst.mockResolvedValue({
      id: 'line_1',
      drug_name: 'Drug A',
      packaging_group_id: null,
      packaging_method: null,
      packaging_instructions: null,
      packaging_instruction_tags: [],
      notes: null,
      dispensing_decisions: [],
      dispense_results: [{ id: 'result_1', actual_quantity: 2 }],
      intake: { cycle_id: 'cycle_1' },
    });
    txMock.setBatch.findFirst.mockResolvedValue({ id: 'batch_1' });

    const response = await POST(
      createRequest({
        plan_id: 'plan_1',
        line_id: 'line_1',
        slot: 'morning',
        day_number: 1,
        quantity: 1,
        carry_type: 'carry',
      }),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    expect(txMock.setBatch.findFirst).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        plan_id: 'plan_1',
        line_id: 'line_1',
        slot: 'morning',
        day_number: 1,
      },
      select: { id: true },
    });
  });

  it('retries serializable conflicts and broadcasts a workflow refresh after a batch is created', async () => {
    withOrgContextMock.mockRejectedValueOnce(buildSerializableConflictError());
    txMock.setPlan.findFirst.mockResolvedValue({
      id: 'plan_1',
      cycle_id: 'cycle_1',
      updated_at: CURRENT_PLAN_UPDATED_AT_DATE,
      cycle: {
        overall_status: 'setting',
        case_: {
          patient: {
            packaging_profile: null,
          },
        },
      },
    });
    txMock.prescriptionLine.findFirst.mockResolvedValue({
      id: 'line_1',
      drug_name: 'Drug A',
      packaging_group_id: null,
      packaging_method: null,
      packaging_instructions: null,
      packaging_instruction_tags: [],
      notes: null,
      dispensing_decisions: [],
      dispense_results: [{ id: 'result_1', actual_quantity: 2 }],
      intake: { cycle_id: 'cycle_1' },
    });
    txMock.setBatch.findFirst.mockResolvedValue(null);
    txMock.setBatch.create.mockResolvedValue({
      id: 'batch_1',
      plan_id: 'plan_1',
      line_id: 'line_1',
      slot: 'morning',
      day_number: 1,
      quantity: 1,
      carry_type: 'carry',
      packaging_method_snapshot: null,
      packaging_instructions_snapshot: null,
      packaging_instruction_tags_snapshot: [],
      line: { id: 'line_1', drug_name: 'Drug A' },
    });

    const response = await POST(
      createRequest({
        plan_id: 'plan_1',
        line_id: 'line_1',
        expected_updated_at: '2026-06-18T00:00:00Z',
        slot: 'morning',
        day_number: 1,
        quantity: 1,
        carry_type: 'carry',
      }),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(withOrgContextMock).toHaveBeenCalledTimes(2);
    expect(withOrgContextMock).toHaveBeenNthCalledWith(
      1,
      'org_1',
      expect.any(Function),
      expect.objectContaining({
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }),
    );
    expect(txMock.setPlan.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          updated_at: CURRENT_PLAN_UPDATED_AT_DATE,
        }),
      }),
    );
    expect(notifyWorkflowMutationMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      payload: { source: 'set_batches_create', plan_id: 'plan_1' },
    });
  });

  it('returns conflict when the set plan claim loses an update or status race before creation', async () => {
    txMock.setPlan.findFirst
      .mockResolvedValueOnce({
        id: 'plan_1',
        cycle_id: 'cycle_1',
        updated_at: CURRENT_PLAN_UPDATED_AT_DATE,
        cycle: {
          overall_status: 'setting',
          case_: {
            patient: {
              packaging_profile: null,
            },
          },
        },
      })
      .mockResolvedValueOnce({
        updated_at: new Date('2026-06-18T00:01:00.000Z'),
        cycle: { overall_status: 'visit_ready' },
      });
    txMock.prescriptionLine.findFirst.mockResolvedValue({
      id: 'line_1',
      drug_name: 'Drug A',
      packaging_group_id: null,
      packaging_method: null,
      packaging_instructions: null,
      packaging_instruction_tags: [],
      notes: null,
      dispensing_decisions: [],
      dispense_results: [{ id: 'result_1', actual_quantity: 2 }],
      intake: { cycle_id: 'cycle_1' },
    });
    txMock.setBatch.findFirst.mockResolvedValue(null);
    txMock.setPlan.updateMany.mockResolvedValue({ count: 0 });

    const response = await POST(
      createRequest({
        plan_id: 'plan_1',
        line_id: 'line_1',
        slot: 'morning',
        day_number: 1,
        quantity: 1,
        carry_type: 'carry',
      }),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      details: {
        current_updated_at: '2026-06-18T00:01:00.000Z',
        current_status: 'visit_ready',
        expected_updated_at: CURRENT_PLAN_UPDATED_AT,
      },
    });
    expect(txMock.setPlan.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'plan_1',
          org_id: 'org_1',
          updated_at: CURRENT_PLAN_UPDATED_AT_DATE,
          cycle: { overall_status: 'setting' },
        }),
      }),
    );
    expect(txMock.setBatch.create).not.toHaveBeenCalled();
    expect(txMock.setBatchChangeLog.create).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('uses the latest dispensing decision when creating a manual batch', async () => {
    txMock.setPlan.findFirst.mockResolvedValue({
      id: 'plan_1',
      cycle_id: 'cycle_1',
      updated_at: CURRENT_PLAN_UPDATED_AT_DATE,
      cycle: {
        overall_status: 'setting',
        case_: {
          patient: {
            packaging_profile: {
              default_packaging_method: 'unit_dose',
              medication_box_color: null,
              notes: '服薬カレンダー',
            },
          },
        },
      },
    });
    txMock.prescriptionLine.findFirst.mockResolvedValue({
      id: 'line_1',
      drug_name: 'Drug A',
      packaging_group_id: 'group_line',
      packaging_method: 'unit_dose',
      packaging_instructions: '既定の一包化',
      packaging_instruction_tags: [],
      notes: null,
      dispensing_decisions: [
        {
          packaging_method: 'blister_pack',
          packaging_instructions: null,
          packaging_instruction_tags: ['separate_pack'],
          packaging_group_id: 'group_decision',
          carry_type_override: 'facility_deposit',
        },
      ],
      dispense_results: [{ id: 'result_1', actual_quantity: 2 }],
      intake: { cycle_id: 'cycle_1' },
    });
    txMock.setBatch.findFirst.mockResolvedValue(null);
    txMock.setBatch.create.mockResolvedValue({
      id: 'batch_1',
      plan_id: 'plan_1',
      line_id: 'line_1',
      slot: 'morning',
      day_number: 1,
      quantity: 1,
      carry_type: 'facility_deposit',
      packaging_method_snapshot: 'blister_pack',
      packaging_instructions_snapshot: 'ブリスター管理',
      packaging_instruction_tags_snapshot: ['separate_pack'],
      packaging_group_id: 'group_decision',
      line: { id: 'line_1', drug_name: 'Drug A' },
    });

    const response = await POST(
      createRequest({
        plan_id: 'plan_1',
        line_id: 'line_1',
        slot: 'morning',
        day_number: 1,
        quantity: 1,
        carry_type: 'carry',
      }),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(txMock.setBatch.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          carry_type: 'facility_deposit',
          packaging_method_snapshot: 'blister_pack',
          packaging_instructions_snapshot: expect.stringContaining('ブリスター管理'),
          packaging_instruction_tags_snapshot: ['separate_pack'],
          packaging_group_id: 'group_decision',
        }),
      }),
    );
  });

  it('adds narcotic to manual batch snapshots when DrugMaster marks an untagged line as narcotic', async () => {
    txMock.setPlan.findFirst.mockResolvedValue({
      id: 'plan_1',
      cycle_id: 'cycle_1',
      updated_at: CURRENT_PLAN_UPDATED_AT_DATE,
      cycle: {
        overall_status: 'setting',
        case_: {
          patient: {
            packaging_profile: null,
          },
        },
      },
    });
    txMock.prescriptionLine.findFirst.mockResolvedValue({
      id: 'line_master_narcotic',
      drug_name: 'タグ漏れ麻薬',
      drug_code: 'YJ_MASTER_NARCOTIC',
      packaging_group_id: null,
      packaging_method: null,
      packaging_instructions: null,
      packaging_instruction_tags: [],
      notes: null,
      dispensing_decisions: [],
      dispense_results: [
        {
          id: 'result_1',
          actual_drug_code: 'YJ_MASTER_NARCOTIC',
          actual_quantity: 2,
        },
      ],
      intake: { cycle_id: 'cycle_1' },
    });
    txMock.drugMaster.findMany.mockResolvedValue([{ yj_code: 'YJ_MASTER_NARCOTIC' }]);
    txMock.setBatch.findFirst.mockResolvedValue(null);
    txMock.setBatch.create.mockResolvedValue({
      id: 'batch_1',
      plan_id: 'plan_1',
      line_id: 'line_master_narcotic',
      slot: 'morning',
      day_number: 1,
      quantity: 1,
      carry_type: 'carry',
      packaging_method_snapshot: null,
      packaging_instructions_snapshot: null,
      packaging_instruction_tags_snapshot: ['narcotic'],
      packaging_group_id: null,
      line: { id: 'line_master_narcotic', drug_name: 'タグ漏れ麻薬' },
    });

    const response = await POST(
      createRequest({
        plan_id: 'plan_1',
        line_id: 'line_master_narcotic',
        slot: 'morning',
        day_number: 1,
        quantity: 1,
        carry_type: 'carry',
      }),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(txMock.drugMaster.findMany).toHaveBeenCalledWith({
      where: {
        yj_code: { in: ['YJ_MASTER_NARCOTIC'] },
        is_narcotic: true,
      },
      select: { yj_code: true },
    });
    expect(txMock.setBatch.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          packaging_instruction_tags_snapshot: ['narcotic'],
        }),
      }),
    );
  });

  it('rejects manual creation when no audited dispense result exists for the line', async () => {
    txMock.setPlan.findFirst.mockResolvedValue({
      id: 'plan_1',
      cycle_id: 'cycle_1',
      updated_at: CURRENT_PLAN_UPDATED_AT_DATE,
      cycle: {
        overall_status: 'setting',
        case_: {
          patient: {
            packaging_profile: null,
          },
        },
      },
    });
    txMock.prescriptionLine.findFirst.mockResolvedValue({
      id: 'line_1',
      drug_name: 'Drug A',
      packaging_group_id: null,
      packaging_method: null,
      packaging_instructions: null,
      packaging_instruction_tags: [],
      notes: null,
      dispensing_decisions: [],
      dispense_results: [],
      intake: { cycle_id: 'cycle_1' },
    });

    const response = await POST(
      createRequest({
        plan_id: 'plan_1',
        line_id: 'line_1',
        slot: 'morning',
        day_number: 1,
        quantity: 1,
        carry_type: 'carry',
      }),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '監査済み調剤結果がない処方ラインはセットに追加できません',
    });
    expect(txMock.setBatch.findFirst).not.toHaveBeenCalled();
    expect(txMock.setBatch.aggregate).not.toHaveBeenCalled();
    expect(txMock.setBatch.create).not.toHaveBeenCalled();
    expect(txMock.setBatchChangeLog.create).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects manual creation when the line total would exceed audited actual quantity', async () => {
    txMock.setPlan.findFirst.mockResolvedValue({
      id: 'plan_1',
      cycle_id: 'cycle_1',
      updated_at: CURRENT_PLAN_UPDATED_AT_DATE,
      cycle: {
        overall_status: 'setting',
        case_: {
          patient: {
            packaging_profile: null,
          },
        },
      },
    });
    txMock.prescriptionLine.findFirst.mockResolvedValue({
      id: 'line_1',
      drug_name: 'Drug A',
      packaging_group_id: null,
      packaging_method: null,
      packaging_instructions: null,
      packaging_instruction_tags: [],
      notes: null,
      dispensing_decisions: [],
      dispense_results: [{ id: 'result_1', actual_quantity: 2 }],
      intake: { cycle_id: 'cycle_1' },
    });
    txMock.setBatch.findFirst.mockResolvedValue(null);
    txMock.setBatch.aggregate.mockResolvedValue({ _sum: { quantity: 1.5 } });

    const response = await POST(
      createRequest({
        plan_id: 'plan_1',
        line_id: 'line_1',
        slot: 'morning',
        day_number: 1,
        quantity: 1,
        carry_type: 'carry',
      }),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'セット数量が監査済み調剤実数量を超えています',
    });
    expect(txMock.setBatch.create).not.toHaveBeenCalled();
    expect(txMock.setBatchChangeLog.create).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });
});
