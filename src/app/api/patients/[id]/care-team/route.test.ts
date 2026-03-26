import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  patientFindFirstMock,
  careCaseFindManyMock,
  careCaseFindFirstMock,
  withOrgContextMock,
  deleteManyMock,
  createManyMock,
  findManyMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  careCaseFindManyMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
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
    careCase: {
      findMany: careCaseFindManyMock,
      findFirst: careCaseFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET, PUT } from './route';

function createRequest(url: string, body?: unknown, headers?: Record<string, string>) {
  return {
    url,
    headers: {
      get: (key: string) => headers?.[key] ?? null,
    },
    json: async () => body,
  } as unknown as NextRequest;
}

describe('/api/patients/[id]/care-team', () => {
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
    careCaseFindManyMock.mockResolvedValue([
      {
        id: 'case_active',
        status: 'active',
        created_at: new Date('2026-03-01'),
        care_team_links: [{ id: 'link_1', role: 'physician', name: '佐藤医師' }],
      },
      {
        id: 'case_old',
        status: 'on_hold',
        created_at: new Date('2026-02-01'),
        care_team_links: [],
      },
    ]);
    careCaseFindFirstMock.mockResolvedValue({ id: 'case_active' });
    findManyMock.mockResolvedValue([{ id: 'link_1', role: 'physician', name: '佐藤医師' }]);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        careTeamLink: {
          deleteMany: deleteManyMock,
          createMany: createManyMock,
          findMany: findManyMock,
        },
      })
    );
  });

  it('returns the active case by default for care-team editing', async () => {
    const response = await GET(
      createRequest(
        'http://localhost/api/patients/patient_1/care-team',
        undefined,
        { 'x-org-id': 'corg1234567890123456789012' }
      ),
      { params: Promise.resolve({ id: 'patient_1' }) }
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      case_id: 'case_active',
      cases: [
        { id: 'case_active', status: 'active' },
        { id: 'case_old', status: 'on_hold' },
      ],
      data: [{ id: 'link_1', role: 'physician', name: '佐藤医師' }],
    });
  });

  it('replaces care-team links for the selected case', async () => {
    const response = await PUT(
      createRequest(
        'http://localhost/api/patients/patient_1/care-team',
        {
          case_id: 'case_active',
          links: [
            {
              role: 'nurse',
              name: '山田看護師',
              organization_name: '訪問看護ステーションA',
              department: '在宅部',
              phone: '03-2222-3333',
              email: 'nurse@example.com',
              fax: '03-3333-4444',
              address: '東京都千代田区7-8-9',
              is_primary: true,
              notes: '月水金に訪問',
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
      where: { org_id: 'corg1234567890123456789012', case_id: 'case_active' },
    });
    expect(createManyMock).toHaveBeenCalledWith({
      data: [
        {
          org_id: 'corg1234567890123456789012',
          case_id: 'case_active',
          role: 'nurse',
          name: '山田看護師',
          organization_name: '訪問看護ステーションA',
          department: '在宅部',
          phone: '03-2222-3333',
          email: 'nurse@example.com',
          fax: '03-3333-4444',
          address: '東京都千代田区7-8-9',
          is_primary: true,
          notes: '月水金に訪問',
        },
      ],
    });
  });
});
