import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  pharmacistCredentialFindManyMock,
  pharmacistCredentialCreateMock,
  visitScheduleFindManyMock,
  validateOrgReferencesMock,
  withOrgContextMock,
  auditLogCreateMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  pharmacistCredentialFindManyMock: vi.fn(),
  pharmacistCredentialCreateMock: vi.fn(),
  visitScheduleFindManyMock: vi.fn(),
  validateOrgReferencesMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: {
      findFirst: membershipFindFirstMock,
    },
    pharmacistCredential: {
      findMany: pharmacistCredentialFindManyMock,
      create: pharmacistCredentialCreateMock,
    },
    visitSchedule: {
      findMany: visitScheduleFindManyMock,
    },
  },
}));

vi.mock('@/lib/api/org-reference', () => ({
  validateOrgReferences: validateOrgReferencesMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET, POST } from './route';

function createRequest(headers?: Record<string, string>) {
  return {
    headers: {
      get: (key: string) => headers?.[key] ?? null,
    },
  } as unknown as NextRequest;
}

describe('/api/admin/pharmacist-credentials GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    validateOrgReferencesMock.mockResolvedValue({ ok: true });
    pharmacistCredentialCreateMock.mockResolvedValue({
      id: 'cred_2',
      certification_type: '研修認定',
      certification_number: 'N-100',
      issued_date: new Date('2025-04-01T00:00:00Z'),
      expiry_date: new Date('2027-03-31T00:00:00Z'),
      tenure_years: 3,
      weekly_work_hours: 28,
      user: {
        id: 'user_2',
        name: '鈴木 一郎',
      },
    });
    auditLogCreateMock.mockResolvedValue({ id: 'audit_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        pharmacistCredential: {
          create: pharmacistCredentialCreateMock,
        },
        auditLog: {
          create: auditLogCreateMock,
        },
      })
    );
  });

  it('returns 403 when the role lacks admin permission', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_FORBIDDEN',
    });
  });

  it('returns pharmacist credential rows for admins', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });
    pharmacistCredentialFindManyMock.mockResolvedValue([
      {
        id: 'cred_1',
        certification_type: 'かかりつけ薬剤師研修認定',
        certification_number: 'R-001',
        issued_date: new Date('2025-04-01T00:00:00Z'),
        expiry_date: new Date('2027-03-31T00:00:00Z'),
        tenure_years: 4.5,
        weekly_work_hours: 32,
        user: {
          id: 'user_2',
          name: '鈴木 一郎',
        },
      },
    ]);
    visitScheduleFindManyMock.mockResolvedValue([
      {
        pharmacist_id: 'user_2',
        case_: {
          patient: {
            id: 'patient_1',
            name: '田中 花子',
          },
        },
      },
    ]);

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [
        expect.objectContaining({
          id: 'cred_1',
          user_id: 'user_2',
          user_name: '鈴木 一郎',
          certification_number: 'R-001',
          consented_patients: [{ id: 'patient_1', name: '田中 花子' }],
        }),
      ],
    });
  });

  it('creates a pharmacist credential row for admins', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const response = await POST({
      headers: {
        get: (key: string) => (key === 'x-org-id' ? 'org_1' : null),
      },
      json: async () => ({
        user_id: 'user_2',
        certification_type: '研修認定',
        certification_number: 'N-100',
        issued_date: '2025-04-01',
        expiry_date: '2027-03-31',
        tenure_years: 3,
        weekly_work_hours: 28,
      }),
    } as unknown as NextRequest);

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(validateOrgReferencesMock).toHaveBeenCalledWith('org_1', {
      pharmacist_id: 'user_2',
    });
    expect(pharmacistCredentialCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        user_id: 'user_2',
        certification_type: '研修認定',
      }),
      include: {
        user: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
  });
});
