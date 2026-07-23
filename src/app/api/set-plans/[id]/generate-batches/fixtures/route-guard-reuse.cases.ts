import { Prisma } from '@prisma/client';
import { expect, it } from 'vitest';
import { getGenerateBatchesRouteTestSupport } from './route.test-support';

const {
  buildSetPlanAssignmentWhereMock,
  createEmptyRequest,
  createMalformedRequest,
  createRequest,
  CURRENT_UPDATED_AT,
  expectNoStore,
  loggerErrorMock,
  notifyWorkflowMutationMock,
  POST,
  txMock,
  withOrgContextMock,
} = getGenerateBatchesRouteTestSupport();

export function registerGenerateBatchesGuardReuseCases() {
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
    expectNoStore(response);
    expect(txMock.setBatch.createMany).not.toHaveBeenCalled();
    expect(payload.data.reused).toBe(true);
    expect(payload.data.count).toBe(1);
    expect(withOrgContextMock).toHaveBeenCalledWith(
      'org_1',
      expect.any(Function),
      expect.objectContaining({
        requestContext: expect.objectContaining({
          orgId: 'org_1',
          userId: 'user_1',
          role: 'admin',
        }),
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }),
    );
  });

  it('applies request auth context and assignment scope to generation plan reads and write claims', async () => {
    const assignmentWhere = {
      cycle: {
        case_: {
          primary_pharmacist_id: 'user_1',
        },
      },
    };
    buildSetPlanAssignmentWhereMock.mockReturnValue(assignmentWhere);
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
    expectNoStore(response);
    expect(txMock.setPlan.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'plan_1',
        org_id: 'org_1',
        AND: [assignmentWhere],
      },
      select: expect.any(Object),
    });
    expect(txMock.setPlan.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'plan_1',
          org_id: 'org_1',
          updated_at: new Date(CURRENT_UPDATED_AT),
          AND: [assignmentWhere],
        },
      }),
    );
    expect(withOrgContextMock).toHaveBeenCalledWith(
      'org_1',
      expect.any(Function),
      expect.objectContaining({
        requestContext: expect.objectContaining({
          orgId: 'org_1',
          userId: 'user_1',
          role: 'admin',
        }),
      }),
    );
  });

  it('returns a sanitized no-store 500 when generation plan lookup fails unexpectedly', async () => {
    const unsafeError = new Error('患者 山田太郎 raw generate batches detail failure');
    unsafeError.name = 'SetPlanGenerateBatchesSecretError';
    txMock.setPlan.findFirst.mockRejectedValueOnce(unsafeError);

    const response = await POST(createRequest({ force: false }), {
      params: Promise.resolve({ id: 'plan_1' }),
    });
    if (!response) throw new Error('response is required');

    expect(response.status).toBe(500);
    expectNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(JSON.stringify(body)).not.toContain('山田太郎');
    expect(JSON.stringify(body)).not.toContain('raw generate batches detail failure');
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'set_plan_generate_batches_post_unhandled_error',
        route: '/api/set-plans/[id]/generate-batches',
        method: 'POST',
        status: 500,
      },
      unsafeError,
    );
    const [routeContext] = loggerErrorMock.mock.calls[0] ?? [];
    expect(routeContext).not.toHaveProperty('error_name');
    const serializedRouteContext = JSON.stringify(routeContext);
    expect(serializedRouteContext).not.toContain('山田太郎');
    expect(serializedRouteContext).not.toContain('raw generate batches detail failure');
    expect(serializedRouteContext).not.toContain('SetPlanGenerateBatchesSecretError');
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
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
    expectNoStore(response);
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

  it('rejects existing batch reuse when the set plan changed after the latest batch', async () => {
    txMock.setPlan.findFirst.mockResolvedValue({
      id: 'plan_1',
      cycle_id: 'cycle_1',
      target_period_start: new Date('2026-03-01T00:00:00.000Z'),
      target_period_end: new Date('2026-03-02T00:00:00.000Z'),
      set_method: 'custom',
      packaging_method_id: null,
      packaging_method_ref: null,
      updated_at: new Date('2026-03-01T12:00:00.000Z'),
      cycle: {
        overall_status: 'audited',
        case_: {
          patient: {
            packaging_profile: null,
          },
        },
      },
    });
    txMock.dispenseResult.findFirst.mockResolvedValue({
      updated_at: new Date('2026-03-01T10:00:00.000Z'),
    });
    txMock.setBatch.count.mockResolvedValue(1);
    txMock.setBatch.findFirst.mockResolvedValue({
      updated_at: new Date('2026-03-01T11:00:00.000Z'),
    });

    const response = await POST(createEmptyRequest(), {
      params: Promise.resolve({ id: 'plan_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '処方・調剤結果・包装判断に変更があるため、影響セットを再確認して再生成してください',
    });
    expect(txMock.setBatch.findMany).not.toHaveBeenCalled();
    expect(txMock.setBatch.createMany).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects existing batch reuse when dispensing decisions changed after the latest batch', async () => {
    txMock.prescriptionIntake.findMany.mockResolvedValue([
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
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '処方・調剤結果・包装判断に変更があるため、影響セットを再確認して再生成してください',
    });
    expect(txMock.setBatch.findMany).not.toHaveBeenCalled();
    expect(txMock.setBatch.createMany).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects forced regeneration after set audit has published carry items', async () => {
    txMock.setPlan.findFirst.mockResolvedValueOnce({
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
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message:
        'セット監査後の再生成は訪問持参物と不整合になるため実行できません。差戻し後に再生成してください',
    });
    expect(txMock.setPlan.findFirst).toHaveBeenCalled();
    expect(txMock.prescriptionIntake.findMany).not.toHaveBeenCalled();
    expect(withOrgContextMock).toHaveBeenCalledTimes(1);
    expect(txMock.setBatch.deleteMany).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('requires expected_updated_at for forced regeneration before intake reads or writes', async () => {
    const response = await POST(createRequest({ force: true }), {
      params: Promise.resolve({ id: 'plan_1' }),
    });
    if (!response) throw new Error('response is required');

    expect(response.status).toBe(400);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '強制再生成にはセットプランの版情報(expected_updated_at)が必要です',
    });
    expect(txMock.setPlan.findFirst).not.toHaveBeenCalled();
    expect(txMock.prescriptionIntake.findMany).not.toHaveBeenCalled();
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
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: 'セットプランが他のユーザーによって更新されています。再読み込みしてください',
      details: {
        current_updated_at: CURRENT_UPDATED_AT,
        expected_updated_at: '2026-02-28T00:00:00.000Z',
      },
    });
    expect(txMock.prescriptionIntake.findMany).not.toHaveBeenCalled();
    expect(withOrgContextMock).toHaveBeenCalledTimes(1);
    expect(txMock.setBatch.deleteMany).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before plan lookup or writes', async () => {
    const response = await POST(createMalformedRequest(), {
      params: Promise.resolve({ id: 'plan_1' }),
    });
    if (!response) throw new Error('response is required');

    expect(response.status).toBe(400);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(txMock.setPlan.findFirst).not.toHaveBeenCalled();
    expect(txMock.prescriptionIntake.findMany).not.toHaveBeenCalled();
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
    expectNoStore(response);
    expect(txMock.setPlan.findFirst).not.toHaveBeenCalled();
    expect(txMock.prescriptionIntake.findMany).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(txMock.setBatch.createMany).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects generation when the cycle is not audit-ready', async () => {
    txMock.setPlan.findFirst.mockResolvedValue({
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
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '鑑査未承認のサイクルはセットできません',
    });
  });
}
