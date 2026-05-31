import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  patientFindFirstMock,
  patientFindManyMock,
  careCaseFindFirstMock,
  careCaseFindManyMock,
  medicationIssueFindFirstMock,
  medicationIssueUpdateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  patientFindManyMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  careCaseFindManyMock: vi.fn(),
  medicationIssueFindFirstMock: vi.fn(),
  medicationIssueUpdateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    patient: {
      findFirst: patientFindFirstMock,
      findMany: patientFindManyMock,
    },
    careCase: {
      findFirst: careCaseFindFirstMock,
      findMany: careCaseFindManyMock,
    },
    medicationIssue: {
      findFirst: medicationIssueFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { PATCH } from './route';

function createPatchRequest(body: unknown) {
  return new NextRequest('http://localhost/api/medication-issues/issue_1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/medication-issues/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      },
    });
    patientFindFirstMock.mockResolvedValue({ id: 'patient_1' });
    patientFindManyMock.mockResolvedValue([{ id: 'patient_1' }]);
    careCaseFindFirstMock.mockResolvedValue({ id: 'case_1', patient_id: 'patient_1' });
    careCaseFindManyMock.mockResolvedValue([{ id: 'case_1' }]);
    medicationIssueFindFirstMock.mockResolvedValue({
      id: 'issue_1',
      status: 'open',
      patient_id: 'patient_1',
      case_id: 'case_1',
    });
    medicationIssueUpdateMock.mockResolvedValue({
      id: 'issue_1',
      status: 'resolved',
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        medicationIssue: {
          update: medicationIssueUpdateMock,
        },
      }),
    );
  });

  it('sets resolver metadata when an issue is resolved', async () => {
    const response = (await PATCH(
      createPatchRequest({
        status: 'resolved',
      }),
      {
        params: Promise.resolve({ id: 'issue_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    expect(medicationIssueFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'issue_1',
        org_id: 'org_1',
        AND: [
          {
            OR: expect.arrayContaining([
              { case_id: { in: ['case_1'] } },
              { AND: [{ case_id: null }, { patient_id: { in: ['patient_1'] } }] },
            ]),
          },
        ],
      },
      select: { id: true, status: true, patient_id: true, case_id: true },
    });
    expect(medicationIssueUpdateMock).toHaveBeenCalledWith({
      where: { id: 'issue_1' },
      data: expect.objectContaining({
        status: 'resolved',
        resolved_by: 'user_1',
        resolved_at: expect.any(Date),
      }),
    });
  });

  it('clears resolver metadata when an issue is reopened', async () => {
    medicationIssueFindFirstMock.mockResolvedValue({
      id: 'issue_1',
      status: 'resolved',
      patient_id: 'patient_1',
      case_id: 'case_1',
    });

    const response = (await PATCH(
      createPatchRequest({
        status: 'in_progress',
      }),
      {
        params: Promise.resolve({ id: 'issue_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    expect(medicationIssueUpdateMock).toHaveBeenCalledWith({
      where: { id: 'issue_1' },
      data: expect.objectContaining({
        status: 'in_progress',
        resolved_by: null,
        resolved_at: null,
      }),
    });
  });

  it('returns 404 before updating an inaccessible medication issue', async () => {
    medicationIssueFindFirstMock.mockResolvedValue(null);

    const response = (await PATCH(
      createPatchRequest({
        status: 'resolved',
      }),
      {
        params: Promise.resolve({ id: 'issue_2' }),
      },
    ))!;

    expect(response.status).toBe(404);
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(medicationIssueUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects a stored patient and case mismatch before updating', async () => {
    medicationIssueFindFirstMock.mockResolvedValue({
      id: 'issue_1',
      status: 'open',
      patient_id: 'patient_1',
      case_id: 'case_2',
    });
    careCaseFindFirstMock.mockResolvedValue({ id: 'case_2', patient_id: 'patient_other' });

    const response = (await PATCH(
      createPatchRequest({
        status: 'resolved',
      }),
      {
        params: Promise.resolve({ id: 'issue_1' }),
      },
    ))!;

    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(medicationIssueUpdateMock).not.toHaveBeenCalled();
  });
});
