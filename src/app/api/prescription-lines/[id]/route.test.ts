import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  prescriptionLineFindFirstMock,
  prescriptionLineUpdateManyMock,
  auditLogCreateMock,
  withOrgContextMock,
  buildPrescriptionIntakeAssignmentWhereMock,
} = vi.hoisted(() => ({
  prescriptionLineFindFirstMock: vi.fn(),
  prescriptionLineUpdateManyMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  buildPrescriptionIntakeAssignmentWhereMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => unknown) => {
    return (req: NextRequest, routeContext: { params: Promise<{ id: string }> }) =>
      handler(req, { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' }, routeContext);
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {},
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/prescription-access', () => ({
  buildPrescriptionIntakeAssignmentWhere: buildPrescriptionIntakeAssignmentWhereMock,
}));

import { PATCH } from './route';

function createRequest(body?: unknown) {
  return new NextRequest('http://localhost/api/prescription-lines/line_1', {
    method: 'PATCH',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function createMalformedRequest() {
  return new NextRequest('http://localhost/api/prescription-lines/line_1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: '{"days":',
  });
}

describe('/api/prescription-lines/[id] PATCH', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildPrescriptionIntakeAssignmentWhereMock.mockReturnValue(null);
    const existingLine = {
      id: 'line_1',
      intake_id: 'intake_1',
      start_date: new Date('2026-06-01T00:00:00.000Z'),
      end_date: new Date('2026-06-07T00:00:00.000Z'),
      days: 7,
      frequency: '1日3回',
      dose: '1錠',
      quantity: 21,
      unit: '錠',
      updated_at: new Date('2026-06-16T00:00:00.000Z'),
      intake: { cycle_id: 'cycle_1' },
    };
    const updatedLine = {
      id: 'line_1',
      intake_id: 'intake_1',
      line_number: 1,
      drug_name: 'Drug A',
      drug_code: 'YJ001',
      dosage_form: '錠剤',
      dose: '2錠',
      frequency: '1日2回',
      days: 14,
      quantity: 28,
      unit: '錠',
      start_date: new Date('2026-06-02T00:00:00.000Z'),
      end_date: new Date('2026-06-15T00:00:00.000Z'),
      packaging_group_id: null,
      updated_at: new Date('2026-06-17T00:00:00.000Z'),
    };
    prescriptionLineFindFirstMock
      .mockResolvedValueOnce(existingLine)
      .mockResolvedValue(updatedLine);
    prescriptionLineUpdateManyMock.mockResolvedValue({ count: 1 });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        prescriptionLine: {
          findFirst: prescriptionLineFindFirstMock,
          updateMany: prescriptionLineUpdateManyMock,
        },
        auditLog: {
          create: auditLogCreateMock,
        },
      }),
    );
  });

  it('updates a prescription line and records an audit entry', async () => {
    const response = (await PATCH(
      createRequest({
        expected_updated_at: '2026-06-16T00:00:00.000Z',
        start_date: '2026-06-02',
        days: 14,
        frequency: '1日2回',
        dose: '2錠',
        quantity: 28,
      }),
      { params: Promise.resolve({ id: 'line_1' }) },
    ))!;

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: { id: 'line_1' } });

    expect(prescriptionLineUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'line_1',
        org_id: 'org_1',
        updated_at: new Date('2026-06-16T00:00:00.000Z'),
      },
      data: expect.objectContaining({
        start_date: new Date('2026-06-02T00:00:00.000Z'),
        days: 14,
        frequency: '1日2回',
        dose: '2錠',
        quantity: 28,
      }),
    });

    expect(auditLogCreateMock).toHaveBeenCalledTimes(1);
    const auditArg = auditLogCreateMock.mock.calls[0][0];
    expect(auditArg.data).toMatchObject({
      org_id: 'org_1',
      actor_id: 'user_1',
      action: 'prescription_line.update',
      target_type: 'PrescriptionLine',
      target_id: 'line_1',
    });
    expect(auditArg.data.changes.before).toMatchObject({ days: 7, frequency: '1日3回' });
    expect(auditArg.data.changes.after).toMatchObject({ days: 14, frequency: '1日2回' });
    expect(auditArg.data.changes.before.start_date).toBe('2026-06-01');
    expect(auditArg.data.changes.after.start_date).toBe('2026-06-02');
  });

  it('accepts nullable quantity/unit clearing', async () => {
    const response = (await PATCH(
      createRequest({
        expected_updated_at: '2026-06-16T00:00:00.000Z',
        quantity: null,
        unit: null,
      }),
      {
        params: Promise.resolve({ id: 'line_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    expect(prescriptionLineUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'line_1',
        org_id: 'org_1',
        updated_at: new Date('2026-06-16T00:00:00.000Z'),
      },
      data: expect.objectContaining({ quantity: null, unit: null }),
    });
  });

  it('rejects an empty update payload before transaction side effects', async () => {
    const response = (await PATCH(
      createRequest({ expected_updated_at: '2026-06-16T00:00:00.000Z' }),
      {
        params: Promise.resolve({ id: 'line_1' }),
      },
    ))!;

    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(prescriptionLineFindFirstMock).not.toHaveBeenCalled();
    expect(prescriptionLineUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid date format', async () => {
    const response = (await PATCH(
      createRequest({
        expected_updated_at: '2026-06-16T00:00:00.000Z',
        start_date: '2026/06/02',
      }),
      {
        params: Promise.resolve({ id: 'line_1' }),
      },
    ))!;

    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(prescriptionLineUpdateManyMock).not.toHaveBeenCalled();
  });

  it('rejects impossible calendar dates before transaction side effects', async () => {
    const response = (await PATCH(
      createRequest({
        expected_updated_at: '2026-06-16T00:00:00.000Z',
        start_date: '2026-02-30',
      }),
      {
        params: Promise.resolve({ id: 'line_1' }),
      },
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      details: { start_date: ['日付はYYYY-MM-DD形式です'] },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(prescriptionLineUpdateManyMock).not.toHaveBeenCalled();
  });

  it('rejects date ranges that become invalid against the current stored start date', async () => {
    const response = (await PATCH(
      createRequest({
        expected_updated_at: '2026-06-16T00:00:00.000Z',
        end_date: '2026-05-31',
      }),
      {
        params: Promise.resolve({ id: 'line_1' }),
      },
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      details: { end_date: ['終了日は開始日以降にしてください'] },
    });
    expect(prescriptionLineUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('returns 409 when expected_updated_at is stale before update side effects', async () => {
    const response = (await PATCH(
      createRequest({
        expected_updated_at: '2026-06-15T00:00:00.000Z',
        days: 10,
      }),
      {
        params: Promise.resolve({ id: 'line_1' }),
      },
    ))!;

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      details: { updated_at: '2026-06-16T00:00:00.000Z' },
    });
    expect(prescriptionLineUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('returns 409 when the line changes between read and atomic update', async () => {
    prescriptionLineUpdateManyMock.mockResolvedValue({ count: 0 });
    prescriptionLineFindFirstMock.mockReset();
    prescriptionLineFindFirstMock
      .mockResolvedValueOnce({
        id: 'line_1',
        intake_id: 'intake_1',
        start_date: new Date('2026-06-01T00:00:00.000Z'),
        end_date: new Date('2026-06-07T00:00:00.000Z'),
        days: 7,
        frequency: '1日3回',
        dose: '1錠',
        quantity: 21,
        unit: '錠',
        updated_at: new Date('2026-06-16T00:00:00.000Z'),
        intake: { cycle_id: 'cycle_1' },
      })
      .mockResolvedValueOnce({
        updated_at: new Date('2026-06-17T00:00:00.000Z'),
      });

    const response = (await PATCH(
      createRequest({
        expected_updated_at: '2026-06-16T00:00:00.000Z',
        days: 10,
      }),
      {
        params: Promise.resolve({ id: 'line_1' }),
      },
    ))!;

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      details: { updated_at: '2026-06-17T00:00:00.000Z' },
    });
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('re-applies assignment scope to the atomic update and post-update read', async () => {
    const assignmentWhere = { cycle: { case_: { primary_pharmacist_id: 'user_1' } } };
    buildPrescriptionIntakeAssignmentWhereMock.mockReturnValue(assignmentWhere);

    const response = (await PATCH(
      createRequest({
        expected_updated_at: '2026-06-16T00:00:00.000Z',
        days: 10,
      }),
      {
        params: Promise.resolve({ id: 'line_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    expect(prescriptionLineFindFirstMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({ intake: assignmentWhere }),
      }),
    );
    expect(prescriptionLineUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ intake: assignmentWhere }),
      }),
    );
    expect(prescriptionLineFindFirstMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({ intake: assignmentWhere }),
      }),
    );
  });

  it('rejects non-object payloads before transaction side effects', async () => {
    const response = (await PATCH(createRequest([]), {
      params: Promise.resolve({ id: 'line_1' }),
    }))!;

    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(prescriptionLineUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before transaction side effects', async () => {
    const response = (await PATCH(createMalformedRequest(), {
      params: Promise.resolve({ id: 'line_1' }),
    }))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(prescriptionLineUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('returns 404 for unassigned pharmacist line updates before side effects', async () => {
    prescriptionLineFindFirstMock.mockReset();
    prescriptionLineFindFirstMock.mockResolvedValue(null);

    const response = (await PATCH(
      createRequest({ expected_updated_at: '2026-06-16T00:00:00.000Z', days: 10 }),
      {
        params: Promise.resolve({ id: 'line_1' }),
      },
    ))!;

    expect(response.status).toBe(404);
    expect(prescriptionLineUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });
});
