import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  patientFindFirstMock,
  careCaseFindManyMock,
  careCaseFindFirstMock,
  withOrgContextMock,
  deleteManyMock,
  createManyMock,
  findManyMock,
  externalProfessionalFindManyMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  careCaseFindManyMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  deleteManyMock: vi.fn(),
  createManyMock: vi.fn(),
  findManyMock: vi.fn(),
  externalProfessionalFindManyMock: vi.fn(),
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
  return new NextRequest(url, {
    method: body === undefined ? 'GET' : 'PUT',
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
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
        care_team_links: [
          {
            id: 'link_1',
            external_professional_id: 'external_1',
            role: 'physician',
            name: '佐藤医師',
          },
        ],
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
    externalProfessionalFindManyMock.mockResolvedValue([{ id: 'external_1' }]);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        externalProfessional: {
          findMany: externalProfessionalFindManyMock,
        },
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
        { 'x-org-id': 'corg1234567890123456789012' },
      ),
      { params: Promise.resolve({ id: 'patient_1' }) },
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
              external_professional_id: 'external_1',
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
        { 'x-org-id': 'corg1234567890123456789012' },
      ),
      { params: Promise.resolve({ id: 'patient_1' }) },
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
          external_professional_id: 'external_1',
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
    expect(externalProfessionalFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'corg1234567890123456789012',
        id: { in: ['external_1'] },
      },
      select: { id: true },
    });
  });

  it('rejects external professionals outside the current org', async () => {
    externalProfessionalFindManyMock.mockResolvedValue([]);

    const response = await PUT(
      createRequest(
        'http://localhost/api/patients/patient_1/care-team',
        {
          case_id: 'case_active',
          links: [
            {
              external_professional_id: 'external_other_org',
              role: 'physician',
              name: '他院医師',
              is_primary: true,
            },
          ],
        },
        { 'x-org-id': 'corg1234567890123456789012' }
      ),
      { params: Promise.resolve({ id: 'patient_1' }) }
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(createManyMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      message: '他組織の他職種はケアチームに登録できません',
    });
  });

  it('GET returns 404 when patient is not assigned to the requesting user', async () => {
    patientFindFirstMock.mockResolvedValue(null);

    const response = await GET(
      createRequest(
        'http://localhost/api/patients/patient_unknown/care-team',
        undefined,
        { 'x-org-id': 'corg1234567890123456789012' },
      ),
      { params: Promise.resolve({ id: 'patient_unknown' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
  });

  it('PUT returns 404 when the requested case_id does not belong to an assigned case', async () => {
    careCaseFindFirstMock.mockResolvedValue(null);

    const response = await PUT(
      createRequest(
        'http://localhost/api/patients/patient_1/care-team',
        {
          case_id: 'case_unassigned',
          links: [],
        },
        { 'x-org-id': 'corg1234567890123456789012' },
      ),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(createManyMock).not.toHaveBeenCalled();
  });
});
