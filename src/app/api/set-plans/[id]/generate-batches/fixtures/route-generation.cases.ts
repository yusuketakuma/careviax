import { expect, it } from 'vitest';
import { getGenerateBatchesRouteTestSupport } from './route.test-support';

const {
  createRequest,
  CURRENT_UPDATED_AT,
  expectNoStore,
  notifyWorkflowMutationMock,
  POST,
  txMock,
} = getGenerateBatchesRouteTestSupport();

export function registerGenerateBatchesGenerationCases() {
  it('splits total prescription quantity across days and slots without multiplying the dose', async () => {
    txMock.setPlan.findFirst.mockResolvedValue({
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
    txMock.prescriptionIntake.findMany.mockResolvedValue([
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
    expectNoStore(response);
    expect(txMock.prescriptionIntake.findMany).toHaveBeenCalledWith(
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
    txMock.setPlan.findFirst.mockResolvedValue({
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
    txMock.prescriptionIntake.findMany.mockResolvedValue([
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
    expectNoStore(response);
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
    txMock.prescriptionIntake.findMany.mockResolvedValue([
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
    expectNoStore(response);
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
    txMock.prescriptionIntake.findMany.mockResolvedValue([
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
    expectNoStore(response);
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
    txMock.prescriptionIntake.findMany.mockResolvedValue([
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
    expectNoStore(response);
    expect(txMock.prescriptionIntake.findMany).toHaveBeenCalledWith(
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
    txMock.prescriptionIntake.findMany.mockResolvedValue([
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
    expectNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      message: '監査済み調剤結果がない処方があります',
    });
    expect(JSON.stringify(body)).not.toContain('アムロジピン錠5mg');
    expect(txMock.setBatch.createMany).not.toHaveBeenCalled();
    expect(txMock.setBatchChangeLog.create).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects missing frequency without exposing the drug name in the response body', async () => {
    txMock.prescriptionIntake.findMany.mockResolvedValue([
      {
        updated_at: new Date('2026-03-01T00:00:00.000Z'),
        lines: [
          {
            id: 'line_missing_frequency',
            drug_name: 'アムロジピン錠5mg',
            frequency: '',
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

    const response = await POST(createRequest({ force: false }), {
      params: Promise.resolve({ id: 'plan_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      message: '投与タイミング未定義の処方があります',
    });
    expect(JSON.stringify(body)).not.toContain('アムロジピン錠5mg');
    expect(txMock.setBatch.count).not.toHaveBeenCalled();
    expect(txMock.setBatch.createMany).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects uncalculable set quantity without exposing the drug name in the response body', async () => {
    txMock.prescriptionIntake.findMany.mockResolvedValue([
      {
        updated_at: new Date('2026-03-01T00:00:00.000Z'),
        lines: [
          {
            id: 'line_zero_actual_quantity',
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
                id: 'result_zero',
                actual_quantity: 0,
                actual_unit: '錠',
                updated_at: new Date('2026-03-01T10:00:00.000Z'),
              },
            ],
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
    expectNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      message: 'セット数量を計算できない処方があります',
    });
    expect(JSON.stringify(body)).not.toContain('アムロジピン錠5mg');
    expect(txMock.setBatch.createMany).not.toHaveBeenCalled();
    expect(txMock.setBatchChangeLog.create).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });
}
