import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const { authMock, membershipFindFirstMock, patientFindFirstMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: {
      findFirst: membershipFindFirstMock,
    },
    patient: {
      findFirst: patientFindFirstMock,
    },
  },
}));

import { GET } from './route';

function createRequest(headers?: Record<string, string>) {
  return {
    headers: {
      get: (key: string) => headers?.[key] ?? null,
    },
  } as unknown as NextRequest;
}

describe('/api/patients/[id] GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    patientFindFirstMock.mockResolvedValue({ id: 'patient_1', name: '患者A' });
  });

  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    expect(response).toBeDefined();
    if (!response) throw new Error('response is required');
    expect(response.status).toBe(401);
  });

  it('returns 403 when the role lacks permission', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'clerk' });

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    expect(response).toBeDefined();
    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_FORBIDDEN',
    });
  });

  it('returns 200 when the role has permission', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    expect(response).toBeDefined();
    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(patientFindFirstMock).toHaveBeenCalledOnce();
  });
});
