import { Prisma } from '@prisma/client';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  authMode,
  registeredAuthOptions,
  withOrgContextMock,
  resolveDashboardAssignmentScopeMock,
  buildDashboardTaskAssignmentWhereMock,
  taskFindFirstMock,
  lineFindFirstMock,
  patientFindFirstMock,
  requireWritablePatientMock,
  applyPrescriptionSupplyForIntakeMock,
  previewPrescriptionSupplyReviewMock,
  createAuditLogEntryMock,
  resolveOperationalTasksMock,
} = vi.hoisted(() => ({
  authMode: { value: 'ok' as 'ok' | 'unauthenticated' | 'forbidden' },
  registeredAuthOptions: [] as unknown[],
  withOrgContextMock: vi.fn(),
  resolveDashboardAssignmentScopeMock: vi.fn(),
  buildDashboardTaskAssignmentWhereMock: vi.fn(),
  taskFindFirstMock: vi.fn(),
  lineFindFirstMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  requireWritablePatientMock: vi.fn(),
  applyPrescriptionSupplyForIntakeMock: vi.fn(),
  previewPrescriptionSupplyReviewMock: vi.fn(),
  createAuditLogEntryMock: vi.fn(),
  resolveOperationalTasksMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => unknown, options?: unknown) => {
    registeredAuthOptions.push(options);
    return (req: NextRequest, routeContext: { params: Promise<{ id: string }> }) => {
      if (authMode.value === 'unauthenticated') {
        return new Response(JSON.stringify({ code: 'AUTH_UNAUTHENTICATED' }), { status: 401 });
      }
      if (authMode.value === 'forbidden') {
        return new Response(JSON.stringify({ code: 'AUTH_FORBIDDEN' }), { status: 403 });
      }
      return handler(req, { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' }, routeContext);
    };
  },
}));

vi.mock('@/lib/db/client', () => ({ prisma: {} }));
vi.mock('@/lib/db/rls', () => ({ withOrgContext: withOrgContextMock }));
vi.mock('@/lib/audit/audit-entry', () => ({ createAuditLogEntry: createAuditLogEntryMock }));
vi.mock('@/server/services/patient-write-guard', () => ({
  requireWritablePatient: requireWritablePatientMock,
}));
vi.mock('@/server/services/dashboard-assignment-scope', () => ({
  resolveDashboardAssignmentScope: resolveDashboardAssignmentScopeMock,
  buildDashboardTaskAssignmentWhere: buildDashboardTaskAssignmentWhereMock,
}));
vi.mock('@/server/services/operational-tasks', () => ({
  resolveOperationalTasks: resolveOperationalTasksMock,
}));
vi.mock('@/modules/pharmacy/medication-stock/application/apply-prescription-supply', () => ({
  applyPrescriptionSupplyForIntake: applyPrescriptionSupplyForIntakeMock,
  previewPrescriptionSupplyReview: previewPrescriptionSupplyReviewMock,
}));

import { GET, POST } from './route';

const tx = {
  task: { findFirst: taskFindFirstMock },
  prescriptionLine: { findFirst: lineFindFirstMock },
  patient: { findFirst: patientFindFirstMock },
  auditLog: {},
};

function request(body: unknown = { stock_item_id: 'stock_1' }, id = 'task_1') {
  return new NextRequest(`http://localhost/api/tasks/${id}/prescription-supply/resolve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function post(body?: unknown, id?: string) {
  return POST(request(body, id), { params: Promise.resolve({ id: id ?? 'task_1' }) });
}

function get(id = 'task_1') {
  const req = new NextRequest(`http://localhost/api/tasks/${id}/prescription-supply/resolve`);
  return GET(req, { params: Promise.resolve({ id }) });
}

function expectNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('POST /api/tasks/[id]/prescription-supply/resolve', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMode.value = 'ok';
    resolveDashboardAssignmentScopeMock.mockResolvedValue({ assignedToUserId: 'user_1' });
    buildDashboardTaskAssignmentWhereMock.mockReturnValue({ assigned_to: 'user_1' });
    taskFindFirstMock.mockResolvedValue({
      id: 'task_1',
      assigned_to: 'user_1',
      related_entity_type: 'prescription_line',
      related_entity_id: 'line_1',
      metadata: { prescription_intake_id: 'intake_1' },
    });
    lineFindFirstMock.mockResolvedValue({
      id: 'line_1',
      intake_id: 'intake_1',
      intake: { cycle: { patient_id: 'patient_1' } },
    });
    requireWritablePatientMock.mockResolvedValue({ patient: { id: 'patient_1' } });
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      display_id: 'PAT-001',
      name: '山田 花子',
      name_kana: 'ヤマダ ハナコ',
      birth_date: new Date('1940-01-02T00:00:00.000Z'),
    });
    previewPrescriptionSupplyReviewMock.mockResolvedValue({
      kind: 'reviewable',
      line: {
        id: 'line_1',
        drug_name: '湿布A',
        drug_code: '2649735S1010',
        dosage_form: '貼付剤',
        dose: '1回1枚',
        frequency: '疼痛時',
        days: 7,
        quantity: 10,
        unit: '枚',
        route: 'external',
      },
      normalized_supply: { quantity: 10, unit: 'sheet' },
      candidates: [],
    });
    applyPrescriptionSupplyForIntakeMock.mockResolvedValue({
      intake_id: 'intake_1',
      applied_count: 1,
      review_required_count: 0,
      skipped_count: 0,
      results: [
        {
          kind: 'applied',
          prescription_line_id: 'line_1',
          stock_item_id: 'stock_1',
          stock_event_id: 'event_1',
          snapshot: {
            current_quantity: 10,
            stock_risk_level: 'ok',
            calculated_at: '2026-07-17T00:00:00.000Z',
          },
          idempotent_replay: false,
        },
      ],
    });
    createAuditLogEntryMock.mockResolvedValue({ id: 'audit_1' });
    resolveOperationalTasksMock.mockResolvedValue({ count: 1 });
    withOrgContextMock.mockImplementation(async (_orgId, callback) => callback(tx));
  });

  it('returns an assignment-scoped, writable-patient review preview', async () => {
    const response = await get();

    expect(response.status).toBe(200);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        task: { id: 'task_1', reason_code: null },
        patient: {
          id: 'patient_1',
          display_id: 'PAT-001',
          name: '山田 花子',
          birth_date: '1940-01-02T00:00:00.000Z',
        },
        preview: { kind: 'reviewable', normalized_supply: { quantity: 10, unit: 'sheet' } },
      },
    });
    expect(previewPrescriptionSupplyReviewMock).toHaveBeenCalledWith(tx, {
      orgId: 'org_1',
      intakeId: 'intake_1',
      patientId: 'patient_1',
      prescriptionLineId: 'line_1',
    });
    expect(registeredAuthOptions).toContainEqual({
      permission: 'canDispense',
      message: '処方供給の残数台帳紐づけを確認する権限がありません',
    });
  });

  it('does not disclose a review task outside the assignment scope', async () => {
    taskFindFirstMock.mockResolvedValueOnce(null);

    const response = await get();

    expect(response.status).toBe(404);
    expectNoStore(response);
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(previewPrescriptionSupplyReviewMock).not.toHaveBeenCalled();
  });

  it('applies the reviewed stock item and completes the exact task atomically', async () => {
    const response = await post();

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(registeredAuthOptions).toContainEqual({
      permission: 'canDispense',
      message: '処方供給の残数台帳紐づけを確定する権限がありません',
    });
    expect(taskFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'task_1',
        org_id: 'org_1',
        task_type: 'pharmacy.medication_stock_unlinked_prescription_supply',
        status: { in: ['pending', 'in_progress'] },
        assigned_to: 'user_1',
      },
      select: {
        id: true,
        assigned_to: true,
        related_entity_type: true,
        related_entity_id: true,
        metadata: true,
      },
    });
    expect(requireWritablePatientMock).toHaveBeenCalledWith(tx, expect.anything(), 'patient_1');
    expect(lineFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'line_1',
        org_id: 'org_1',
        intake_id: 'intake_1',
        intake: { org_id: 'org_1' },
      },
      select: {
        id: true,
        intake_id: true,
        intake: {
          select: {
            cycle: { select: { patient_id: true } },
          },
        },
      },
    });
    expect(applyPrescriptionSupplyForIntakeMock).toHaveBeenCalledWith(tx, {
      orgId: 'org_1',
      userId: 'user_1',
      intakeId: 'intake_1',
      patientId: 'patient_1',
      reviewSelection: { prescriptionLineId: 'line_1', stockItemId: 'stock_1' },
    });
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(tx, expect.anything(), {
      action: 'medication_stock.prescription_supply_review_applied',
      targetType: 'Task',
      targetId: 'task_1',
      patientId: 'patient_1',
      changes: {
        prescription_intake_id: 'intake_1',
        prescription_line_id: 'line_1',
        stock_item_id: 'stock_1',
        stock_event_id: 'event_1',
        idempotent_replay: false,
      },
    });
    expect(resolveOperationalTasksMock).toHaveBeenCalledWith(tx, {
      orgId: 'org_1',
      taskId: 'task_1',
      taskType: 'pharmacy.medication_stock_unlinked_prescription_supply',
      status: 'completed',
      resolution: {
        state: 'resolved',
        actorUserId: 'user_1',
        auditLogId: 'audit_1',
        reasonCode: 'prescription_supply_applied',
      },
    });
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' },
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeoutMs: 10_000,
    });
  });

  it('returns a neutral 404 for an inaccessible or malformed review task', async () => {
    taskFindFirstMock.mockResolvedValueOnce(null);

    const response = await post();

    expect(response.status).toBe(404);
    expectNoStore(response);
    expect(applyPrescriptionSupplyForIntakeMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('rejects task metadata that is not bound to a prescription intake', async () => {
    taskFindFirstMock.mockResolvedValueOnce({
      id: 'task_1',
      assigned_to: 'user_1',
      related_entity_type: 'prescription_line',
      related_entity_id: 'line_1',
      metadata: {},
    });

    const response = await post();

    expect(response.status).toBe(404);
    expect(lineFindFirstMock).not.toHaveBeenCalled();
    expect(applyPrescriptionSupplyForIntakeMock).not.toHaveBeenCalled();
  });

  it('keeps the task open when the selected stock item fails exact service checks', async () => {
    applyPrescriptionSupplyForIntakeMock.mockResolvedValueOnce({
      intake_id: 'intake_1',
      applied_count: 0,
      review_required_count: 1,
      skipped_count: 0,
      results: [
        {
          kind: 'review_required',
          prescription_line_id: 'line_1',
          reason_code: 'unit_conversion_required',
          task_id: 'task_1',
          candidate_count: 1,
        },
      ],
    });

    const response = await post();

    expect(response.status).toBe(409);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      details: { reason_code: 'unit_conversion_required' },
    });
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
  });

  it('preserves writable-patient rejection without apply, audit, or completion', async () => {
    requireWritablePatientMock.mockResolvedValueOnce({
      response: new Response(JSON.stringify({ code: 'WORKFLOW_CONFLICT' }), { status: 409 }),
    });

    const response = await post();

    expect(response.status).toBe(409);
    expectNoStore(response);
    expect(applyPrescriptionSupplyForIntakeMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
  });

  it('rejects invalid body and task IDs before opening the transaction', async () => {
    const invalidBody = await post({ stock_item_id: ' ', unexpected: true });
    expect(invalidBody.status).toBe(400);
    expectNoStore(invalidBody);

    const invalidId = await post({ stock_item_id: 'stock_1' }, ' ');
    expect(invalidId.status).toBe(400);
    expectNoStore(invalidId);
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('rolls back with conflict when task completion loses the race', async () => {
    resolveOperationalTasksMock.mockResolvedValueOnce({ count: 0 });

    const response = await post();

    expect(response.status).toBe(409);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({ code: 'WORKFLOW_CONFLICT' });
  });

  it('applies no-store headers to auth failures', async () => {
    authMode.value = 'unauthenticated';
    const unauthenticated = await post();
    expect(unauthenticated.status).toBe(401);
    expectNoStore(unauthenticated);

    authMode.value = 'forbidden';
    const forbidden = await post();
    expect(forbidden.status).toBe(403);
    expectNoStore(forbidden);
  });
});
