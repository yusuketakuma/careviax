import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  canRequestSupervisedVisitHandoffConfirmationMock,
  selectVisitHandoffSupervisionAssigneeMock,
  visitRecordFindFirstMock,
  membershipFindFirstMock,
  requestHandoffConfirmationSupervisionMock,
  VisitHandoffAlreadyConfirmedErrorMock,
  VisitHandoffInvalidDataErrorMock,
  VisitHandoffMissingDataErrorMock,
  VisitHandoffStaleRecordErrorMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  canRequestSupervisedVisitHandoffConfirmationMock: vi.fn(),
  selectVisitHandoffSupervisionAssigneeMock: vi.fn(),
  visitRecordFindFirstMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  requestHandoffConfirmationSupervisionMock: vi.fn(),
  VisitHandoffAlreadyConfirmedErrorMock: class VisitHandoffAlreadyConfirmedError extends Error {},
  VisitHandoffInvalidDataErrorMock: class VisitHandoffInvalidDataError extends Error {},
  VisitHandoffMissingDataErrorMock: class VisitHandoffMissingDataError extends Error {},
  VisitHandoffStaleRecordErrorMock: class VisitHandoffStaleRecordError extends Error {},
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/auth/visit-schedule-access', () => ({
  canRequestSupervisedVisitHandoffConfirmation: canRequestSupervisedVisitHandoffConfirmationMock,
  selectVisitHandoffSupervisionAssignee: selectVisitHandoffSupervisionAssigneeMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    visitRecord: { findFirst: visitRecordFindFirstMock },
    membership: { findFirst: membershipFindFirstMock },
  },
}));

vi.mock('@/server/services/visit-handoff', () => ({
  requestHandoffConfirmationSupervision: requestHandoffConfirmationSupervisionMock,
  VisitHandoffAlreadyConfirmedError: VisitHandoffAlreadyConfirmedErrorMock,
  VisitHandoffInvalidDataError: VisitHandoffInvalidDataErrorMock,
  VisitHandoffMissingDataError: VisitHandoffMissingDataErrorMock,
  VisitHandoffStaleRecordError: VisitHandoffStaleRecordErrorMock,
}));

import { POST } from './route';
import { VisitHandoffStaleRecordError } from '@/server/services/visit-handoff';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const authCtx = {
  ctx: {
    orgId: 'org_1',
    userId: 'trainee_1',
    role: 'pharmacist_trainee',
    ipAddress: '127.0.0.1',
    userAgent: 'test',
  },
};

const schedule = {
  pharmacist_id: 'trainee_1',
  case_: {
    primary_pharmacist_id: 'supervisor_1',
    backup_pharmacist_id: null,
  },
};

function createRequest(body?: unknown) {
  return new NextRequest('http://localhost/api/visit-records/vr_1/handoff/supervision-request', {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
  });
}

describe('/api/visit-records/[id]/handoff/supervision-request', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue(authCtx);
    canRequestSupervisedVisitHandoffConfirmationMock.mockReturnValue(true);
    selectVisitHandoffSupervisionAssigneeMock.mockReturnValue('supervisor_1');
    visitRecordFindFirstMock.mockResolvedValue({
      id: 'vr_1',
      version: 2,
      schedule,
    });
    membershipFindFirstMock.mockResolvedValue({ user_id: 'supervisor_1' });
    requestHandoffConfirmationSupervisionMock.mockResolvedValue({
      status: 'requested',
      task_type: 'handoff_supervision_review',
      assigned_to: 'supervisor_1',
      visit_record_id: 'vr_1',
      visit_record_version: 2,
    });
  });

  it('creates a trainee supervision request without final confirmation', async () => {
    const res = await POST(
      createRequest({
        expected_visit_record_version: 2,
        request_note: ' 上長確認をお願いします ',
      }),
      { params: Promise.resolve({ id: 'vr_1' }) },
    );

    expect(res!.status).toBe(200);
    expectSensitiveNoStore(res!);
    await expect(res!.json()).resolves.toMatchObject({
      status: 'requested',
      task_type: 'handoff_supervision_review',
      assigned_to: 'supervisor_1',
      visit_record_id: 'vr_1',
      visit_record_version: 2,
    });
    expect(requestHandoffConfirmationSupervisionMock).toHaveBeenCalledWith(expect.anything(), {
      orgId: 'org_1',
      visitRecordId: 'vr_1',
      traineeUserId: 'trainee_1',
      supervisorUserId: 'supervisor_1',
      expectedVersion: 2,
      requestNote: '上長確認をお願いします',
      requestContext: authCtx.ctx,
    });
  });

  it('rejects unassigned trainees before writing tasks or audit logs', async () => {
    canRequestSupervisedVisitHandoffConfirmationMock.mockReturnValue(false);

    const res = await POST(createRequest({ expected_visit_record_version: 2 }), {
      params: Promise.resolve({ id: 'vr_1' }),
    });

    expect(res!.status).toBe(403);
    expectSensitiveNoStore(res!);
    expect(membershipFindFirstMock).not.toHaveBeenCalled();
    expect(requestHandoffConfirmationSupervisionMock).not.toHaveBeenCalled();
  });

  it('rejects inactive or non-pharmacist supervisors before writing side effects', async () => {
    membershipFindFirstMock.mockResolvedValue(null);

    const res = await POST(createRequest({ expected_visit_record_version: 2 }), {
      params: Promise.resolve({ id: 'vr_1' }),
    });

    expect(res!.status).toBe(403);
    expectSensitiveNoStore(res!);
    expect(requestHandoffConfirmationSupervisionMock).not.toHaveBeenCalled();
  });

  it('returns stale version conflicts before writing side effects', async () => {
    const res = await POST(createRequest({ expected_visit_record_version: 1 }), {
      params: Promise.resolve({ id: 'vr_1' }),
    });

    expect(res!.status).toBe(409);
    expectSensitiveNoStore(res!);
    expect(requestHandoffConfirmationSupervisionMock).not.toHaveBeenCalled();
  });

  it('maps service stale conflicts to no-store 409 responses', async () => {
    requestHandoffConfirmationSupervisionMock.mockRejectedValue(
      new VisitHandoffStaleRecordError('vr_1'),
    );

    const res = await POST(createRequest({ expected_visit_record_version: 2 }), {
      params: Promise.resolve({ id: 'vr_1' }),
    });

    expect(res!.status).toBe(409);
    expectSensitiveNoStore(res!);
  });
});
