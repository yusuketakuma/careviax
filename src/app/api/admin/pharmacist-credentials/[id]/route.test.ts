import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  pharmacistCredentialFindFirstMock,
  pharmacistCredentialUpdateMock,
  pharmacistCredentialDeleteMock,
  validateOrgReferencesMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  pharmacistCredentialFindFirstMock: vi.fn(),
  pharmacistCredentialUpdateMock: vi.fn(),
  pharmacistCredentialDeleteMock: vi.fn(),
  validateOrgReferencesMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    pharmacistCredential: {
      findFirst: pharmacistCredentialFindFirstMock,
      update: pharmacistCredentialUpdateMock,
      delete: pharmacistCredentialDeleteMock,
    },
  },
}));

vi.mock('@/lib/api/org-reference', () => ({
  validateOrgReferences: validateOrgReferencesMock,
}));

import { DELETE, PATCH } from './route';

describe('/api/admin/pharmacist-credentials/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'admin',
      },
    });
    validateOrgReferencesMock.mockResolvedValue({ ok: true });
    pharmacistCredentialFindFirstMock.mockResolvedValue({
      id: 'cred_1',
      org_id: 'org_1',
      user: {
        id: 'user_2',
        name: '鈴木 一郎',
      },
    });
    pharmacistCredentialUpdateMock.mockResolvedValue({
      id: 'cred_1',
      certification_type: '専門薬剤師',
      certification_number: 'A-123',
      issued_date: new Date('2025-04-01T00:00:00.000Z'),
      expiry_date: new Date('2027-04-01T00:00:00.000Z'),
      tenure_years: 8,
      weekly_work_hours: 32,
      user: {
        id: 'user_2',
        name: '鈴木 一郎',
      },
    });
    pharmacistCredentialDeleteMock.mockResolvedValue({ id: 'cred_1' });
  });

  it('updates a credential and validates pharmacist ownership', async () => {
    const response = await PATCH({
      json: async () => ({
        user_id: 'user_2',
        certification_type: '専門薬剤師',
        certification_number: 'A-123',
        issued_date: '2025-04-01',
        expiry_date: '2027-04-01',
        tenure_years: 8,
        weekly_work_hours: 32,
      }),
    } as NextRequest, {
      params: Promise.resolve({ id: 'cred_1' }),
    });

    expect(response.status).toBe(200);
    expect(validateOrgReferencesMock).toHaveBeenCalledWith('org_1', {
      pharmacist_id: 'user_2',
    });
    expect(pharmacistCredentialUpdateMock).toHaveBeenCalledWith({
      where: { id: 'cred_1' },
      data: expect.objectContaining({
        user_id: 'user_2',
        certification_type: '専門薬剤師',
        certification_number: 'A-123',
        issued_date: new Date('2025-04-01'),
        expiry_date: new Date('2027-04-01'),
        tenure_years: 8,
        weekly_work_hours: 32,
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

  it('deletes an existing credential', async () => {
    const response = await DELETE({} as NextRequest, {
      params: Promise.resolve({ id: 'cred_1' }),
    });

    expect(response.status).toBe(200);
    expect(pharmacistCredentialDeleteMock).toHaveBeenCalledWith({
      where: { id: 'cred_1' },
    });
  });
});
