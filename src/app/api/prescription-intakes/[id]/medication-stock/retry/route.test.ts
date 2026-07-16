import { Prisma } from '@prisma/client';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  authMode,
  registeredAuthOptions,
  withOrgContextMock,
  findFirstMock,
  requireWritablePatientMock,
  applyPrescriptionSupplyForIntakeMock,
  createAuditLogEntryMock,
  buildPrescriptionIntakeAssignmentWhereMock,
} = vi.hoisted(() => ({
  authMode: { value: 'ok' as 'ok' | 'unauthenticated' | 'forbidden' },
  registeredAuthOptions: [] as unknown[],
  withOrgContextMock: vi.fn(),
  findFirstMock: vi.fn(),
  requireWritablePatientMock: vi.fn(),
  applyPrescriptionSupplyForIntakeMock: vi.fn(),
  createAuditLogEntryMock: vi.fn(),
  buildPrescriptionIntakeAssignmentWhereMock: vi.fn(),
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

vi.mock('@/lib/db/rls', () => ({ withOrgContext: withOrgContextMock }));
vi.mock('@/lib/audit/audit-entry', () => ({ createAuditLogEntry: createAuditLogEntryMock }));
vi.mock('@/server/services/patient-write-guard', () => ({
  requireWritablePatient: requireWritablePatientMock,
}));
vi.mock('@/server/services/prescription-access', () => ({
  buildPrescriptionIntakeAssignmentWhere: buildPrescriptionIntakeAssignmentWhereMock,
}));
vi.mock('@/modules/pharmacy/medication-stock/application/apply-prescription-supply', () => ({
  applyPrescriptionSupplyForIntake: applyPrescriptionSupplyForIntakeMock,
}));

import { POST } from './route';

const tx = {
  prescriptionIntake: { findFirst: findFirstMock },
  patient: {},
  auditLog: {},
};

function request(id = 'intake_1') {
  return new NextRequest(`http://localhost/api/prescription-intakes/${id}/medication-stock/retry`, {
    method: 'POST',
  });
}

function post(id = 'intake_1') {
  return POST(request(id), { params: Promise.resolve({ id }) });
}

function expectNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('POST /api/prescription-intakes/[id]/medication-stock/retry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMode.value = 'ok';
    buildPrescriptionIntakeAssignmentWhereMock.mockReturnValue({
      cycle: { case_: { assigned_pharmacist_id: 'user_1' } },
    });
    findFirstMock.mockResolvedValue({ id: 'intake_1', cycle: { patient_id: 'patient_1' } });
    requireWritablePatientMock.mockResolvedValue({
      patient: { id: 'patient_1', archived_at: null },
    });
    applyPrescriptionSupplyForIntakeMock.mockResolvedValue({
      intake_id: 'intake_1',
      applied_count: 1,
      review_required_count: 1,
      skipped_count: 1,
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
          idempotent_replay: true,
        },
        {
          kind: 'review_required',
          prescription_line_id: 'line_2',
          reason_code: 'unsupported_unit',
          task_id: 'task_1',
          candidate_count: 0,
        },
        {
          kind: 'skipped',
          prescription_line_id: 'line_3',
          reason_code: 'non_stock_relevant_line',
        },
      ],
    });
    createAuditLogEntryMock.mockResolvedValue({ id: 'audit_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) => callback(tx));
  });

  it('retries exact-only stock application in one scoped audited transaction', async () => {
    const response = await post();

    expect(response.status).toBe(200);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        intake_id: 'intake_1',
        applied_count: 1,
        review_required_count: 1,
        skipped_count: 1,
      },
    });
    expect(registeredAuthOptions).toContainEqual({
      permission: 'canDispense',
      message: '処方供給の残数台帳反映を再試行する権限がありません',
    });
    expect(findFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'intake_1',
        org_id: 'org_1',
        AND: [{ cycle: { case_: { assigned_pharmacist_id: 'user_1' } } }],
      },
      select: { id: true, cycle: { select: { patient_id: true } } },
    });
    expect(requireWritablePatientMock).toHaveBeenCalledWith(tx, expect.anything(), 'patient_1');
    expect(applyPrescriptionSupplyForIntakeMock).toHaveBeenCalledWith(tx, {
      orgId: 'org_1',
      userId: 'user_1',
      intakeId: 'intake_1',
      patientId: 'patient_1',
    });
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(tx, expect.anything(), {
      action: 'medication_stock.prescription_supply_retry',
      targetType: 'PrescriptionIntake',
      targetId: 'intake_1',
      patientId: 'patient_1',
      changes: {
        applied_count: 1,
        review_required_count: 1,
        skipped_count: 1,
        idempotent_replay_count: 1,
        result_counts: { applied: 1, review_required: 1, skipped: 1 },
      },
    });
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' },
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeoutMs: 10_000,
    });
  });

  it('returns a neutral 404 without applying or auditing an inaccessible intake', async () => {
    findFirstMock.mockResolvedValueOnce(null);

    const response = await post();

    expect(response.status).toBe(404);
    expectNoStore(response);
    expect(applyPrescriptionSupplyForIntakeMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('preserves the writable-patient conflict without stock or audit side effects', async () => {
    requireWritablePatientMock.mockResolvedValueOnce({
      response: new Response(JSON.stringify({ code: 'WORKFLOW_CONFLICT' }), { status: 409 }),
    });

    const response = await post();

    expect(response.status).toBe(409);
    expectNoStore(response);
    expect(applyPrescriptionSupplyForIntakeMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid ID before opening the org transaction', async () => {
    const response = await post(' ');

    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
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
