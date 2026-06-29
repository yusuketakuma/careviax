import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  dispenseResultFindFirstMock,
  dispenseResultFindManyMock,
  dispenseAuditFindFirstMock,
  dispenseResultUpdateMock,
  dispenseTaskUpdateMock,
  visitScheduleFindManyMock,
  visitScheduleUpdateMock,
  visitPreparationUpdateManyMock,
  medicationCycleFindFirstMock,
  medicationCycleUpdateManyMock,
  cycleTransitionLogCreateMock,
  withOrgContextMock,
  notifyWorkflowMutationMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  dispenseResultFindFirstMock: vi.fn(),
  dispenseResultFindManyMock: vi.fn(),
  dispenseAuditFindFirstMock: vi.fn(),
  dispenseResultUpdateMock: vi.fn(),
  dispenseTaskUpdateMock: vi.fn(),
  visitScheduleFindManyMock: vi.fn(),
  visitScheduleUpdateMock: vi.fn(),
  visitPreparationUpdateManyMock: vi.fn(),
  medicationCycleFindFirstMock: vi.fn(),
  medicationCycleUpdateManyMock: vi.fn(),
  cycleTransitionLogCreateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  notifyWorkflowMutationMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: {
      findFirst: membershipFindFirstMock,
    },
    dispenseResult: {
      findFirst: dispenseResultFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/workflow-dashboard-cache', () => ({
  notifyWorkflowMutation: notifyWorkflowMutationMock,
}));

import { GET, PATCH } from './route';

function createRequest(url: string, body?: unknown) {
  return new NextRequest(url, {
    method: body === undefined ? 'GET' : 'PATCH',
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      'x-org-id': 'org_1',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function createMalformedJsonPatchRequest(id = 'result_1') {
  return new NextRequest(`http://localhost/api/dispense-results/${id}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
    body: '{"actual_drug_name":',
  });
}

// 新ポリシー: pharmacist は組織内フルアクセス(担当割当スコープ撤廃)のため
// org-only の WHERE になる。担当割当の OR 句は付与されない。
const expectedResultAssignmentWhere = {};

function createExistingDispenseResult(
  overrides: Partial<{
    actual_drug_name: string;
    actual_drug_code: string | null;
    actual_quantity: number;
    actual_unit: string | null;
    discrepancy_reason: string | null;
    carry_type: string;
    prescribed_drug_name: string;
    prescribed_drug_code: string | null;
    prescribed_quantity: number | null;
    prescribed_unit: string | null;
  }> = {},
) {
  return {
    id: 'result_1',
    org_id: 'org_1',
    task_id: 'task_1',
    line_id: 'line_1',
    actual_drug_name: overrides.actual_drug_name ?? 'Drug B',
    actual_drug_code: overrides.actual_drug_code ?? 'drug-b',
    actual_quantity: overrides.actual_quantity ?? 14,
    actual_unit: overrides.actual_unit ?? '錠',
    discrepancy_reason: overrides.discrepancy_reason ?? null,
    carry_type: overrides.carry_type ?? 'carry',
    version: 1,
    line: {
      id: 'line_1',
      drug_name: overrides.prescribed_drug_name ?? 'Drug B',
      drug_code: overrides.prescribed_drug_code ?? 'drug-b',
      quantity: overrides.prescribed_quantity ?? 14,
      unit: overrides.prescribed_unit ?? '錠',
    },
  };
}

describe('/api/dispense-results/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });
    dispenseResultFindFirstMock.mockResolvedValue(createExistingDispenseResult());
    dispenseResultFindManyMock.mockResolvedValue([
      {
        line_id: 'line_1',
        actual_drug_name: 'Drug B',
        actual_drug_code: 'drug-b',
        actual_quantity: 14,
        actual_unit: '錠',
        carry_type: 'carry',
        special_notes: '再調剤',
        line: {
          drug_name: 'Drug B',
          drug_code: 'drug-b',
        },
      },
    ]);
    dispenseAuditFindFirstMock.mockResolvedValue({ id: 'audit_1', result: 'rejected' });
    dispenseResultUpdateMock.mockResolvedValue({ id: 'result_1' });
    dispenseTaskUpdateMock.mockResolvedValue({ cycle_id: 'cycle_1' });
    visitScheduleFindManyMock.mockResolvedValue([]);
    visitScheduleUpdateMock.mockResolvedValue({});
    visitPreparationUpdateManyMock.mockResolvedValue({ count: 0 });
    medicationCycleFindFirstMock.mockResolvedValue({
      id: 'cycle_1',
      overall_status: 'dispensing',
      version: 1,
    });
    medicationCycleUpdateManyMock.mockResolvedValue({ count: 1 });
    cycleTransitionLogCreateMock.mockResolvedValue({});
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        dispenseResult: {
          findFirst: dispenseResultFindFirstMock,
          findMany: dispenseResultFindManyMock,
          update: dispenseResultUpdateMock,
        },
        dispenseAudit: {
          findFirst: dispenseAuditFindFirstMock,
        },
        dispenseTask: {
          update: dispenseTaskUpdateMock,
        },
        visitSchedule: {
          findMany: visitScheduleFindManyMock,
          update: visitScheduleUpdateMock,
        },
        visitPreparation: {
          updateMany: visitPreparationUpdateManyMock,
        },
        medicationCycle: {
          findFirst: medicationCycleFindFirstMock,
          findFirstOrThrow: vi
            .fn()
            .mockResolvedValue({ id: 'cycle_1', overall_status: 'audit_pending' }),
          updateMany: medicationCycleUpdateManyMock,
        },
        cycleTransitionLog: {
          create: cycleTransitionLogCreateMock,
        },
      }),
    );
  });

  it('returns a dispense result by id', async () => {
    const response = (await GET(createRequest('http://localhost/api/dispense-results/result_1'), {
      params: Promise.resolve({ id: 'result_1' }),
    }))!;

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    expect(dispenseResultFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'result_1',
        org_id: 'org_1',
        ...expectedResultAssignmentWhere,
      },
      include: {
        line: true,
      },
    });
  });

  it('rejects blank route params before result lookup', async () => {
    const response = (await GET(createRequest('http://localhost/api/dispense-results/%20%20'), {
      params: Promise.resolve({ id: '   ' }),
    }))!;

    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    await expect(response.json()).resolves.toMatchObject({
      message: '調剤実績IDが不正です',
    });
    expect(dispenseResultFindFirstMock).not.toHaveBeenCalled();
  });

  it('denies unassigned result reads through the cycle assignment scope', async () => {
    dispenseResultFindFirstMock.mockResolvedValue(null);

    const response = (await GET(createRequest('http://localhost/api/dispense-results/result_1'), {
      params: Promise.resolve({ id: 'result_1' }),
    }))!;

    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
  });

  it('returns a sanitized no-store 500 when result lookup fails unexpectedly', async () => {
    dispenseResultFindFirstMock.mockRejectedValueOnce(
      new Error('患者 山田花子 アムロジピン 14錠 raw dispense result detail'),
    );

    const response = (await GET(createRequest('http://localhost/api/dispense-results/result_1'), {
      params: Promise.resolve({ id: 'result_1' }),
    }))!;

    expect(response.status).toBe(500);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(JSON.stringify(body)).not.toContain('山田花子');
    expect(JSON.stringify(body)).not.toContain('アムロジピン');
    expect(JSON.stringify(body)).not.toContain('14錠');
    expect(JSON.stringify(body)).not.toContain('raw dispense result detail');
  });

  it('rejects result updates when the caller lacks dispense permission', async () => {
    membershipFindFirstMock.mockResolvedValueOnce({ role: 'driver' });

    const response = (await PATCH(
      createRequest('http://localhost/api/dispense-results/result_1', {
        actual_drug_name: 'Drug B',
      }),
      {
        params: Promise.resolve({ id: 'result_1' }),
      },
    ))!;

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      message: '調剤実績の更新権限がありません',
    });
    expect(dispenseResultFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('patches a dispense result only after a rejected audit and resets statuses', async () => {
    visitScheduleFindManyMock.mockResolvedValue([
      { id: 'visit_ready', schedule_status: 'ready' },
      { id: 'visit_planned', schedule_status: 'planned' },
    ]);

    const response = (await PATCH(
      createRequest('http://localhost/api/dispense-results/result_1', {
        actual_drug_name: 'Drug B',
        actual_quantity_confirmed: true,
        actual_quantity_source: 'existing_result',
      }),
      {
        params: Promise.resolve({ id: 'result_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    expect(dispenseResultFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'result_1',
        org_id: 'org_1',
        ...expectedResultAssignmentWhere,
      },
      select: {
        id: true,
        task_id: true,
        line_id: true,
        actual_drug_name: true,
        actual_drug_code: true,
        actual_quantity: true,
        actual_unit: true,
        discrepancy_reason: true,
        carry_type: true,
        version: true,
        line: {
          select: {
            id: true,
            drug_name: true,
            drug_code: true,
            quantity: true,
            unit: true,
          },
        },
      },
    });
    expect(dispenseResultUpdateMock).toHaveBeenCalledWith({
      where: { id: 'result_1' },
      data: expect.objectContaining({
        actual_drug_name: 'Drug B',
        version: { increment: 1 },
      }),
    });
    expect(dispenseTaskUpdateMock).toHaveBeenCalledWith({
      where: { id: 'task_1' },
      data: { status: 'completed' },
      select: { cycle_id: true },
    });
    expect(medicationCycleUpdateManyMock).toHaveBeenCalledWith({
      where: { id: 'cycle_1', org_id: 'org_1', version: 1 },
      data: { overall_status: 'audit_pending', version: { increment: 1 } },
    });
    expect(visitScheduleFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        cycle_id: 'cycle_1',
        schedule_status: { in: ['planned', 'in_preparation', 'ready'] },
      },
      select: { id: true, schedule_status: true },
    });
    expect(dispenseResultFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        task_id: 'task_1',
      },
      select: {
        line_id: true,
        actual_drug_name: true,
        actual_drug_code: true,
        actual_quantity: true,
        actual_unit: true,
        carry_type: true,
        special_notes: true,
        line: {
          select: {
            drug_name: true,
            drug_code: true,
          },
        },
      },
    });
    expect(visitPreparationUpdateManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        schedule_id: { in: ['visit_ready'] },
      },
      data: {
        carry_items_confirmed: false,
        prepared_at: null,
      },
    });
    expect(visitScheduleUpdateMock).toHaveBeenCalledWith({
      where: { id: 'visit_ready' },
      data: {
        carry_items: [
          {
            line_id: 'line_1',
            drug_name: 'Drug B',
            drug_code: 'drug-b',
            quantity: 14,
            unit: '錠',
            carry_type: 'carry',
            special_notes: '再調剤',
          },
        ],
        carry_items_status: 'ready',
        schedule_status: 'in_preparation',
        pre_visit_checklist_completed: false,
      },
    });
    expect(visitScheduleUpdateMock).toHaveBeenCalledWith({
      where: { id: 'visit_planned' },
      data: {
        carry_items: [
          {
            line_id: 'line_1',
            drug_name: 'Drug B',
            drug_code: 'drug-b',
            quantity: 14,
            unit: '錠',
            carry_type: 'carry',
            special_notes: '再調剤',
          },
        ],
        carry_items_status: 'ready',
      },
    });
    expect(cycleTransitionLogCreateMock).toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      eventType: 'cycle_transition',
      payload: { source: 'dispense_results_rework', result_id: 'result_1' },
    });
  });

  it('preserves prescribed drug code in visit carry items when reworked actual drug code is blank', async () => {
    visitScheduleFindManyMock.mockResolvedValue([
      { id: 'visit_planned', schedule_status: 'planned' },
    ]);
    dispenseResultFindManyMock.mockResolvedValueOnce([
      {
        line_id: 'line_1',
        actual_drug_name: 'Drug B',
        actual_drug_code: '',
        actual_quantity: 14,
        actual_unit: '錠',
        carry_type: 'carry',
        special_notes: '再調剤',
        line: {
          drug_name: 'Drug B',
          drug_code: 'drug-b',
        },
      },
    ]);

    const response = (await PATCH(
      createRequest('http://localhost/api/dispense-results/result_1', {
        actual_drug_name: 'Drug B',
        actual_quantity_confirmed: true,
        actual_quantity_source: 'existing_result',
      }),
      {
        params: Promise.resolve({ id: 'result_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    expect(visitScheduleUpdateMock).toHaveBeenCalledWith({
      where: { id: 'visit_planned' },
      data: {
        carry_items: [
          {
            line_id: 'line_1',
            drug_name: 'Drug B',
            drug_code: 'drug-b',
            quantity: 14,
            unit: '錠',
            carry_type: 'carry',
            special_notes: '再調剤',
          },
        ],
        carry_items_status: 'ready',
      },
    });
  });

  it('rejects non-quantity safety corrections without quantity confirmation evidence', async () => {
    const response = (await PATCH(
      createRequest('http://localhost/api/dispense-results/result_1', {
        actual_drug_name: 'Drug C',
        discrepancy_reason: '代替調剤',
      }),
      {
        params: Promise.resolve({ id: 'result_1' }),
      },
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '調剤実数量の確認元が未確定の明細があります。数量確認後に調剤完了してください',
      details: {
        actual_quantity_confirmation_lines: [
          { line_id: 'line_1', reason: 'actual_quantity_confirmation_required' },
        ],
      },
    });
    expect(dispenseResultUpdateMock).not.toHaveBeenCalled();
    expect(dispenseTaskUpdateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'missing confirmation flag',
      payload: {
        actual_quantity: 12,
        discrepancy_reason: '残薬調整',
      },
      reason: 'actual_quantity_confirmation_required',
    },
    {
      name: 'missing quantity source',
      payload: {
        actual_quantity: 12,
        actual_quantity_confirmed: true,
        discrepancy_reason: '残薬調整',
      },
      reason: 'actual_quantity_source_required',
    },
    {
      name: 'prescription quantity source mismatch',
      payload: {
        actual_quantity: 12,
        actual_quantity_confirmed: true,
        actual_quantity_source: 'prescription_quantity_confirmed',
        discrepancy_reason: '残薬調整',
      },
      reason: 'prescription_quantity_mismatch',
    },
  ])(
    'rejects quantity correction patches with $name before rework side effects',
    async ({ payload, reason }) => {
      const response = (await PATCH(
        createRequest('http://localhost/api/dispense-results/result_1', payload),
        {
          params: Promise.resolve({ id: 'result_1' }),
        },
      ))!;

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        message: '調剤実数量の確認元が未確定の明細があります。数量確認後に調剤完了してください',
        details: {
          actual_quantity_confirmation_lines: [{ line_id: 'line_1', reason }],
        },
      });
      expect(dispenseResultUpdateMock).not.toHaveBeenCalled();
      expect(dispenseTaskUpdateMock).not.toHaveBeenCalled();
      expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
    },
  );

  it('rejects quantity correction patches that do not match the prescription unit step', async () => {
    dispenseResultFindFirstMock.mockResolvedValue(
      createExistingDispenseResult({
        actual_unit: '包',
        prescribed_unit: '包',
      }),
    );

    const response = (await PATCH(
      createRequest('http://localhost/api/dispense-results/result_1', {
        actual_quantity: 12.5,
        actual_quantity_confirmed: true,
        actual_quantity_source: 'manual_entry',
        actual_unit: 'g',
        discrepancy_reason: '残薬調整',
      }),
      {
        params: Promise.resolve({ id: 'result_1' }),
      },
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '実数量が単位に合う刻みではありません',
      details: {
        actual_quantity_unit_lines: [
          {
            line_id: 'line_1',
            reason: 'actual_quantity_unit_step_invalid',
            unit: '包',
            step: '1',
          },
        ],
      },
    });
    expect(dispenseResultUpdateMock).not.toHaveBeenCalled();
    expect(dispenseTaskUpdateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects quantity correction patches without discrepancy reason before writes', async () => {
    const response = (await PATCH(
      createRequest('http://localhost/api/dispense-results/result_1', {
        actual_quantity: 12,
        actual_quantity_confirmed: true,
        actual_quantity_source: 'manual_entry',
      }),
      {
        params: Promise.resolve({ id: 'result_1' }),
      },
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '差異/欠品/代替がある明細は理由コードを入力してください',
      details: {
        discrepancy_lines: [
          {
            line_id: 'line_1',
            reason: '処方との差異があるため理由コードが必須です',
          },
        ],
      },
    });
    expect(dispenseResultUpdateMock).not.toHaveBeenCalled();
    expect(dispenseTaskUpdateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('accepts a confirmed quantity correction and stores the prescription unit as canonical', async () => {
    const response = (await PATCH(
      createRequest('http://localhost/api/dispense-results/result_1', {
        actual_quantity: 12,
        actual_quantity_confirmed: true,
        actual_quantity_source: 'manual_entry',
        actual_unit: 'g',
        discrepancy_reason: '残薬調整',
      }),
      {
        params: Promise.resolve({ id: 'result_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    expect(dispenseResultUpdateMock).toHaveBeenCalledWith({
      where: { id: 'result_1' },
      data: expect.objectContaining({
        actual_quantity: 12,
        actual_unit: '錠',
        discrepancy_reason: '残薬調整',
        version: { increment: 1 },
      }),
    });
    expect(notifyWorkflowMutationMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      eventType: 'cycle_transition',
      payload: { source: 'dispense_results_rework', result_id: 'result_1' },
    });
  });

  it('rejects blank patch route params before body parsing or rework side effects', async () => {
    const response = (await PATCH(createMalformedJsonPatchRequest(''), {
      params: Promise.resolve({ id: '\t\n' }),
    }))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '調剤実績IDが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(dispenseResultFindFirstMock).not.toHaveBeenCalled();
    expect(dispenseAuditFindFirstMock).not.toHaveBeenCalled();
    expect(dispenseResultUpdateMock).not.toHaveBeenCalled();
    expect(dispenseTaskUpdateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects non-object patch payloads before result lookup or rework side effects', async () => {
    const response = (await PATCH(
      createRequest('http://localhost/api/dispense-results/result_1', []),
      {
        params: Promise.resolve({ id: 'result_1' }),
      },
    ))!;

    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(dispenseResultFindFirstMock).not.toHaveBeenCalled();
    expect(dispenseAuditFindFirstMock).not.toHaveBeenCalled();
    expect(dispenseResultUpdateMock).not.toHaveBeenCalled();
    expect(dispenseTaskUpdateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON patch payloads before result lookup or rework side effects', async () => {
    const response = (await PATCH(createMalformedJsonPatchRequest(), {
      params: Promise.resolve({ id: 'result_1' }),
    }))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(dispenseResultFindFirstMock).not.toHaveBeenCalled();
    expect(dispenseAuditFindFirstMock).not.toHaveBeenCalled();
    expect(dispenseResultUpdateMock).not.toHaveBeenCalled();
    expect(dispenseTaskUpdateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('denies unassigned result patches before audit checks or writes', async () => {
    dispenseResultFindFirstMock.mockResolvedValue(null);

    const response = (await PATCH(
      createRequest('http://localhost/api/dispense-results/result_unassigned', {
        actual_drug_name: 'Drug B',
      }),
      {
        params: Promise.resolve({ id: 'result_unassigned' }),
      },
    ))!;

    expect(response.status).toBe(404);
    expect(dispenseAuditFindFirstMock).not.toHaveBeenCalled();
    expect(dispenseResultUpdateMock).not.toHaveBeenCalled();
    expect(dispenseTaskUpdateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });
});
