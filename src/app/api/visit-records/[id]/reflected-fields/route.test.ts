import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  canAccessVisitScheduleAssignmentMock,
  visitRecordFindFirstMock,
  listFieldRevisionsBySourceVisitRecordMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  canAccessVisitScheduleAssignmentMock: vi.fn(),
  visitRecordFindFirstMock: vi.fn(),
  listFieldRevisionsBySourceVisitRecordMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/auth/visit-schedule-access', () => ({
  canAccessVisitScheduleAssignment: canAccessVisitScheduleAssignmentMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    visitRecord: { findFirst: visitRecordFindFirstMock },
  },
}));

vi.mock('@/server/services/patient-field-revision-list', () => ({
  listFieldRevisionsBySourceVisitRecord: listFieldRevisionsBySourceVisitRecordMock,
}));

import { GET } from './route';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

function createRequest(url = 'http://localhost/api/visit-records/vr_1/reflected-fields') {
  return new NextRequest(url);
}

const authCtx = {
  ctx: {
    orgId: 'org_1',
    userId: 'user_1',
    role: 'pharmacist',
    ipAddress: '127.0.0.1',
    userAgent: 'test',
  },
};

const accessibleSchedule = {
  pharmacist_id: 'user_1',
  case_: {
    primary_pharmacist_id: 'user_1',
    backup_pharmacist_id: null,
  },
};

describe('/api/visit-records/[id]/reflected-fields', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue(authCtx);
    canAccessVisitScheduleAssignmentMock.mockReturnValue(true);
    listFieldRevisionsBySourceVisitRecordMock.mockResolvedValue([
      {
        id: 'rev_1',
        field_key: 'care_level',
        current: '2',
      },
    ]);
  });

  it('adds no-store headers to auth failures', async () => {
    requireAuthContextMock.mockResolvedValue({
      response: new Response(JSON.stringify({ code: 'AUTH_FORBIDDEN' }), { status: 403 }),
    });

    const response = await GET(createRequest(), { params: Promise.resolve({ id: 'vr_1' }) });

    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    expect(visitRecordFindFirstMock).not.toHaveBeenCalled();
  });

  it('rejects blank visit record ids before loading reflected fields', async () => {
    const response = await GET(createRequest(), { params: Promise.resolve({ id: '   ' }) });

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '訪問記録IDが不正です',
    });
    expect(visitRecordFindFirstMock).not.toHaveBeenCalled();
    expect(canAccessVisitScheduleAssignmentMock).not.toHaveBeenCalled();
    expect(listFieldRevisionsBySourceVisitRecordMock).not.toHaveBeenCalled();
  });

  it('returns 404 with no-store when the visit record is missing', async () => {
    visitRecordFindFirstMock.mockResolvedValue(null);

    const response = await GET(createRequest(), { params: Promise.resolve({ id: 'missing' }) });

    expect(response.status).toBe(404);
    expectSensitiveNoStore(response);
    expect(canAccessVisitScheduleAssignmentMock).not.toHaveBeenCalled();
    expect(listFieldRevisionsBySourceVisitRecordMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when reflected field lookup fails unexpectedly', async () => {
    visitRecordFindFirstMock.mockRejectedValueOnce(new Error('raw reflected field secret'));

    const response = await GET(createRequest(), { params: Promise.resolve({ id: 'vr_1' }) });

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const bodyText = await response.text();
    expect(bodyText).toContain('INTERNAL_ERROR');
    expect(bodyText).not.toContain('raw reflected field secret');
  });

  it('returns 403 before reading reflected fields when assignment access is denied', async () => {
    canAccessVisitScheduleAssignmentMock.mockReturnValue(false);
    visitRecordFindFirstMock.mockResolvedValue({
      id: 'vr_1',
      patient_id: 'patient_1',
      schedule: accessibleSchedule,
    });

    const response = await GET(createRequest(), { params: Promise.resolve({ id: 'vr_1' }) });

    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    expect(canAccessVisitScheduleAssignmentMock).toHaveBeenCalledWith(
      authCtx.ctx,
      accessibleSchedule,
    );
    expect(listFieldRevisionsBySourceVisitRecordMock).not.toHaveBeenCalled();
  });

  it('returns reflected fields with no-store headers after assignment access passes', async () => {
    visitRecordFindFirstMock.mockResolvedValue({
      id: 'vr_1',
      patient_id: 'patient_1',
      schedule: accessibleSchedule,
    });

    const response = await GET(createRequest(), { params: Promise.resolve({ id: 'vr_1' }) });

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(canAccessVisitScheduleAssignmentMock).toHaveBeenCalledWith(
      authCtx.ctx,
      accessibleSchedule,
    );
    expect(listFieldRevisionsBySourceVisitRecordMock).toHaveBeenCalledWith(expect.anything(), {
      orgId: 'org_1',
      patientId: 'patient_1',
      sourceVisitRecordId: 'vr_1',
    });
    await expect(response.json()).resolves.toMatchObject({
      data: [{ id: 'rev_1', field_key: 'care_level' }],
    });
  });
});
