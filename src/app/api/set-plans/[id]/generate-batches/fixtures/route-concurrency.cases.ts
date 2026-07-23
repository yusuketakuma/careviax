import { expect, it } from 'vitest';
import { getGenerateBatchesRouteTestSupport } from './route.test-support';

const {
  buildSerializableConflictError,
  createRequest,
  CURRENT_UPDATED_AT,
  expectNoStore,
  notifyWorkflowMutationMock,
  POST,
  prismaMock,
  txMock,
  withOrgContextMock,
} = getGenerateBatchesRouteTestSupport();

export function registerGenerateBatchesConcurrencyCases() {
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
    expectNoStore(response);
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
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '処方・調剤結果・包装判断に変更があるため、影響セットを再確認して再生成してください',
    });
    expect(txMock.setBatch.createMany).not.toHaveBeenCalled();
    expect(txMock.setBatchChangeLog.create).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects batches found immediately before creation when the plan changed after them', async () => {
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
    txMock.setBatch.count.mockResolvedValue(0);
    txMock.setBatch.findMany.mockResolvedValue([
      {
        id: 'batch_concurrent',
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

    expect(response.status).toBe(400);
    expectNoStore(response);
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
    expectNoStore(response);
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
    expectNoStore(response);
    expect(payload.data.reused).toBe(true);
    expect(payload.data.count).toBe(1);
    expect(withOrgContextMock).toHaveBeenCalledTimes(2);
    expect(txMock.setBatch.createMany).not.toHaveBeenCalled();
  });

  it('retries serializable conflicts by reloading the latest intake inside the transaction', async () => {
    let attempt = 0;
    withOrgContextMock.mockImplementation(async (_orgId, callback) => {
      attempt += 1;
      if (attempt === 1) {
        txMock.prescriptionIntake.findMany.mockResolvedValueOnce([
          {
            updated_at: new Date('2026-03-01T00:00:00.000Z'),
            lines: [
              {
                id: 'line_old',
                drug_name: '旧処方',
                frequency: '朝',
                quantity: 1,
                unit: '錠',
                packaging_group_id: null,
                packaging_method: null,
                packaging_instructions: null,
                packaging_instruction_tags: [],
                notes: null,
                dispensing_decisions: [],
                dispense_results: [
                  {
                    id: 'result_old',
                    actual_quantity: 1,
                    actual_unit: '錠',
                    updated_at: new Date('2026-03-01T10:00:00.000Z'),
                  },
                ],
              },
            ],
          },
        ]);
        await callback(txMock);
        throw buildSerializableConflictError();
      }

      txMock.prescriptionIntake.findMany.mockResolvedValueOnce([
        {
          updated_at: new Date('2026-03-01T00:30:00.000Z'),
          lines: [
            {
              id: 'line_new',
              drug_name: '新処方',
              frequency: '朝夕',
              quantity: 4,
              unit: '錠',
              packaging_group_id: null,
              packaging_method: null,
              packaging_instructions: null,
              packaging_instruction_tags: [],
              notes: null,
              dispensing_decisions: [],
              dispense_results: [
                {
                  id: 'result_new',
                  actual_quantity: 4,
                  actual_unit: '錠',
                  updated_at: new Date('2026-03-01T10:30:00.000Z'),
                },
              ],
            },
          ],
        },
      ]);
      return callback(txMock);
    });
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
    expectNoStore(response);
    expect(withOrgContextMock).toHaveBeenCalledTimes(2);
    expect(txMock.prescriptionIntake.findMany).toHaveBeenCalledTimes(2);
    const createdRows = txMock.setBatch.createMany.mock.calls.at(-1)?.[0].data as Array<{
      line_id: string;
    }>;
    expect(createdRows).toEqual(
      expect.arrayContaining([expect.objectContaining({ line_id: 'line_new' })]),
    );
    expect(createdRows).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ line_id: 'line_old' })]),
    );
  });

  it('returns 404 for unassigned pharmacist generation before intake reads or writes', async () => {
    prismaMock.membership.findFirst.mockResolvedValue({ role: 'pharmacist' });
    txMock.setPlan.findFirst.mockResolvedValue(null);

    const response = await POST(createRequest({ force: false }), {
      params: Promise.resolve({ id: 'plan_1' }),
    });
    if (!response) throw new Error('response is required');

    expect(response.status).toBe(404);
    expectNoStore(response);
    expect(txMock.setPlan.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'plan_1',
        org_id: 'org_1',
      },
      select: expect.any(Object),
    });
    expect(txMock.prescriptionIntake.findMany).not.toHaveBeenCalled();
    expect(withOrgContextMock).toHaveBeenCalledTimes(1);
    expect(txMock.setBatch.createMany).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });
}
