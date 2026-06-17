import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { authMock, prismaMock, withOrgContextMock, txMock, notifyWorkflowMutationMock } = vi.hoisted(
  () => ({
    authMock: vi.fn(),
    prismaMock: {
      membership: { findFirst: vi.fn() },
    },
    withOrgContextMock: vi.fn(),
    txMock: {
      setPlan: { findFirst: vi.fn() },
      setBatch: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
        updateMany: vi.fn(),
      },
      setBatchChangeLog: { create: vi.fn() },
      auditLog: { create: vi.fn() },
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

import { PATCH } from './route';

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/set-plans/plan_1/batches/cell', {
    method: 'PATCH',
    headers: {
      'x-org-id': 'org_1',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ id: 'plan_1' }) };

function buildBatch(overrides: Record<string, unknown> = {}) {
  return {
    id: 'batch_1',
    org_id: 'org_1',
    plan_id: 'plan_1',
    line_id: 'line_1',
    slot: 'morning',
    day_number: 1,
    quantity: 1,
    carry_type: 'carry',
    packaging_method_snapshot: null,
    packaging_instructions_snapshot: null,
    packaging_instruction_tags_snapshot: [],
    set_state: 'pending',
    audit_state: 'unaudited',
    held_reason: null,
    held_by: null,
    held_at: null,
    set_by: null,
    set_at: null,
    version: 1,
    line: { id: 'line_1', drug_name: 'Drug', dose: '1T', frequency: '朝', unit: '錠' },
    ...overrides,
  };
}

describe('set-plans/[id]/batches/cell PATCH', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    txMock.setPlan.findFirst.mockReset();
    txMock.setBatch.findFirst.mockReset();
    txMock.setBatch.findMany.mockReset();
    txMock.setBatch.updateMany.mockReset();
    txMock.setBatchChangeLog.create.mockReset();
    txMock.auditLog.create.mockReset();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    prismaMock.membership.findFirst.mockResolvedValue({ role: 'pharmacist' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) => callback(txMock));
    txMock.setPlan.findFirst.mockResolvedValue({
      id: 'plan_1',
      cycle: { overall_status: 'setting' },
    });
    txMock.setBatch.updateMany.mockResolvedValue({ count: 1 });
    txMock.setBatchChangeLog.create.mockResolvedValue({});
    txMock.auditLog.create.mockResolvedValue({});
  });

  it('rejects malformed JSON before any read or write', async () => {
    const badRequest = new NextRequest('http://localhost/api/set-plans/plan_1/batches/cell', {
      method: 'PATCH',
      headers: { 'x-org-id': 'org_1', 'content-type': 'application/json' },
      body: '{"action":',
    });

    const response = await PATCH(badRequest, params);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('rejects an unknown action via schema validation', async () => {
    const response = await PATCH(createRequest({ action: 'nope', batch_id: 'batch_1' }), params);
    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('requires held_reason for hold action', async () => {
    const response = await PATCH(
      createRequest({ action: 'hold', batch_id: 'batch_1', expected_version: 1 }),
      params,
    );
    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it.each([
    ['set', { action: 'set', batch_id: 'batch_1' }],
    ['hold', { action: 'hold', batch_id: 'batch_1', held_reason: 'stock_shortage' }],
    ['clear', { action: 'clear', batch_id: 'batch_1' }],
  ] as const)('requires expected_version for %s action', async (_action, body) => {
    const response = await PATCH(createRequest(body), params);
    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('returns 404 when the plan is not accessible', async () => {
    txMock.setPlan.findFirst.mockResolvedValue(null);
    const response = await PATCH(
      createRequest({ action: 'set', batch_id: 'batch_1', expected_version: 1 }),
      params,
    );
    expect(response.status).toBe(404);
    expect(txMock.setBatch.updateMany).not.toHaveBeenCalled();
  });

  it.each(['set_audited', 'visit_ready', 'visit_completed'])(
    'rejects direct cell changes after the set workflow leaves setting (%s)',
    async (status) => {
      txMock.setPlan.findFirst.mockResolvedValue({
        id: 'plan_1',
        cycle: { overall_status: status },
      });

      const response = await PATCH(
        createRequest({ action: 'clear', batch_id: 'batch_1', expected_version: 1 }),
        params,
      );

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        code: 'WORKFLOW_CONFLICT',
        details: {
          current_status: status,
          required_status: 'setting',
        },
      });
      expect(txMock.setBatch.findFirst).not.toHaveBeenCalled();
      expect(txMock.setBatch.updateMany).not.toHaveBeenCalled();
      expect(txMock.auditLog.create).not.toHaveBeenCalled();
      expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
    },
  );

  it('returns 404 when the cell is not found', async () => {
    txMock.setBatch.findFirst.mockResolvedValueOnce(null);
    const response = await PATCH(
      createRequest({ action: 'set', batch_id: 'batch_x', expected_version: 1 }),
      params,
    );
    expect(response.status).toBe(404);
    expect(txMock.setBatch.updateMany).not.toHaveBeenCalled();
  });

  it('sets a cell with server timestamp and records audit + change log', async () => {
    txMock.setBatch.findFirst
      .mockResolvedValueOnce(buildBatch())
      .mockResolvedValueOnce(
        buildBatch({ set_state: 'set', set_by: 'user_1', set_at: new Date(), version: 2 }),
      );

    const response = await PATCH(
      createRequest({ action: 'set', batch_id: 'batch_1', expected_version: 1 }),
      params,
    );
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data.set_state).toBe('set');

    // OCC: updateMany guarded by version, with server-side set_by/set_at.
    const updateArgs = txMock.setBatch.updateMany.mock.calls[0][0];
    expect(updateArgs.where).toMatchObject({
      id: 'batch_1',
      version: 1,
      plan: { cycle: { overall_status: 'setting' } },
    });
    expect(updateArgs.data).toMatchObject({ set_state: 'set', set_by: 'user_1' });
    expect(updateArgs.data.set_at).toBeInstanceOf(Date);
    expect(updateArgs.data.version).toEqual({ increment: 1 });

    // 監査証跡(append-only): AuditLog + SetBatchChangeLog
    expect(txMock.auditLog.create).toHaveBeenCalledTimes(1);
    expect(txMock.auditLog.create.mock.calls[0][0].data).toMatchObject({
      action: 'set_batch.cell_set',
      target_type: 'SetBatch',
      actor_id: 'user_1',
    });
    expect(txMock.setBatchChangeLog.create).toHaveBeenCalledTimes(1);
    expect(notifyWorkflowMutationMock).toHaveBeenCalledTimes(1);
  });

  it('returns the current cell without side effects when set is already applied', async () => {
    txMock.setBatch.findFirst.mockResolvedValueOnce(
      buildBatch({ set_state: 'set', set_by: 'user_1', set_at: new Date(), version: 2 }),
    );

    const response = await PATCH(
      createRequest({ action: 'set', batch_id: 'batch_1', expected_version: 2 }),
      params,
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data).toMatchObject({ id: 'batch_1', set_state: 'set', version: 2 });
    expect(txMock.setBatch.updateMany).not.toHaveBeenCalled();
    expect(txMock.auditLog.create).not.toHaveBeenCalled();
    expect(txMock.setBatchChangeLog.create).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('holds a cell with reason and detail', async () => {
    txMock.setBatch.findFirst
      .mockResolvedValueOnce(buildBatch())
      .mockResolvedValueOnce(
        buildBatch({ set_state: 'hold', held_reason: 'stock_shortage', version: 2 }),
      );

    const response = await PATCH(
      createRequest({
        action: 'hold',
        batch_id: 'batch_1',
        held_reason: 'stock_shortage',
        held_detail: '在庫不足',
        expected_version: 1,
      }),
      params,
    );
    expect(response.status).toBe(200);

    const updateArgs = txMock.setBatch.updateMany.mock.calls[0][0];
    expect(updateArgs.data).toMatchObject({
      set_state: 'hold',
      held_reason: 'stock_shortage',
      held_by: 'user_1',
    });
    expect(txMock.auditLog.create.mock.calls[0][0].data.changes).toMatchObject({
      held_reason: 'stock_shortage',
      held_detail: '在庫不足',
    });
  });

  it('holds all batch lines in one visible cell atomically', async () => {
    txMock.setBatch.findMany
      .mockResolvedValueOnce([
        buildBatch({ id: 'batch_1', line_id: 'line_1' }),
        buildBatch({ id: 'batch_2', line_id: 'line_2' }),
      ])
      .mockResolvedValueOnce([
        buildBatch({
          id: 'batch_1',
          line_id: 'line_1',
          set_state: 'hold',
          held_reason: 'stock_shortage',
          version: 2,
        }),
        buildBatch({
          id: 'batch_2',
          line_id: 'line_2',
          set_state: 'hold',
          held_reason: 'stock_shortage',
          version: 2,
        }),
      ]);

    const response = await PATCH(
      createRequest({
        action: 'hold',
        held_reason: 'stock_shortage',
        cells: [
          { batch_id: 'batch_1', expected_version: 1 },
          { batch_id: 'batch_2', expected_version: 1 },
        ],
      }),
      params,
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data.batches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'batch_1', version: 2 }),
        expect.objectContaining({ id: 'batch_2', version: 2 }),
      ]),
    );
    expect(txMock.setBatch.updateMany).toHaveBeenCalledTimes(2);
    expect(txMock.setBatch.updateMany.mock.calls[0][0].where).toMatchObject({
      id: 'batch_1',
      version: 1,
      plan: { cycle: { overall_status: 'setting' } },
    });
    expect(txMock.auditLog.create).toHaveBeenCalledTimes(1);
    expect(txMock.auditLog.create.mock.calls[0][0].data).toMatchObject({
      action: 'set_batch.cell_hold',
      target_type: 'SetPlan',
      target_id: 'plan_1',
    });
    expect(txMock.setBatchChangeLog.create).toHaveBeenCalledTimes(1);
    expect(notifyWorkflowMutationMock).toHaveBeenCalledTimes(1);
  });

  it('rejects grouped cell updates that span different visible cells', async () => {
    txMock.setBatch.findMany.mockResolvedValueOnce([
      buildBatch({ id: 'batch_1', line_id: 'line_1', day_number: 1, slot: 'morning' }),
      buildBatch({ id: 'batch_2', line_id: 'line_2', day_number: 2, slot: 'morning' }),
    ]);

    const response = await PATCH(
      createRequest({
        action: 'set',
        cells: [
          { batch_id: 'batch_1', expected_version: 1 },
          { batch_id: 'batch_2', expected_version: 1 },
        ],
      }),
      params,
    );

    expect(response.status).toBe(400);
    expect(txMock.setBatch.updateMany).not.toHaveBeenCalled();
    expect(txMock.auditLog.create).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rolls back grouped cell updates when any optimistic update loses the race', async () => {
    txMock.setBatch.findMany.mockResolvedValueOnce([
      buildBatch({ id: 'batch_1', line_id: 'line_1', set_state: 'set' }),
      buildBatch({ id: 'batch_2', line_id: 'line_2', set_state: 'set' }),
    ]);
    txMock.setBatch.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const response = await PATCH(
      createRequest({
        action: 'clear',
        cells: [
          { batch_id: 'batch_1', expected_version: 1 },
          { batch_id: 'batch_2', expected_version: 1 },
        ],
      }),
      params,
    );

    expect(response.status).toBe(409);
    expect(txMock.setBatch.updateMany).toHaveBeenCalledTimes(2);
    expect(txMock.auditLog.create).not.toHaveBeenCalled();
    expect(txMock.setBatchChangeLog.create).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('returns 409 with details when expected_version mismatches', async () => {
    txMock.setBatch.findFirst.mockResolvedValueOnce(buildBatch({ version: 3 }));

    const response = await PATCH(
      createRequest({ action: 'set', batch_id: 'batch_1', expected_version: 1 }),
      params,
    );
    expect(response.status).toBe(409);
    const payload = await response.json();
    expect(payload.code).toBe('WORKFLOW_CONFLICT');
    expect(payload.details).toMatchObject({
      current: { id: 'batch_1', version: 3 },
      expected_version: 1,
    });
    expect(txMock.setBatch.updateMany).not.toHaveBeenCalled();
  });

  it('returns 409 when the optimistic update loses the race (count===0)', async () => {
    txMock.setBatch.findFirst.mockResolvedValueOnce(buildBatch());
    txMock.setBatch.updateMany.mockResolvedValue({ count: 0 });

    const response = await PATCH(
      createRequest({ action: 'set', batch_id: 'batch_1', expected_version: 1 }),
      params,
    );
    expect(response.status).toBe(409);
    const payload = await response.json();
    expect(payload.code).toBe('WORKFLOW_CONFLICT');
    expect(txMock.auditLog.create).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('clears a held cell back to pending', async () => {
    txMock.setBatch.findFirst
      .mockResolvedValueOnce(buildBatch({ set_state: 'hold', held_reason: 'stock_shortage' }))
      .mockResolvedValueOnce(buildBatch({ set_state: 'pending', version: 2 }));

    const response = await PATCH(
      createRequest({ action: 'clear', batch_id: 'batch_1', expected_version: 1 }),
      params,
    );
    expect(response.status).toBe(200);
    const updateArgs = txMock.setBatch.updateMany.mock.calls[0][0];
    expect(updateArgs.data).toMatchObject({
      set_state: 'pending',
      set_by: null,
      held_reason: null,
    });
  });
});
