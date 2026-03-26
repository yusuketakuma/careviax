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
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { PUT } from './route';

function createRequest(body: unknown, headers?: Record<string, string>) {
  return {
    headers: {
      get: (key: string) => headers?.[key] ?? null,
    },
    json: async () => body,
  } as unknown as NextRequest;
}

describe('/api/patients/[id]/conditions PUT', () => {
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
    createManyMock.mockResolvedValue({ count: 2 });
    findManyMock.mockResolvedValue([{ id: 'condition_1', name: '高血圧' }]);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        patientCondition: {
          deleteMany: deleteManyMock,
          createMany: createManyMock,
          findMany: findManyMock,
        },
      })
    );
  });

  it('replaces patient conditions and normalizes dates', async () => {
    const response = await PUT(
      createRequest(
        {
          conditions: [
            {
              condition_type: 'disease',
              name: '高血圧',
              is_primary: true,
              is_active: true,
              noted_at: '2026-03-01',
              notes: '内服継続',
            },
          ],
        },
        { 'x-org-id': 'corg1234567890123456789012' }
      ),
      { params: Promise.resolve({ id: 'patient_1' }) }
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(deleteManyMock).toHaveBeenCalledWith({
      where: { org_id: 'corg1234567890123456789012', patient_id: 'patient_1' },
    });
    expect(createManyMock).toHaveBeenCalledWith({
      data: [
        {
          org_id: 'corg1234567890123456789012',
          patient_id: 'patient_1',
          condition_type: 'disease',
          name: '高血圧',
          is_primary: true,
          is_active: true,
          noted_at: new Date('2026-03-01'),
          notes: '内服継続',
        },
      ],
    });
  });
});
