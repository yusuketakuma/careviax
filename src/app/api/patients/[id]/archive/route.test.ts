import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { requireAuthContextMock, patientFindFirstMock, patientUpdateMock, withOrgContextMock } =
  vi.hoisted(() => ({
    requireAuthContextMock: vi.fn(),
    patientFindFirstMock: vi.fn(),
    patientUpdateMock: vi.fn(),
    withOrgContextMock: vi.fn(),
  }));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    patient: {
      findFirst: patientFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { PATCH } from './route';

function createRequest() {
  return new NextRequest('http://localhost/api/patients/patient_1/archive', {
    method: 'PATCH',
    headers: {
      'x-org-id': 'org_1',
    },
  });
}

describe('/api/patients/[id]/archive PATCH', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: { orgId: 'org_1', userId: 'user_1', role: 'admin' },
    });
    patientFindFirstMock.mockResolvedValue({ id: 'patient_1', archived_at: null });
    patientUpdateMock.mockResolvedValue({
      id: 'patient_1',
      archived_at: new Date('2026-04-01T00:00:00.000Z'),
      archived_by: 'user_1',
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        patient: {
          update: patientUpdateMock,
        },
      }),
    );
  });

  it('rejects blank patient ids before loading or archiving the patient', async () => {
    const response = await PATCH(createRequest(), {
      params: Promise.resolve({ id: '   ' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '患者IDが不正です',
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientUpdateMock).not.toHaveBeenCalled();
  });

  it('archives an active patient under org context', async () => {
    const response = await PATCH(createRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(patientFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'patient_1', org_id: 'org_1' },
      select: { id: true, archived_at: true },
    });
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
    });
    expect(patientUpdateMock).toHaveBeenCalledWith({
      where: { id: 'patient_1' },
      data: {
        archived_at: expect.any(Date),
        archived_by: 'user_1',
      },
      select: { id: true, archived_at: true, archived_by: true },
    });
    const body = await response.json();
    expect(body).toMatchObject({
      data: {
        id: 'patient_1',
        archived_by: 'user_1',
      },
    });
    expect(body.data.archived_at).toBe('2026-04-01T00:00:00.000Z');
    expect(body).not.toHaveProperty('id');
    expect(body).not.toHaveProperty('archived_at');
    expect(body).not.toHaveProperty('archived_by');
  });
});
