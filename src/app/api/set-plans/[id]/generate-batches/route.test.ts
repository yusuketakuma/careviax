import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';

const { authMock, prismaMock, withOrgContextMock, txMock, notifyWorkflowMutationMock } = vi.hoisted(
  () => ({
    authMock: vi.fn(),
    prismaMock: {
      membership: { findFirst: vi.fn() },
      setPlan: { findFirst: vi.fn() },
      prescriptionIntake: { findMany: vi.fn() },
    },
    withOrgContextMock: vi.fn(),
    txMock: {
      setPlan: {
        updateMany: vi.fn(),
      },
      setBatch: {
        count: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        deleteMany: vi.fn(),
        createMany: vi.fn(),
      },
      setBatchChangeLog: {
        create: vi.fn(),
      },
      dispenseResult: {
        findFirst: vi.fn(),
      },
      dispensingDecision: {
        findFirst: vi.fn(),
      },
      drugMaster: {
        findMany: vi.fn(),
      },
    },
    notifyWorkflowMutationMock: vi.fn(),
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

import { POST } from './route';

const CURRENT_UPDATED_AT = '2026-03-01T00:00:00.000Z';

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/set-plans/plan_1/generate-batches', {
    method: 'POST',
    headers: {
      'x-org-id': 'org_1',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

function createEmptyRequest() {
  return new NextRequest('http://localhost/api/set-plans/plan_1/generate-batches', {
    method: 'POST',
    headers: {
      'x-org-id': 'org_1',
    },
  });
}

function createMalformedRequest() {
  return new NextRequest('http://localhost/api/set-plans/plan_1/generate-batches', {
    method: 'POST',
    headers: {
      'x-org-id': 'org_1',
      'content-type': 'application/json',
    },
    body: '{"force":',
  });
}

function buildSerializableConflictError() {
  return new Prisma.PrismaClientKnownRequestError('Serializable transaction conflict', {
    code: 'P2034',
    clientVersion: 'test',
  });
}

describe('set-plans/[id]/generate-batches POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    prismaMock.membership.findFirst.mockResolvedValue({ role: 'admin' });
    prismaMock.setPlan.findFirst.mockResolvedValue({
      id: 'plan_1',
      cycle_id: 'cycle_1',
      target_period_start: new Date('2026-03-01T00:00:00.000Z'),
      target_period_end: new Date('2026-03-02T00:00:00.000Z'),
      set_method: 'custom',
      packaging_method_id: null,
      packaging_method_ref: null,
      updated_at: new Date(CURRENT_UPDATED_AT),
      cycle: {
        overall_status: 'audited',
        case_: {
          patient: {
            packaging_profile: null,
          },
        },
      },
    });
    prismaMock.prescriptionIntake.findMany.mockResolvedValue([
      {
        updated_at: new Date('2026-03-01T00:00:00.000Z'),
        lines: [
          {
            id: 'line_1',
            drug_name: 'Drug',
            frequency: '朝夕',
            quantity: 2,
            unit: '錠',
            packaging_group_id: null,
            packaging_method: null,
            packaging_instructions: null,
            packaging_instruction_tags: [],
            notes: null,
            dispensing_decisions: [],
            dispense_results: [
              {
                id: 'result_1',
                actual_quantity: 2,
                actual_unit: '錠',
                updated_at: new Date('2026-03-01T10:00:00.000Z'),
              },
            ],
          },
        ],
      },
    ]);
    withOrgContextMock.mockImplementation(async (_orgId, callback) => callback(txMock));
    txMock.setPlan.updateMany.mockResolvedValue({ count: 1 });
    txMock.dispenseResult.findFirst.mockResolvedValue({
      updated_at: new Date('2026-03-01T10:00:00.000Z'),
    });
    txMock.dispensingDecision.findFirst.mockResolvedValue(null);
    txMock.drugMaster.findMany.mockResolvedValue([]);
  });

  it('reuses existing batches instead of duplicating them when force is omitted', async () => {
    txMock.setBatch.count.mockResolvedValue(1);
    txMock.setBatch.findFirst.mockResolvedValue({
      updated_at: new Date('2026-03-01T11:00:00.000Z'),
    });
    txMock.setBatch.findMany.mockResolvedValue([
      {
        id: 'batch_1',
        day_number: 1,
        slot: 'morning',
        line_id: 'line_1',
        quantity: 1,
        carry_type: 'carry',
        packaging_method_snapshot: null,
        packaging_instructions_snapshot: null,
        packaging_instruction_tags_snapshot: [],
        line: { id: 'line_1', drug_name: 'Drug', dose: '1T', frequency: '朝夕', unit: '錠' },
      },
    ]);

    const response = await POST(createEmptyRequest(), {
      params: Promise.resolve({ id: 'plan_1' }),
    });
    if (!response) throw new Error('response is required');
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(txMock.setBatch.createMany).not.toHaveBeenCalled();
    expect(payload.data.reused).toBe(true);
    expect(payload.data.count).toBe(1);
    expect(withOrgContextMock).toHaveBeenCalledWith(
      'org_1',
      expect.any(Function),
      expect.objectContaining({
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }),
    );
  });

  it('rejects existing batch reuse when audited dispense results changed after the latest batch', async () => {
    txMock.setBatch.count.mockResolvedValue(1);
    txMock.setBatch.findFirst.mockResolvedValue({
      updated_at: new Date('2026-03-01T09:00:00.000Z'),
    });

    const response = await POST(createEmptyRequest(), {
      params: Promise.resolve({ id: 'plan_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '処方・調剤結果・包装判断に変更があるため、影響セットを再確認して再生成してください',
    });
    expect(txMock.setBatch.findMany).not.toHaveBeenCalled();
    expect(txMock.setBatch.createMany).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
    expect(txMock.dispenseResult.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          line_id: { in: ['line_1'] },
          task: expect.objectContaining({
            cycle_id: 'cycle_1',
            audits: {
              some: {
                org_id: 'org_1',
                result: { in: ['approved', 'emergency_approved'] },
              },
            },
          }),
        }),
        orderBy: { updated_at: 'desc' },
        select: { updated_at: true },
      }),
    );
  });

  it('rejects existing batch reuse when dispensing decisions changed after the latest batch', async () => {
    prismaMock.prescriptionIntake.findMany.mockResolvedValue([
      {
        updated_at: new Date('2026-03-01T00:00:00.000Z'),
        lines: [
          {
            id: 'line_1',
            drug_name: 'Drug',
            frequency: '朝夕',
            quantity: 2,
            unit: '錠',
            packaging_group_id: null,
            packaging_method: null,
            packaging_instructions: null,
            packaging_instruction_tags: [],
            notes: null,
            dispensing_decisions: [
              {
                packaging_method: 'blister_pack',
                packaging_instructions: null,
                packaging_instruction_tags: [],
                packaging_group_id: 'group_decision',
                carry_type_override: 'carry',
                decided_at: new Date('2026-03-01T10:30:00.000Z'),
                updated_at: new Date('2026-03-01T10:30:00.000Z'),
              },
            ],
            dispense_results: [
              {
                id: 'result_1',
                actual_quantity: 2,
                actual_unit: '錠',
                updated_at: new Date('2026-03-01T10:00:00.000Z'),
              },
            ],
          },
        ],
      },
    ]);
    txMock.setBatch.count.mockResolvedValue(1);
    txMock.setBatch.findFirst.mockResolvedValue({
      updated_at: new Date('2026-03-01T10:15:00.000Z'),
    });
    txMock.dispensingDecision.findFirst.mockResolvedValue({
      updated_at: new Date('2026-03-01T10:30:00.000Z'),
      decided_at: new Date('2026-03-01T10:30:00.000Z'),
    });

    const response = await POST(createEmptyRequest(), {
      params: Promise.resolve({ id: 'plan_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '処方・調剤結果・包装判断に変更があるため、影響セットを再確認して再生成してください',
    });
    expect(txMock.setBatch.findMany).not.toHaveBeenCalled();
    expect(txMock.setBatch.createMany).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects forced regeneration after set audit has published carry items', async () => {
    prismaMock.setPlan.findFirst.mockResolvedValueOnce({
      id: 'plan_1',
      cycle_id: 'cycle_1',
      target_period_start: new Date('2026-03-01T00:00:00.000Z'),
      target_period_end: new Date('2026-03-02T00:00:00.000Z'),
      set_method: 'custom',
      packaging_method_id: null,
      packaging_method_ref: null,
      updated_at: new Date('2026-03-01T00:00:00.000Z'),
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
      createRequest({ force: true, expected_updated_at: CURRENT_UPDATED_AT }),
      {
        params: Promise.resolve({ id: 'plan_1' }),
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message:
        'セット監査後の再生成は訪問持参物と不整合になるため実行できません。差戻し後に再生成してください',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(txMock.setBatch.deleteMany).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('requires expected_updated_at for forced regeneration before intake reads or writes', async () => {
    const response = await POST(createRequest({ force: true }), {
      params: Promise.resolve({ id: 'plan_1' }),
    });
    if (!response) throw new Error('response is required');

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '強制再生成にはセットプランの版情報(expected_updated_at)が必要です',
    });
    expect(prismaMock.setPlan.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.prescriptionIntake.findMany).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(txMock.setBatch.deleteMany).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects stale forced regeneration before intake reads or writes', async () => {
    const response = await POST(
      createRequest({ force: true, expected_updated_at: '2026-02-28T00:00:00.000Z' }),
      {
        params: Promise.resolve({ id: 'plan_1' }),
      },
    );
    if (!response) throw new Error('response is required');

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      message: 'セットプランが他のユーザーによって更新されています。再読み込みしてください',
      details: {
        current_updated_at: CURRENT_UPDATED_AT,
        expected_updated_at: '2026-02-28T00:00:00.000Z',
      },
    });
    expect(prismaMock.prescriptionIntake.findMany).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(txMock.setBatch.deleteMany).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before plan lookup or writes', async () => {
    const response = await POST(createMalformedRequest(), {
      params: Promise.resolve({ id: 'plan_1' }),
    });
    if (!response) throw new Error('response is required');

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(prismaMock.setPlan.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.prescriptionIntake.findMany).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(txMock.setBatch.createMany).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects non-object generation payloads before plan lookup or writes', async () => {
    const response = await POST(createRequest([]), {
      params: Promise.resolve({ id: 'plan_1' }),
    });
    if (!response) throw new Error('response is required');

    expect(response.status).toBe(400);
    expect(prismaMock.setPlan.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.prescriptionIntake.findMany).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(txMock.setBatch.createMany).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects generation when the cycle is not audit-ready', async () => {
    prismaMock.setPlan.findFirst.mockResolvedValue({
      id: 'plan_1',
      cycle_id: 'cycle_1',
      target_period_start: new Date('2026-03-01T00:00:00.000Z'),
      target_period_end: new Date('2026-03-02T00:00:00.000Z'),
      set_method: 'custom',
      packaging_method_id: null,
      packaging_method_ref: null,
      updated_at: new Date(CURRENT_UPDATED_AT),
      cycle: {
        overall_status: 'dispensing',
        case_: {
          patient: {
            packaging_profile: null,
          },
        },
      },
    });

    const response = await POST(createRequest({ force: false }), {
      params: Promise.resolve({ id: 'plan_1' }),
    });
    if (!response) throw new Error('response is required');

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '鑑査未承認のサイクルはセットできません',
    });
  });

  it('splits total prescription quantity across days and slots without multiplying the dose', async () => {
    prismaMock.setPlan.findFirst.mockResolvedValue({
      id: 'plan_1',
      cycle_id: 'cycle_1',
      target_period_start: new Date('2026-03-01T00:00:00.000Z'),
      target_period_end: new Date('2026-03-28T00:00:00.000Z'),
      set_method: 'custom',
      packaging_method_id: null,
      packaging_method_ref: null,
      updated_at: new Date(CURRENT_UPDATED_AT),
      cycle: {
        overall_status: 'audited',
        case_: {
          patient: {
            packaging_profile: null,
          },
        },
      },
    });
    prismaMock.prescriptionIntake.findMany.mockResolvedValue([
      {
        updated_at: new Date('2026-03-01T00:00:00.000Z'),
        lines: [
          {
            id: 'line_daily',
            drug_name: 'アムロジピン錠5mg',
            frequency: '朝',
            quantity: 28,
            unit: '錠',
            packaging_group_id: null,
            packaging_method: null,
            packaging_instructions: null,
            packaging_instruction_tags: [],
            notes: null,
            dispensing_decisions: [],
            dispense_results: [
              {
                id: 'result_daily',
                actual_quantity: 28,
                actual_unit: '錠',
                updated_at: new Date('2026-03-01T10:00:00.000Z'),
              },
            ],
          },
          {
            id: 'line_twice_daily',
            drug_name: 'メトホルミン錠500mg',
            frequency: '朝夕',
            quantity: 56,
            unit: '錠',
            packaging_group_id: null,
            packaging_method: null,
            packaging_instructions: null,
            packaging_instruction_tags: [],
            notes: null,
            dispensing_decisions: [],
            dispense_results: [
              {
                id: 'result_twice_daily',
                actual_quantity: 56,
                actual_unit: '錠',
                updated_at: new Date('2026-03-01T10:00:00.000Z'),
              },
            ],
          },
        ],
      },
    ]);
    txMock.setBatch.count.mockResolvedValue(0);
    txMock.setBatch.createMany.mockResolvedValue({ count: 84 });
    txMock.setBatch.findMany.mockResolvedValue([]);

    const response = await POST(
      createRequest({ force: true, expected_updated_at: CURRENT_UPDATED_AT }),
      {
        params: Promise.resolve({ id: 'plan_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(prismaMock.prescriptionIntake.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { created_at: 'desc' },
        take: 1,
        select: expect.objectContaining({
          lines: expect.objectContaining({
            select: expect.objectContaining({
              dispense_results: expect.objectContaining({
                where: expect.objectContaining({
                  task: expect.objectContaining({
                    audits: {
                      some: {
                        org_id: 'org_1',
                        result: { in: ['approved', 'emergency_approved'] },
                      },
                    },
                  }),
                }),
                orderBy: { dispensed_at: 'desc' },
                take: 1,
                select: expect.objectContaining({
                  actual_quantity: true,
                }),
              }),
            }),
          }),
        }),
      }),
    );
    const createdRows = txMock.setBatch.createMany.mock.calls[0][0].data as Array<{
      line_id: string;
      quantity: number;
    }>;
    expect(createdRows.filter((row) => row.line_id === 'line_daily')).toHaveLength(28);
    expect(createdRows.filter((row) => row.line_id === 'line_daily')).toEqual(
      expect.arrayContaining([expect.objectContaining({ quantity: 1 })]),
    );
    expect(createdRows.filter((row) => row.line_id === 'line_twice_daily')).toHaveLength(56);
    expect(createdRows.filter((row) => row.line_id === 'line_twice_daily')).toEqual(
      expect.arrayContaining([expect.objectContaining({ quantity: 1 })]),
    );
  });

  it('generates set quantities from audited dispense actual quantity instead of prescribed quantity', async () => {
    prismaMock.setPlan.findFirst.mockResolvedValue({
      id: 'plan_1',
      cycle_id: 'cycle_1',
      target_period_start: new Date('2026-03-01T00:00:00.000Z'),
      target_period_end: new Date('2026-03-06T00:00:00.000Z'),
      set_method: 'custom',
      packaging_method_id: null,
      packaging_method_ref: null,
      updated_at: new Date(CURRENT_UPDATED_AT),
      cycle: {
        overall_status: 'audited',
        case_: {
          patient: {
            packaging_profile: null,
          },
        },
      },
    });
    prismaMock.prescriptionIntake.findMany.mockResolvedValue([
      {
        updated_at: new Date('2026-03-01T00:00:00.000Z'),
        lines: [
          {
            id: 'line_residual_adjusted',
            drug_name: 'アムロジピン錠5mg',
            frequency: '朝夕',
            quantity: 14,
            unit: '錠',
            packaging_group_id: null,
            packaging_method: null,
            packaging_instructions: null,
            packaging_instruction_tags: [],
            notes: null,
            dispensing_decisions: [],
            dispense_results: [
              {
                id: 'result_residual_adjusted',
                actual_quantity: 12,
                actual_unit: '錠',
                updated_at: new Date('2026-03-01T10:00:00.000Z'),
              },
            ],
          },
        ],
      },
    ]);
    txMock.setBatch.count.mockResolvedValue(0);
    txMock.setBatch.createMany.mockResolvedValue({ count: 12 });
    txMock.setBatch.findMany.mockResolvedValue([]);

    const response = await POST(
      createRequest({ force: true, expected_updated_at: CURRENT_UPDATED_AT }),
      {
        params: Promise.resolve({ id: 'plan_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    const createdRows = txMock.setBatch.createMany.mock.calls[0][0].data as Array<{
      line_id: string;
      quantity: number;
    }>;
    expect(createdRows).toHaveLength(12);
    expect(createdRows.reduce((sum, row) => sum + row.quantity, 0)).toBe(12);
    expect(createdRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ line_id: 'line_residual_adjusted', quantity: 1 }),
      ]),
    );
  });

  it('uses the latest dispensing decision packaging snapshot when generating set batches', async () => {
    prismaMock.prescriptionIntake.findMany.mockResolvedValue([
      {
        updated_at: new Date('2026-03-01T00:00:00.000Z'),
        lines: [
          {
            id: 'line_1',
            drug_name: 'アムロジピン錠5mg',
            frequency: '朝',
            quantity: 2,
            unit: '錠',
            packaging_group_id: 'group_line',
            packaging_method: null,
            packaging_instructions: null,
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
            dispense_results: [
              {
                id: 'result_1',
                actual_quantity: 2,
                actual_unit: '錠',
                updated_at: new Date('2026-03-01T10:00:00.000Z'),
              },
            ],
          },
        ],
      },
    ]);
    txMock.setBatch.count.mockResolvedValue(0);
    txMock.setBatch.createMany.mockResolvedValue({ count: 2 });
    txMock.setBatch.findMany.mockResolvedValue([]);

    const response = await POST(
      createRequest({ force: true, expected_updated_at: CURRENT_UPDATED_AT }),
      {
        params: Promise.resolve({ id: 'plan_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    const createdRows = txMock.setBatch.createMany.mock.calls[0][0].data as Array<{
      line_id: string;
      carry_type: string;
      packaging_method_snapshot: string | null;
      packaging_instructions_snapshot: string | null;
      packaging_instruction_tags_snapshot: string[];
      packaging_group_id: string | null;
    }>;
    expect(createdRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          line_id: 'line_1',
          carry_type: 'facility_deposit',
          packaging_method_snapshot: 'blister_pack',
          packaging_instructions_snapshot: 'ブリスター管理',
          packaging_instruction_tags_snapshot: ['separate_pack'],
          packaging_group_id: 'group_decision',
        }),
      ]),
    );
  });

  it('adds narcotic to generated batch snapshots when DrugMaster marks an untagged line as narcotic', async () => {
    prismaMock.prescriptionIntake.findMany.mockResolvedValue([
      {
        updated_at: new Date('2026-03-01T00:00:00.000Z'),
        lines: [
          {
            id: 'line_master_narcotic',
            drug_name: 'タグ漏れ麻薬',
            drug_code: 'YJ_MASTER_NARCOTIC',
            frequency: '朝',
            quantity: 2,
            unit: '錠',
            packaging_group_id: null,
            packaging_method: null,
            packaging_instructions: null,
            packaging_instruction_tags: ['cold_storage'],
            notes: null,
            dispensing_decisions: [{ packaging_instruction_tags: [] }],
            dispense_results: [
              {
                id: 'result_narcotic',
                actual_drug_code: 'YJ_MASTER_NARCOTIC',
                actual_quantity: 2,
                actual_unit: '錠',
                updated_at: new Date('2026-03-01T10:00:00.000Z'),
              },
            ],
          },
          {
            id: 'line_plain',
            drug_name: '通常薬',
            drug_code: 'YJ_PLAIN',
            frequency: '朝',
            quantity: 2,
            unit: '錠',
            packaging_group_id: null,
            packaging_method: null,
            packaging_instructions: null,
            packaging_instruction_tags: [],
            notes: null,
            dispensing_decisions: [],
            dispense_results: [
              {
                id: 'result_plain',
                actual_drug_code: 'YJ_PLAIN',
                actual_quantity: 2,
                actual_unit: '錠',
                updated_at: new Date('2026-03-01T10:00:00.000Z'),
              },
            ],
          },
        ],
      },
    ]);
    txMock.drugMaster.findMany.mockResolvedValue([{ yj_code: 'YJ_MASTER_NARCOTIC' }]);
    txMock.setBatch.count.mockResolvedValue(0);
    txMock.setBatch.createMany.mockResolvedValue({ count: 4 });
    txMock.setBatch.findMany.mockResolvedValue([]);

    const response = await POST(
      createRequest({ force: true, expected_updated_at: CURRENT_UPDATED_AT }),
      {
        params: Promise.resolve({ id: 'plan_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(txMock.drugMaster.findMany).toHaveBeenCalledWith({
      where: {
        yj_code: { in: expect.arrayContaining(['YJ_MASTER_NARCOTIC', 'YJ_PLAIN']) },
        is_narcotic: true,
      },
      select: { yj_code: true },
    });
    const createdRows = txMock.setBatch.createMany.mock.calls[0][0].data as Array<{
      line_id: string;
      packaging_instruction_tags_snapshot: string[];
    }>;
    expect(createdRows.filter((row) => row.line_id === 'line_master_narcotic')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          packaging_instruction_tags_snapshot: expect.arrayContaining(['cold_storage', 'narcotic']),
        }),
      ]),
    );
    expect(
      createdRows
        .filter((row) => row.line_id === 'line_plain')
        .some((row) => row.packaging_instruction_tags_snapshot.includes('narcotic')),
    ).toBe(false);
    expect(JSON.stringify(createdRows)).not.toContain('タグ漏れ麻薬');
  });

  it('generates set batches only from the latest prescription intake', async () => {
    prismaMock.prescriptionIntake.findMany.mockResolvedValue([
      {
        updated_at: new Date('2026-03-02T00:00:00.000Z'),
        lines: [
          {
            id: 'line_current',
            drug_name: 'アムロジピン錠5mg',
            frequency: '朝',
            quantity: 2,
            unit: '錠',
            packaging_group_id: null,
            packaging_method: null,
            packaging_instructions: null,
            packaging_instruction_tags: [],
            notes: null,
            dispensing_decisions: [],
            dispense_results: [
              {
                id: 'result_current',
                actual_quantity: 2,
                actual_unit: '錠',
                updated_at: new Date('2026-03-02T10:00:00.000Z'),
              },
            ],
          },
        ],
      },
      {
        updated_at: new Date('2026-03-01T00:00:00.000Z'),
        lines: [
          {
            id: 'line_stale',
            drug_name: '旧処方ライン',
            frequency: '',
            quantity: 28,
            unit: '錠',
            packaging_group_id: null,
            packaging_method: null,
            packaging_instructions: null,
            packaging_instruction_tags: [],
            notes: null,
            dispensing_decisions: [],
            dispense_results: [],
          },
        ],
      },
    ]);
    txMock.setBatch.count.mockResolvedValue(0);
    txMock.setBatch.createMany.mockResolvedValue({ count: 2 });
    txMock.setBatch.findMany.mockResolvedValue([]);

    const response = await POST(
      createRequest({ force: true, expected_updated_at: CURRENT_UPDATED_AT }),
      {
        params: Promise.resolve({ id: 'plan_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(prismaMock.prescriptionIntake.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { created_at: 'desc' },
        take: 1,
      }),
    );
    const createdRows = txMock.setBatch.createMany.mock.calls[0][0].data as Array<{
      line_id: string;
    }>;
    expect(createdRows).toHaveLength(2);
    expect(createdRows).toEqual(
      expect.arrayContaining([expect.objectContaining({ line_id: 'line_current' })]),
    );
    expect(createdRows).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ line_id: 'line_stale' })]),
    );
  });

  it('rejects generation when audited dispense result is missing for a current line', async () => {
    prismaMock.prescriptionIntake.findMany.mockResolvedValue([
      {
        updated_at: new Date('2026-03-01T00:00:00.000Z'),
        lines: [
          {
            id: 'line_missing_result',
            drug_name: 'アムロジピン錠5mg',
            frequency: '朝',
            quantity: 2,
            unit: '錠',
            packaging_group_id: null,
            packaging_method: null,
            packaging_instructions: null,
            packaging_instruction_tags: [],
            notes: null,
            dispensing_decisions: [],
            dispense_results: [],
          },
        ],
      },
    ]);
    txMock.setBatch.count.mockResolvedValue(0);

    const response = await POST(
      createRequest({ force: true, expected_updated_at: CURRENT_UPDATED_AT }),
      {
        params: Promise.resolve({ id: 'plan_1' }),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '監査済み調剤結果がない処方があります: アムロジピン錠5mg',
    });
    expect(txMock.setBatch.createMany).not.toHaveBeenCalled();
    expect(txMock.setBatchChangeLog.create).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('reuses batches found immediately before creation to avoid duplicate generation', async () => {
    txMock.setBatch.count.mockResolvedValue(0);
    txMock.setBatch.findMany.mockResolvedValue([
      {
        id: 'batch_1',
        updated_at: new Date('2026-03-01T11:00:00.000Z'),
        day_number: 1,
        slot: 'morning',
        line_id: 'line_1',
        quantity: 1,
        carry_type: 'carry',
        packaging_method_snapshot: null,
        packaging_instructions_snapshot: null,
        packaging_instruction_tags_snapshot: [],
        line: { id: 'line_1', drug_name: 'Drug', dose: '1T', frequency: '朝夕', unit: '錠' },
      },
    ]);

    const response = await POST(createRequest({ force: false }), {
      params: Promise.resolve({ id: 'plan_1' }),
    });
    if (!response) throw new Error('response is required');
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.reused).toBe(true);
    expect(payload.data.count).toBe(1);
    expect(txMock.setBatch.createMany).not.toHaveBeenCalled();
    expect(txMock.setBatchChangeLog.create).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects batches found immediately before creation when audited results changed after them', async () => {
    txMock.setBatch.count.mockResolvedValue(0);
    txMock.setBatch.findMany.mockResolvedValue([
      {
        id: 'batch_concurrent',
        updated_at: new Date('2026-03-01T09:00:00.000Z'),
        day_number: 1,
        slot: 'morning',
        line_id: 'line_1',
        quantity: 1,
        carry_type: 'carry',
        packaging_method_snapshot: null,
        packaging_instructions_snapshot: null,
        packaging_instruction_tags_snapshot: [],
        line: { id: 'line_1', drug_name: 'Drug', dose: '1T', frequency: '朝夕', unit: '錠' },
      },
    ]);

    const response = await POST(createRequest({ force: false }), {
      params: Promise.resolve({ id: 'plan_1' }),
    });
    if (!response) throw new Error('response is required');

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '処方・調剤結果・包装判断に変更があるため、影響セットを再確認して再生成してください',
    });
    expect(txMock.setBatch.createMany).not.toHaveBeenCalled();
    expect(txMock.setBatchChangeLog.create).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects forced regeneration when the plan changes during the transaction', async () => {
    txMock.setBatch.count.mockResolvedValue(0);
    txMock.setPlan.updateMany.mockResolvedValue({ count: 0 });

    const response = await POST(
      createRequest({ force: true, expected_updated_at: CURRENT_UPDATED_AT }),
      {
        params: Promise.resolve({ id: 'plan_1' }),
      },
    );
    if (!response) throw new Error('response is required');

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      message: 'セットプランが他のユーザーによって更新されています。再読み込みしてください',
      details: { expected_updated_at: CURRENT_UPDATED_AT },
    });
    expect(txMock.setBatch.deleteMany).not.toHaveBeenCalled();
    expect(txMock.setBatch.createMany).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('retries serializable conflicts and reuses batches created by the competing request', async () => {
    withOrgContextMock
      .mockRejectedValueOnce(buildSerializableConflictError())
      .mockImplementationOnce(async (_orgId, callback) => callback(txMock));
    txMock.setBatch.count.mockResolvedValue(1);
    txMock.setBatch.findFirst.mockResolvedValue({
      updated_at: new Date('2026-03-01T11:00:00.000Z'),
    });
    txMock.setBatch.findMany.mockResolvedValue([
      {
        id: 'batch_retry',
        day_number: 1,
        slot: 'morning',
        line_id: 'line_1',
        quantity: 1,
        carry_type: 'carry',
        packaging_method_snapshot: null,
        packaging_instructions_snapshot: null,
        packaging_instruction_tags_snapshot: [],
        line: { id: 'line_1', drug_name: 'Drug', dose: '1T', frequency: '朝夕', unit: '錠' },
      },
    ]);

    const response = await POST(createRequest({ force: false }), {
      params: Promise.resolve({ id: 'plan_1' }),
    });
    if (!response) throw new Error('response is required');
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.reused).toBe(true);
    expect(payload.data.count).toBe(1);
    expect(withOrgContextMock).toHaveBeenCalledTimes(2);
    expect(txMock.setBatch.createMany).not.toHaveBeenCalled();
  });

  it('returns 404 for unassigned pharmacist generation before intake reads or writes', async () => {
    prismaMock.membership.findFirst.mockResolvedValue({ role: 'pharmacist' });
    prismaMock.setPlan.findFirst.mockResolvedValue(null);

    const response = await POST(createRequest({ force: false }), {
      params: Promise.resolve({ id: 'plan_1' }),
    });
    if (!response) throw new Error('response is required');

    expect(response.status).toBe(404);
    expect(prismaMock.setPlan.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'plan_1',
        org_id: 'org_1',
      },
      select: expect.any(Object),
    });
    expect(prismaMock.prescriptionIntake.findMany).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(txMock.setBatch.createMany).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });
});
