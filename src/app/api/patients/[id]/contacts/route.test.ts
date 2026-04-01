import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  patientFindFirstMock,
  withOrgContextMock,
  deleteManyMock,
  createManyMock,
  findManyMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  deleteManyMock: vi.fn(),
  createManyMock: vi.fn(),
  findManyMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    patient: {
      findFirst: patientFindFirstMock,
    },
    contactParty: {
      findMany: findManyMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET, PUT } from './route';

function createRequest(body: unknown, headers?: Record<string, string>) {
  return {
    headers: {
      get: (key: string) => headers?.[key] ?? null,
    },
    json: async () => body,
  } as unknown as NextRequest;
}

describe('/api/patients/[id]/contacts PUT', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'corg1234567890123456789012',
        userId: 'user_1',
        role: 'pharmacist',
      },
    });
    patientFindFirstMock.mockResolvedValue({ id: 'patient_1' });
    createManyMock.mockResolvedValue({ count: 1 });
    findManyMock.mockResolvedValue([{ id: 'contact_1', name: '田中花子' }]);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        contactParty: {
          deleteMany: deleteManyMock,
          createMany: createManyMock,
          findMany: findManyMock,
        },
      })
    );
  });

  it('replaces patient contacts with expanded fields', async () => {
    const response = await PUT(
      createRequest(
        {
          contacts: [
            {
              relation: 'care_manager',
              name: '田中花子',
              phone: '03-1234-5678',
              email: 'care@example.com',
              fax: '03-9999-9999',
              organization_name: '居宅支援事業所',
              department: '在宅支援課',
              address: '東京都千代田区4-5-6',
              is_primary: true,
              is_emergency_contact: false,
              notes: '平日日中に連絡',
            },
          ],
        },
        { 'x-org-id': 'corg1234567890123456789012' }
      ),
      { params: Promise.resolve({ id: 'patient_1' }) }
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(createManyMock).toHaveBeenCalledWith({
      data: [
        {
          org_id: 'corg1234567890123456789012',
          patient_id: 'patient_1',
          name: '田中花子',
          relation: 'care_manager',
          phone: '03-1234-5678',
          email: 'care@example.com',
          fax: '03-9999-9999',
          organization_name: '居宅支援事業所',
          department: '在宅支援課',
          address: '東京都千代田区4-5-6',
          is_primary: true,
          is_emergency_contact: false,
          notes: '平日日中に連絡',
        },
      ],
    });
  });

  it('masks contact channels and address for external viewers on read', async () => {
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'corg1234567890123456789012',
        userId: 'user_ext',
        role: 'external_viewer',
      },
    });
    findManyMock.mockResolvedValue([
      {
        id: 'contact_1',
        name: '田中花子',
        phone: '03-1234-5678',
        fax: '03-9999-9999',
        email: 'care@example.com',
        address: '東京都千代田区4-5-6',
      },
    ]);
    vi.mocked(patientFindFirstMock).mockResolvedValue({ id: 'patient_1' });

    const response = await GET(
      createRequest(undefined, { 'x-org-id': 'corg1234567890123456789012' }),
      { params: Promise.resolve({ id: 'patient_1' }) }
    );

    if (!response) throw new Error('response is required');
    await expect(response.json()).resolves.toMatchObject({
      data: [
        {
          id: 'contact_1',
          phone: '***-****-5678',
          fax: '***-****-9999',
          email: 'c***@example.com',
          address: '東京都千代田***',
        },
      ],
    });
  });
});
