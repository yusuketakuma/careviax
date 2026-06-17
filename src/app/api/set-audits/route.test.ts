import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  membershipTxFindFirstMock,
  withOrgContextMock,
  setPlanFindFirstMock,
  setPlanFindManyMock,
  setBatchFindManyMock,
  setBatchUpdateManyMock,
  setBatchChangeLogCreateMock,
  setAuditFindFirstMock,
  setAuditCreateMock,
  medicationCycleFindFirstMock,
  medicationCycleUpdateManyMock,
  cycleTransitionLogCreateMock,
  visitScheduleUpdateManyMock,
  visitPreparationUpdateManyMock,
  taskCreateMock,
  workflowExceptionCreateMock,
  notifyWorkflowMutationMock,
  createAuditLogEntryMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  membershipTxFindFirstMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  setPlanFindFirstMock: vi.fn(),
  setPlanFindManyMock: vi.fn(),
  setBatchFindManyMock: vi.fn(),
  setBatchUpdateManyMock: vi.fn(),
  setBatchChangeLogCreateMock: vi.fn(),
  setAuditFindFirstMock: vi.fn(),
  setAuditCreateMock: vi.fn(),
  medicationCycleFindFirstMock: vi.fn(),
  medicationCycleUpdateManyMock: vi.fn(),
  cycleTransitionLogCreateMock: vi.fn(),
  visitScheduleUpdateManyMock: vi.fn(),
  visitPreparationUpdateManyMock: vi.fn(),
  taskCreateMock: vi.fn(),
  workflowExceptionCreateMock: vi.fn(),
  notifyWorkflowMutationMock: vi.fn(),
  createAuditLogEntryMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/audit/audit-entry', () => ({
  createAuditLogEntry: createAuditLogEntryMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: {
      findFirst: membershipFindFirstMock,
    },
    setPlan: {
      findMany: setPlanFindManyMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/workflow-dashboard-cache', () => ({
  notifyWorkflowMutation: notifyWorkflowMutationMock,
}));

vi.mock('@/lib/dispensing/set-batch-history', () => ({
  buildSetBatchHistorySnapshot: (target: {
    id?: string | null;
    line_id: string;
    audit_state?: string | null;
    ng_code?: string | null;
    version?: number | null;
  }) => ({
    batch_id: target.id ?? null,
    line_id: target.line_id,
    audit_state: target.audit_state ?? null,
    ng_code: target.ng_code ?? null,
    version: target.version ?? null,
  }),
  createSetBatchChangeLog: setBatchChangeLogCreateMock,
}));

import { GET as rawGET, POST as rawPOST } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };
const POST = (req: NextRequest) => rawPOST(req, emptyRouteContext);
const GET = (req: NextRequest) => rawGET(req, emptyRouteContext);

function createRequest(body: unknown, headers?: Record<string, string>) {
  return new NextRequest('http://localhost/api/set-audits', {
    method: 'POST',
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

function createMalformedPostRequest(headers?: Record<string, string>) {
  return new NextRequest('http://localhost/api/set-audits', {
    method: 'POST',
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    body: '{"plan_id":',
  });
}

function completeSetAuditChecklist() {
  return {
    date_match: true,
    timing_match: true,
    quantity_match: true,
    no_discontinued: true,
    residual_usage_ok: true,
    cold_storage_separated: true,
  };
}

describe('/api/set-audits POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });
    // D1=B: 既定では自己監査の admin 承認権限なし (非管理者)。例外許可テストでのみ承認者を返す。
    membershipTxFindFirstMock.mockResolvedValue(null);
    setPlanFindFirstMock.mockResolvedValue({
      id: 'plan_1',
      cycle_id: 'cycle_1',
    });
    setBatchFindManyMock.mockResolvedValue([
      {
        id: 'batch_1',
        slot: 'morning',
        day_number: 1,
        quantity: 1,
        carry_type: 'carry',
        set_state: 'set',
        audit_state: 'ok',
        ng_code: null,
        line: {
          id: 'line_1',
          drug_name: 'アムロジピン錠5mg',
          dose: '1回1錠',
          frequency: '朝食後',
          unit: '錠',
        },
      },
    ]);
    setAuditCreateMock.mockResolvedValue({ id: 'audit_1' });
    setAuditFindFirstMock.mockResolvedValue(null);
    setBatchUpdateManyMock.mockResolvedValue({ count: 1 });
    setBatchChangeLogCreateMock.mockResolvedValue(undefined);
    createAuditLogEntryMock.mockResolvedValue(undefined);
    setPlanFindManyMock.mockResolvedValue([]);
    // Default cycle state: 'setting' (valid source for approved/partial_approved → set_audited)
    medicationCycleFindFirstMock.mockResolvedValue({
      id: 'cycle_1',
      overall_status: 'setting',
      version: 1,
    });
    medicationCycleUpdateManyMock.mockResolvedValue({ count: 1 });
    cycleTransitionLogCreateMock.mockResolvedValue({});
    visitScheduleUpdateManyMock.mockResolvedValue({ count: 1 });
    visitPreparationUpdateManyMock.mockResolvedValue({ count: 1 });
    taskCreateMock.mockResolvedValue({ id: 'task_1' });
    workflowExceptionCreateMock.mockResolvedValue({ id: 'exception_1' });

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        membership: {
          findFirst: membershipTxFindFirstMock,
        },
        setPlan: {
          findFirst: setPlanFindFirstMock,
        },
        setBatch: {
          findMany: setBatchFindManyMock,
          updateMany: setBatchUpdateManyMock,
        },
        setAudit: {
          findFirst: setAuditFindFirstMock,
          create: setAuditCreateMock,
        },
        medicationCycle: {
          findFirst: medicationCycleFindFirstMock,
          findFirstOrThrow: vi
            .fn()
            .mockResolvedValue({ id: 'cycle_1', overall_status: 'set_audited' }),
          updateMany: medicationCycleUpdateManyMock,
        },
        cycleTransitionLog: {
          create: cycleTransitionLogCreateMock,
        },
        visitSchedule: {
          updateMany: visitScheduleUpdateManyMock,
        },
        visitPreparation: {
          updateMany: visitPreparationUpdateManyMock,
        },
        task: {
          create: taskCreateMock,
        },
        workflowException: {
          create: workflowExceptionCreateMock,
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
      }),
    );
  });

  it('marks visit schedules ready and downgrades already-ready schedules on approved audits', async () => {
    const response = await POST(
      createRequest(
        {
          plan_id: 'plan_1',
          result: 'approved',
          checklist: completeSetAuditChecklist(),
        },
        { 'x-org-id': 'org_1' },
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(visitScheduleUpdateManyMock).toHaveBeenCalledTimes(2);
    expect(visitScheduleUpdateManyMock).toHaveBeenNthCalledWith(1, {
      where: {
        org_id: 'org_1',
        cycle_id: 'cycle_1',
        schedule_status: {
          in: ['planned', 'in_preparation', 'postponed'],
        },
      },
      data: {
        carry_items: [
          expect.objectContaining({
            batch_id: 'batch_1',
            drug_name: 'アムロジピン錠5mg',
            carry_type: 'carry',
          }),
        ],
        carry_items_status: 'ready',
      },
    });
    expect(visitPreparationUpdateManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        schedule: {
          org_id: 'org_1',
          cycle_id: 'cycle_1',
          schedule_status: 'ready',
        },
      },
      data: {
        carry_items_confirmed: false,
        prepared_at: null,
      },
    });
    expect(visitScheduleUpdateManyMock).toHaveBeenNthCalledWith(2, {
      where: {
        org_id: 'org_1',
        cycle_id: 'cycle_1',
        schedule_status: 'ready',
      },
      data: {
        carry_items: [
          expect.objectContaining({
            batch_id: 'batch_1',
            drug_name: 'アムロジピン錠5mg',
            carry_type: 'carry',
          }),
        ],
        carry_items_status: 'ready',
        schedule_status: 'in_preparation',
        pre_visit_checklist_completed: false,
      },
    });
  });

  it('rejects non-object audit payloads before transaction side effects', async () => {
    const response = await POST(createRequest([], { 'x-org-id': 'org_1' }));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(setPlanFindFirstMock).not.toHaveBeenCalled();
    expect(setBatchFindManyMock).not.toHaveBeenCalled();
    expect(setAuditFindFirstMock).not.toHaveBeenCalled();
    expect(setAuditCreateMock).not.toHaveBeenCalled();
    expect(medicationCycleUpdateManyMock).not.toHaveBeenCalled();
    expect(cycleTransitionLogCreateMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(taskCreateMock).not.toHaveBeenCalled();
    expect(workflowExceptionCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before transaction side effects', async () => {
    const response = await POST(createMalformedPostRequest({ 'x-org-id': 'org_1' }));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(setPlanFindFirstMock).not.toHaveBeenCalled();
    expect(setBatchFindManyMock).not.toHaveBeenCalled();
    expect(setAuditFindFirstMock).not.toHaveBeenCalled();
    expect(setAuditCreateMock).not.toHaveBeenCalled();
    expect(medicationCycleUpdateManyMock).not.toHaveBeenCalled();
    expect(cycleTransitionLogCreateMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(taskCreateMock).not.toHaveBeenCalled();
    expect(workflowExceptionCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects approval without the current checklist before transaction side effects', async () => {
    const response = await POST(
      createRequest(
        {
          plan_id: 'plan_1',
          result: 'approved',
        },
        { 'x-org-id': 'org_1' },
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '監査OKには全6項目のチェックが必要です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(setAuditCreateMock).not.toHaveBeenCalled();
  });

  it('rejects approval with an incomplete checklist (server-side gate, 3-pane flow)', async () => {
    const response = await POST(
      createRequest(
        {
          plan_id: 'plan_1',
          result: 'approved',
          checklist: {
            date_match: true,
            timing_match: true,
            quantity_match: true,
            no_discontinued: true,
            residual_usage_ok: true,
            // cold_storage_separated を欠く（5/6）→ 監査OK 不可
          },
        },
        { 'x-org-id': 'org_1' },
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(setAuditCreateMock).not.toHaveBeenCalled();
  });

  it('rejects approved audits when any batch is not set and audited OK', async () => {
    setBatchFindManyMock.mockResolvedValue([
      {
        id: 'batch_1',
        line_id: 'line_1',
        slot: 'morning',
        day_number: 1,
        quantity: 1,
        carry_type: 'carry',
        set_state: 'set',
        audit_state: 'ok',
        ng_code: null,
        version: 1,
        line: {
          id: 'line_1',
          drug_name: 'アムロジピン錠5mg',
          dose: '1回1錠',
          frequency: '朝食後',
          unit: '錠',
        },
      },
      {
        id: 'batch_2',
        line_id: 'line_2',
        slot: 'evening',
        day_number: 1,
        quantity: 1,
        carry_type: 'carry',
        set_state: 'hold',
        audit_state: 'unaudited',
        ng_code: null,
        version: 1,
        line: {
          id: 'line_2',
          drug_name: 'タケプロンOD錠15mg',
          dose: '1回1錠',
          frequency: '夕食後',
          unit: '錠',
        },
      },
    ]);

    const response = await POST(
      createRequest(
        {
          plan_id: 'plan_1',
          result: 'approved',
          checklist: completeSetAuditChecklist(),
        },
        { 'x-org-id': 'org_1' },
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '未セットまたは未監査のセルがあるため監査OKにはできません',
      details: {
        blockers: [
          {
            batch_id: 'batch_2',
            set_state: 'hold',
            audit_state: 'unaudited',
          },
        ],
      },
    });
    expect(setAuditCreateMock).not.toHaveBeenCalled();
    expect(medicationCycleUpdateManyMock).not.toHaveBeenCalled();
    expect(cycleTransitionLogCreateMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
  });

  it('returns 404 for unassigned pharmacist set audits before writes or downstream side effects', async () => {
    setPlanFindFirstMock.mockResolvedValue(null);

    const response = await POST(
      createRequest(
        {
          plan_id: 'plan_1',
          result: 'approved',
          checklist: completeSetAuditChecklist(),
        },
        { 'x-org-id': 'org_1' },
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expect(setPlanFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'plan_1',
        org_id: 'org_1',
      },
      select: {
        id: true,
        cycle_id: true,
        cycle: {
          select: {
            patient_id: true,
          },
        },
      },
    });
    expect(setBatchFindManyMock).not.toHaveBeenCalled();
    expect(setAuditCreateMock).not.toHaveBeenCalled();
    expect(medicationCycleUpdateManyMock).not.toHaveBeenCalled();
    expect(cycleTransitionLogCreateMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(taskCreateMock).not.toHaveBeenCalled();
    expect(workflowExceptionCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('marks visit schedules partial and creates a rework task on partial approval', async () => {
    const response = await POST(
      createRequest(
        {
          plan_id: 'plan_1',
          result: 'partial_approved',
          approved_scope: {
            '1-morning': true,
          },
        },
        { 'x-org-id': 'org_1' },
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(visitScheduleUpdateManyMock).toHaveBeenCalledTimes(2);
    expect(visitScheduleUpdateManyMock).toHaveBeenNthCalledWith(1, {
      where: {
        org_id: 'org_1',
        cycle_id: 'cycle_1',
        schedule_status: {
          in: ['planned', 'in_preparation', 'postponed'],
        },
      },
      data: {
        carry_items: [
          expect.objectContaining({
            batch_id: 'batch_1',
          }),
        ],
        carry_items_status: 'partial',
      },
    });
    expect(visitPreparationUpdateManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        schedule: {
          org_id: 'org_1',
          cycle_id: 'cycle_1',
          schedule_status: 'ready',
        },
      },
      data: {
        carry_items_confirmed: false,
        prepared_at: null,
      },
    });
    expect(visitScheduleUpdateManyMock).toHaveBeenNthCalledWith(2, {
      where: {
        org_id: 'org_1',
        cycle_id: 'cycle_1',
        schedule_status: 'ready',
      },
      data: {
        carry_items: [
          expect.objectContaining({
            batch_id: 'batch_1',
          }),
        ],
        carry_items_status: 'partial',
        schedule_status: 'in_preparation',
        pre_visit_checklist_completed: false,
      },
    });
    expect(taskCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        title: 'セット再作業（部分承認）',
        related_entity_id: 'cycle_1',
      }),
    });
  });

  it('rejects partial approval when the approved scope contains an unset or unaudited cell', async () => {
    setBatchFindManyMock.mockResolvedValue([
      {
        id: 'batch_pending',
        slot: 'morning',
        day_number: 1,
        quantity: 1,
        carry_type: 'carry',
        set_state: 'pending',
        audit_state: 'unaudited',
        ng_code: null,
        line: {
          id: 'line_1',
          drug_name: 'アムロジピン錠5mg',
          dose: '1回1錠',
          frequency: '朝食後',
          unit: '錠',
        },
      },
    ]);

    const response = await POST(
      createRequest(
        {
          plan_id: 'plan_1',
          result: 'partial_approved',
          approved_scope: {
            '1-morning': true,
          },
        },
        { 'x-org-id': 'org_1' },
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '部分承認範囲に未セットまたは未監査のセルが含まれています',
      details: {
        blockers: [
          {
            batch_id: 'batch_pending',
            set_state: 'pending',
            audit_state: 'unaudited',
            ng_code: null,
          },
        ],
      },
    });
    expect(medicationCycleUpdateManyMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(visitPreparationUpdateManyMock).not.toHaveBeenCalled();
    expect(taskCreateMock).not.toHaveBeenCalled();
    expect(setAuditCreateMock).not.toHaveBeenCalled();
  });

  it('rejects partial approval when the scope mixes ready and unsafe cells', async () => {
    setBatchFindManyMock.mockResolvedValue([
      {
        id: 'batch_ready',
        slot: 'morning',
        day_number: 1,
        quantity: 1,
        carry_type: 'carry',
        set_state: 'set',
        audit_state: 'ok',
        ng_code: null,
        line: {
          id: 'line_1',
          drug_name: 'アムロジピン錠5mg',
          dose: '1回1錠',
          frequency: '朝食後',
          unit: '錠',
        },
      },
      {
        id: 'batch_ng',
        slot: 'evening',
        day_number: 1,
        quantity: 1,
        carry_type: 'carry',
        set_state: 'set',
        audit_state: 'ng',
        ng_code: 'quantity_short',
        line: {
          id: 'line_2',
          drug_name: 'カンデサルタン錠4mg',
          dose: '1回1錠',
          frequency: '夕食後',
          unit: '錠',
        },
      },
    ]);

    const response = await POST(
      createRequest(
        {
          plan_id: 'plan_1',
          result: 'partial_approved',
          approved_scope: {
            '1-morning': true,
            '1-evening': true,
          },
        },
        { 'x-org-id': 'org_1' },
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      details: {
        blockers: [
          {
            batch_id: 'batch_ng',
            set_state: 'set',
            audit_state: 'ng',
            ng_code: 'quantity_short',
          },
        ],
      },
    });
    expect(medicationCycleUpdateManyMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(taskCreateMock).not.toHaveBeenCalled();
    expect(setAuditCreateMock).not.toHaveBeenCalled();
  });

  it('merges the latest partial approval scope before recalculating carry items', async () => {
    setBatchFindManyMock.mockResolvedValue([
      {
        id: 'batch_1',
        slot: 'morning',
        day_number: 1,
        quantity: 1,
        carry_type: 'carry',
        set_state: 'set',
        audit_state: 'ok',
        ng_code: null,
        line: {
          id: 'line_1',
          drug_name: 'アムロジピン錠5mg',
          dose: '1回1錠',
          frequency: '朝食後',
          unit: '錠',
        },
      },
      {
        id: 'batch_2',
        slot: 'evening',
        day_number: 2,
        quantity: 2,
        carry_type: 'carry',
        set_state: 'set',
        audit_state: 'ok',
        ng_code: null,
        line: {
          id: 'line_2',
          drug_name: 'タケプロンOD錠15mg',
          dose: '1回1錠',
          frequency: '夕食後',
          unit: '錠',
        },
      },
    ]);
    setAuditFindFirstMock.mockResolvedValue({
      result: 'partial_approved',
      approved_scope: {
        '1-morning': true,
      },
    });

    const response = await POST(
      createRequest(
        {
          plan_id: 'plan_1',
          result: 'partial_approved',
          approved_scope: {
            '2-evening': true,
          },
        },
        { 'x-org-id': 'org_1' },
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(setAuditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        approved_scope: {
          '1-morning': true,
          '2-evening': true,
        },
      }),
    });
    expect(visitScheduleUpdateManyMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        cycle_id: 'cycle_1',
      }),
      data: expect.objectContaining({
        carry_items: expect.arrayContaining([
          expect.objectContaining({ batch_id: 'batch_1' }),
          expect.objectContaining({ batch_id: 'batch_2' }),
        ]),
        carry_items_status: 'partial',
      }),
    });
  });

  it('blocks visit schedules on rejected audits', async () => {
    // rejected audits hold the cycle for rework instead of trying a no-op setting transition.
    medicationCycleFindFirstMock.mockResolvedValue({
      id: 'cycle_1',
      overall_status: 'set_audited',
      version: 1,
    });
    const response = await POST(
      createRequest(
        {
          plan_id: 'plan_1',
          result: 'rejected',
          reject_reason: '数量誤り',
          reject_reason_code: 'quantity_short',
        },
        { 'x-org-id': 'org_1' },
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(medicationCycleUpdateManyMock).toHaveBeenCalledWith({
      where: { id: 'cycle_1', org_id: 'org_1', version: 1 },
      data: { overall_status: 'on_hold', version: { increment: 1 } },
    });
    expect(visitScheduleUpdateManyMock).toHaveBeenCalledTimes(2);
    expect(visitScheduleUpdateManyMock).toHaveBeenNthCalledWith(1, {
      where: {
        org_id: 'org_1',
        cycle_id: 'cycle_1',
        schedule_status: {
          in: ['planned', 'in_preparation', 'postponed'],
        },
      },
      data: {
        carry_items: [],
        carry_items_status: 'blocked',
      },
    });
    expect(visitPreparationUpdateManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        schedule: {
          org_id: 'org_1',
          cycle_id: 'cycle_1',
          schedule_status: 'ready',
        },
      },
      data: {
        carry_items_confirmed: false,
        prepared_at: null,
      },
    });
    expect(visitScheduleUpdateManyMock).toHaveBeenNthCalledWith(2, {
      where: {
        org_id: 'org_1',
        cycle_id: 'cycle_1',
        schedule_status: 'ready',
      },
      data: {
        carry_items: [],
        carry_items_status: 'blocked',
        schedule_status: 'in_preparation',
        pre_visit_checklist_completed: false,
      },
    });
    expect(workflowExceptionCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        exception_type: 'set_audit_rejected',
      }),
    });
  });

  it('rejects invalid cycle transitions before creating a set audit record', async () => {
    medicationCycleFindFirstMock.mockResolvedValue({
      id: 'cycle_1',
      overall_status: 'visit_completed',
      version: 1,
    });

    const response = await POST(
      createRequest(
        {
          plan_id: 'plan_1',
          result: 'approved',
          checklist: completeSetAuditChecklist(),
        },
        { 'x-org-id': 'org_1' },
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'ステータス遷移が不正です: visit_completed → set_audited',
    });
    expect(setAuditCreateMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(visitPreparationUpdateManyMock).not.toHaveBeenCalled();
    expect(taskCreateMock).not.toHaveBeenCalled();
    expect(workflowExceptionCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('requires a structured NG reason code on rejected audits before any writes', async () => {
    medicationCycleFindFirstMock.mockResolvedValue({
      id: 'cycle_1',
      overall_status: 'set_audited',
      version: 1,
    });

    const response = await POST(
      createRequest(
        {
          plan_id: 'plan_1',
          result: 'rejected',
          reject_reason: '数量誤り',
          // reject_reason_code を欠く → 差戻し不可
        },
        { 'x-org-id': 'org_1' },
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '差戻し時はNG分類コード(reject_reason_code)が必須です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(setAuditCreateMock).not.toHaveBeenCalled();
  });

  it('rejects unknown NG reason codes via the RejectCode enum', async () => {
    const response = await POST(
      createRequest(
        {
          plan_id: 'plan_1',
          result: 'rejected',
          reject_reason_code: 'not_a_real_code',
        },
        { 'x-org-id': 'org_1' },
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(setAuditCreateMock).not.toHaveBeenCalled();
  });

  it('persists cell-level OK/NG audit states with version-checked optimistic locking', async () => {
    setBatchFindManyMock.mockResolvedValue([
      {
        id: 'batch_1',
        line_id: 'line_1',
        slot: 'morning',
        day_number: 1,
        quantity: 1,
        carry_type: 'carry',
        set_state: 'set',
        audit_state: 'unaudited',
        set_by: 'setter_1',
        version: 3,
        line: {
          id: 'line_1',
          drug_name: 'アムロジピン錠5mg',
          dose: '1回1錠',
          frequency: '朝食後',
          unit: '錠',
        },
      },
      {
        id: 'batch_2',
        line_id: 'line_2',
        slot: 'evening',
        day_number: 1,
        quantity: 2,
        carry_type: 'carry',
        set_state: 'set',
        audit_state: 'unaudited',
        set_by: 'setter_1',
        version: 5,
        line: {
          id: 'line_2',
          drug_name: 'タケプロンOD錠15mg',
          dose: '1回1錠',
          frequency: '夕食後',
          unit: '錠',
        },
      },
    ]);

    const response = await POST(
      createRequest(
        {
          plan_id: 'plan_1',
          result: 'partial_approved',
          approved_scope: {
            '1-morning': true,
          },
          cell_audits: [
            { batch_id: 'batch_1', audit_state: 'ok', expected_version: 3 },
            {
              batch_id: 'batch_2',
              audit_state: 'ng',
              ng_code: 'quantity_over',
              expected_version: 5,
            },
          ],
        },
        { 'x-org-id': 'org_1' },
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(setBatchUpdateManyMock).toHaveBeenCalledTimes(2);
    expect(setBatchUpdateManyMock).toHaveBeenNthCalledWith(1, {
      where: { id: 'batch_1', org_id: 'org_1', version: 3 },
      data: expect.objectContaining({
        audit_state: 'ok',
        ng_code: null,
        audited_by: 'user_1',
        version: { increment: 1 },
      }),
    });
    expect(setBatchUpdateManyMock).toHaveBeenNthCalledWith(2, {
      where: { id: 'batch_2', org_id: 'org_1', version: 5 },
      data: expect.objectContaining({
        audit_state: 'ng',
        ng_code: 'quantity_over',
        audited_by: 'user_1',
        version: { increment: 1 },
      }),
    });
    // 変更履歴 (SetBatchChangeLog) と監査ログ (AuditLog) を各セルで記録する。
    expect(setBatchChangeLogCreateMock).toHaveBeenCalledTimes(2);
    expect(setBatchChangeLogCreateMock).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        beforeSnapshot: [
          expect.objectContaining({ batch_id: 'batch_1', audit_state: 'unaudited', version: 3 }),
        ],
        afterSnapshot: [
          expect.objectContaining({ batch_id: 'batch_1', audit_state: 'ok', version: 4 }),
        ],
      }),
    );
    expect(setBatchChangeLogCreateMock).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        beforeSnapshot: [
          expect.objectContaining({ batch_id: 'batch_2', audit_state: 'unaudited', version: 5 }),
        ],
        afterSnapshot: [
          expect.objectContaining({
            batch_id: 'batch_2',
            audit_state: 'ng',
            ng_code: 'quantity_over',
            version: 6,
          }),
        ],
      }),
    );
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ action: 'set_audit.cell', targetId: 'batch_2' }),
    );
  });

  it('rejects NG cells without an NG reason code before any writes', async () => {
    const response = await POST(
      createRequest(
        {
          plan_id: 'plan_1',
          result: 'approved',
          checklist: completeSetAuditChecklist(),
          cell_audits: [{ batch_id: 'batch_1', audit_state: 'ng', expected_version: 1 }],
        },
        { 'x-org-id': 'org_1' },
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'NGセルにはNG分類コード(ng_code)が必須です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(setBatchUpdateManyMock).not.toHaveBeenCalled();
  });

  it('rejects duplicate batch ids in cell audits before any writes', async () => {
    const response = await POST(
      createRequest(
        {
          plan_id: 'plan_1',
          result: 'approved',
          checklist: completeSetAuditChecklist(),
          cell_audits: [
            { batch_id: 'batch_1', audit_state: 'ok', expected_version: 1 },
            {
              batch_id: 'batch_1',
              audit_state: 'ng',
              ng_code: 'drug_mismatch',
              expected_version: 1,
            },
          ],
        },
        { 'x-org-id': 'org_1' },
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'セル監査のバッチIDが重複しています',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  function selfAuditBatch() {
    // batch.set_by === ctx.userId (user_1) → 自己監査 (職務分離の原則違反)。
    return [
      {
        id: 'batch_1',
        line_id: 'line_1',
        slot: 'morning',
        day_number: 1,
        quantity: 1,
        carry_type: 'carry',
        set_state: 'set',
        audit_state: 'unaudited',
        set_by: 'user_1',
        version: 1,
        line: {
          id: 'line_1',
          drug_name: 'アムロジピン錠5mg',
          dose: '1回1錠',
          frequency: '朝食後',
          unit: '錠',
        },
      },
    ];
  }

  it('enforces separation of duties: the setter cannot audit their own cell without the exception', async () => {
    setBatchFindManyMock.mockResolvedValue(selfAuditBatch());

    const response = await POST(
      createRequest(
        {
          plan_id: 'plan_1',
          result: 'approved',
          checklist: completeSetAuditChecklist(),
          cell_audits: [{ batch_id: 'batch_1', audit_state: 'ok', expected_version: 1 }],
        },
        { 'x-org-id': 'org_1' },
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message:
        'ご自身がセットしたセルの監査はできません。自己監査の例外には理由(same_operator_reason)の入力が必要です',
    });
    expect(setBatchUpdateManyMock).not.toHaveBeenCalled();
    expect(setAuditCreateMock).not.toHaveBeenCalled();
  });

  it('rejects the self-audit exception for non-admins even with a reason (D1=B)', async () => {
    // 理由はあるが admin 承認権限なし (既定 membership=null) → two-person rule を維持して拒否。
    setBatchFindManyMock.mockResolvedValue(selfAuditBatch());

    const response = await POST(
      createRequest(
        {
          plan_id: 'plan_1',
          result: 'approved',
          checklist: completeSetAuditChecklist(),
          same_operator_reason: '単独管理薬剤師のため自己監査を実施',
          cell_audits: [{ batch_id: 'batch_1', audit_state: 'ok', expected_version: 1 }],
        },
        { 'x-org-id': 'org_1' },
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '自己監査の例外承認は管理者のみ実行できます',
    });
    expect(membershipTxFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          user_id: 'user_1',
          is_active: true,
          role: { in: ['owner', 'admin'] },
        }),
      }),
    );
    expect(setBatchUpdateManyMock).not.toHaveBeenCalled();
    expect(setAuditCreateMock).not.toHaveBeenCalled();
  });

  it('allows the self-audit limited exception with a reason and admin approval, recording the trail (D1=B)', async () => {
    setBatchFindManyMock.mockResolvedValue(selfAuditBatch());
    // admin 承認権限あり → 限定例外を許可。
    membershipTxFindFirstMock.mockResolvedValue({ id: 'membership_admin' });

    const response = await POST(
      createRequest(
        {
          plan_id: 'plan_1',
          result: 'approved',
          checklist: completeSetAuditChecklist(),
          same_operator_reason: '単独管理薬剤師のため自己監査を実施',
          cell_audits: [{ batch_id: 'batch_1', audit_state: 'ok', expected_version: 1 }],
        },
        { 'x-org-id': 'org_1' },
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(setBatchUpdateManyMock).toHaveBeenCalledTimes(1);
    // 自己監査の理由 + 承認者 (= 当該 admin user) を SetAudit に記録する。
    expect(setAuditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        same_operator_reason: '単独管理薬剤師のため自己監査を実施',
        same_operator_approved_by: 'user_1',
      }),
    });
    // append-only: 自己監査の限定例外発動を AuditLog に記録する。
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        action: 'set_audit.self_audit_exception',
        targetType: 'set_audit',
        changes: expect.objectContaining({
          same_operator_reason: '単独管理薬剤師のため自己監査を実施',
          same_operator_approved_by: 'user_1',
        }),
      }),
    );
  });

  it('does not record self-operator fields for normal two-person audits (D1=B)', async () => {
    // 通常監査 (set_by !== ctx.userId) では same_operator_* は記録しない。
    const response = await POST(
      createRequest(
        {
          plan_id: 'plan_1',
          result: 'rejected',
          reject_reason: '数量誤り',
          reject_reason_code: 'quantity_short',
        },
        { 'x-org-id': 'org_1' },
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(setAuditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        same_operator_reason: null,
        same_operator_approved_by: null,
      }),
    });
    expect(membershipTxFindFirstMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ action: 'set_audit.self_audit_exception' }),
    );
  });

  it('ignores any client-supplied audit timestamp and uses server time (D6)', async () => {
    setBatchFindManyMock.mockResolvedValue(selfAuditBatch());

    const before = Date.now();
    const response = await POST(
      createRequest(
        {
          plan_id: 'plan_1',
          result: 'rejected',
          reject_reason: '数量誤り',
          reject_reason_code: 'quantity_short',
          // クライアントが過去日時を偽装しても無視され、サーバ時刻が使われる。
          audited_at: '2000-01-01T00:00:00.000Z',
        },
        { 'x-org-id': 'org_1' },
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    const auditedAt = setAuditCreateMock.mock.calls[0][0].data.audited_at as Date;
    expect(auditedAt).toBeInstanceOf(Date);
    expect(auditedAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('returns 409 before audit writes when the auditor submits a stale cell version', async () => {
    setBatchFindManyMock.mockResolvedValue([
      {
        id: 'batch_1',
        line_id: 'line_1',
        slot: 'morning',
        day_number: 1,
        quantity: 1,
        carry_type: 'carry',
        set_state: 'set',
        audit_state: 'unaudited',
        set_by: 'setter_1',
        version: 2,
        line: {
          id: 'line_1',
          drug_name: 'アムロジピン錠5mg',
          dose: '1回1錠',
          frequency: '朝食後',
          unit: '錠',
        },
      },
    ]);

    const response = await POST(
      createRequest(
        {
          plan_id: 'plan_1',
          result: 'approved',
          checklist: completeSetAuditChecklist(),
          cell_audits: [{ batch_id: 'batch_1', audit_state: 'ok', expected_version: 1 }],
        },
        { 'x-org-id': 'org_1' },
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: 'セルが他のユーザーによって更新されています。再読み込みしてください',
    });
    expect(setBatchUpdateManyMock).not.toHaveBeenCalled();
    expect(setAuditCreateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('returns 400 when a cell audit targets a batch outside the plan', async () => {
    const response = await POST(
      createRequest(
        {
          plan_id: 'plan_1',
          result: 'approved',
          checklist: completeSetAuditChecklist(),
          cell_audits: [{ batch_id: 'ghost_batch', audit_state: 'ok', expected_version: 1 }],
        },
        { 'x-org-id': 'org_1' },
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '指定されたセルが当該プランに存在しません',
    });
    expect(setBatchUpdateManyMock).not.toHaveBeenCalled();
  });

  it('returns 409 when a cell update loses the optimistic lock race', async () => {
    setBatchFindManyMock.mockResolvedValue([
      {
        id: 'batch_1',
        line_id: 'line_1',
        slot: 'morning',
        day_number: 1,
        quantity: 1,
        carry_type: 'carry',
        set_state: 'set',
        audit_state: 'unaudited',
        set_by: 'setter_1',
        version: 2,
        line: {
          id: 'line_1',
          drug_name: 'アムロジピン錠5mg',
          dose: '1回1錠',
          frequency: '朝食後',
          unit: '錠',
        },
      },
    ]);
    setBatchUpdateManyMock.mockResolvedValue({ count: 0 });

    const response = await POST(
      createRequest(
        {
          plan_id: 'plan_1',
          result: 'approved',
          checklist: completeSetAuditChecklist(),
          cell_audits: [{ batch_id: 'batch_1', audit_state: 'ok', expected_version: 2 }],
        },
        { 'x-org-id': 'org_1' },
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
    });
    expect(medicationCycleUpdateManyMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(visitPreparationUpdateManyMock).not.toHaveBeenCalled();
    expect(setAuditCreateMock).not.toHaveBeenCalled();
    expect(setBatchChangeLogCreateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });
});

describe('/api/set-audits GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });
    setPlanFindManyMock.mockResolvedValue([
      {
        id: 'plan_1',
        cycle_id: 'cycle_1',
        target_period_start: new Date('2026-06-01'),
        target_period_end: new Date('2026-06-14'),
        set_method: 'four_times_daily',
        created_at: new Date('2026-06-01'),
        updated_at: new Date('2026-06-01'),
        cycle: {
          id: 'cycle_1',
          overall_status: 'setting',
          patient_id: 'patient_1',
          case_: { patient: { id: 'patient_1', name: '山田太郎', name_kana: 'ヤマダタロウ' } },
        },
        batches: [
          { id: 'batch_1', audit_state: 'ok' },
          { id: 'batch_2', audit_state: 'ng' },
          { id: 'batch_3', audit_state: 'unaudited' },
        ],
        audits: [],
      },
    ]);
  });

  function createGetRequest(query = '') {
    return new NextRequest(`http://localhost/api/set-audits${query}`, {
      method: 'GET',
      headers: { 'x-org-id': 'org_1' },
    });
  }

  it('lists set plans pending audit with per-state cell summaries', async () => {
    const response = await GET(createGetRequest());

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].cell_summary).toEqual({ total: 3, unaudited: 1, ok: 1, ng: 1 });
    expect(setPlanFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          cycle: { overall_status: 'setting' },
        }),
      }),
    );
  });

  it('filters by plan_id when provided', async () => {
    await GET(createGetRequest('?plan_id=plan_1'));

    expect(setPlanFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'plan_1' }),
      }),
    );
  });
});
