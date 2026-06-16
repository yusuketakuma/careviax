import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { authMock, prismaMock, withOrgContextMock, txMock, notifyWorkflowMutationMock } =
  vi.hoisted(() => ({
    authMock: vi.fn(),
    prismaMock: {
      membership: { findFirst: vi.fn() },
    },
    withOrgContextMock: vi.fn(),
    txMock: {
      setPlan: { findFirst: vi.fn() },
      setBatch: {
        findMany: vi.fn(),
        updateMany: vi.fn(),
      },
      setBatchChangeLog: { create: vi.fn() },
      auditLog: { create: vi.fn() },
    },
    notifyWorkflowMutationMock: vi.fn(),
  }));

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

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/set-plans/plan_1/batches/bulk-set', {
    method: 'POST',
    headers: {
      'x-org-id': 'org_1',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ id: 'plan_1' }) };

function buildBatch(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
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
    version: 1,
    line: { id: 'line_1', drug_name: 'Drug', dose: '1T', frequency: '朝', unit: '錠' },
    ...overrides,
  };
}

describe('set-plans/[id]/batches/bulk-set POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    prismaMock.membership.findFirst.mockResolvedValue({ role: 'pharmacist' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) => callback(txMock));
    txMock.setPlan.findFirst.mockResolvedValue({ id: 'plan_1' });
    txMock.setBatch.updateMany.mockResolvedValue({ count: 1 });
    txMock.setBatchChangeLog.create.mockResolvedValue({});
    txMock.auditLog.create.mockResolvedValue({});
  });

  it('rejects an empty cells array via schema validation', async () => {
    const response = await POST(createRequest({ cells: [] }), params);
    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('rejects duplicate cell ids before any write', async () => {
    const response = await POST(
      createRequest({ cells: [{ batch_id: 'batch_1' }, { batch_id: 'batch_1' }] }),
      params,
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '同じセルが重複して指定されています',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('returns 404 when the plan is not accessible', async () => {
    txMock.setPlan.findFirst.mockResolvedValue(null);
    const response = await POST(createRequest({ cells: [{ batch_id: 'batch_1' }] }), params);
    expect(response.status).toBe(404);
    expect(txMock.setBatch.updateMany).not.toHaveBeenCalled();
  });

  it('returns 404 when some cells are missing', async () => {
    txMock.setBatch.findMany.mockResolvedValueOnce([buildBatch('batch_1')]);
    const response = await POST(
      createRequest({ cells: [{ batch_id: 'batch_1' }, { batch_id: 'batch_2' }] }),
      params,
    );
    expect(response.status).toBe(404);
    expect(txMock.setBatch.updateMany).not.toHaveBeenCalled();
  });

  it('bulk-sets cells with a single audit entry and aggregated change log', async () => {
    txMock.setBatch.findMany
      .mockResolvedValueOnce([buildBatch('batch_1'), buildBatch('batch_2', { line_id: 'line_2' })])
      .mockResolvedValueOnce([
        buildBatch('batch_1', { set_state: 'set', set_by: 'user_1', version: 2 }),
        buildBatch('batch_2', {
          line_id: 'line_2',
          set_state: 'set',
          set_by: 'user_1',
          version: 2,
        }),
      ]);

    const response = await POST(
      createRequest({ cells: [{ batch_id: 'batch_1' }, { batch_id: 'batch_2' }] }),
      params,
    );
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data.count).toBe(2);

    // OCC update per cell, all setting set_by on the server.
    expect(txMock.setBatch.updateMany).toHaveBeenCalledTimes(2);
    const firstUpdate = txMock.setBatch.updateMany.mock.calls[0][0];
    expect(firstUpdate.where).toMatchObject({ version: 1 });
    expect(firstUpdate.data).toMatchObject({ set_state: 'set', set_by: 'user_1' });
    expect(firstUpdate.data.set_at).toBeInstanceOf(Date);

    // append-only: exactly one AuditLog for the bulk op + one change log.
    expect(txMock.auditLog.create).toHaveBeenCalledTimes(1);
    expect(txMock.auditLog.create.mock.calls[0][0].data).toMatchObject({
      action: 'set_batch.cell_bulk_set',
      target_type: 'SetPlan',
      target_id: 'plan_1',
    });
    expect(txMock.setBatchChangeLog.create).toHaveBeenCalledTimes(1);
    const changeLog = txMock.setBatchChangeLog.create.mock.calls[0][0].data;
    expect(changeLog.line_ids).toEqual(expect.arrayContaining(['line_1', 'line_2']));
    expect(notifyWorkflowMutationMock).toHaveBeenCalledTimes(1);
  });

  it('returns 409 with details when an expected_version mismatches and rolls back', async () => {
    txMock.setBatch.findMany.mockResolvedValueOnce([
      buildBatch('batch_1'),
      buildBatch('batch_2', { version: 5 }),
    ]);

    const response = await POST(
      createRequest({
        cells: [
          { batch_id: 'batch_1', expected_version: 1 },
          { batch_id: 'batch_2', expected_version: 1 },
        ],
      }),
      params,
    );
    expect(response.status).toBe(409);
    const payload = await response.json();
    expect(payload.code).toBe('WORKFLOW_CONFLICT');
    expect(payload.details).toMatchObject({
      current: { id: 'batch_2', version: 5 },
      expected_version: 1,
    });
    // First cell may have been updated, but the rollback discards the whole tx;
    // crucially no audit/change-log/notify is emitted on the conflict path.
    expect(txMock.auditLog.create).not.toHaveBeenCalled();
    expect(txMock.setBatchChangeLog.create).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('returns 409 when an optimistic update loses the race (count===0)', async () => {
    txMock.setBatch.findMany.mockResolvedValueOnce([buildBatch('batch_1')]);
    txMock.setBatch.updateMany.mockResolvedValue({ count: 0 });

    const response = await POST(createRequest({ cells: [{ batch_id: 'batch_1' }] }), params);
    expect(response.status).toBe(409);
    expect(txMock.auditLog.create).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });
});
