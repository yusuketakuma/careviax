import { NextRequest } from 'next/server';
import { vi, type Mock } from 'vitest';

export function createRequest(url: string, body?: unknown, headers?: Record<string, string>) {
  return new NextRequest(url, {
    method: body === undefined ? 'GET' : 'PUT',
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

export function createMalformedJsonPutRequest() {
  return new NextRequest('http://localhost/api/patients/patient_1/care-team', {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'corg1234567890123456789012',
    },
    body: '{"case_id":',
  });
}

export function buildDefaultCareCases() {
  return [
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
          is_primary: true,
          organization_name: '在宅医療クリニック',
          department: '内科',
          phone: '03-1111-2222',
          email: 'doctor@example.com',
          fax: '03-1111-3333',
          address: '東京都千代田区1-1',
          notes: '訪問前に薬局へ連絡',
        },
      ],
    },
    {
      id: 'case_old',
      status: 'on_hold',
      created_at: new Date('2026-02-01'),
      care_team_links: [],
    },
  ];
}

export function buildDefaultContactParties() {
  return [
    {
      is_primary: true,
      is_emergency_contact: true,
      phone: '090-1111-2222',
      email: null,
      fax: null,
    },
  ];
}

export function buildDefaultExternalProfessionals() {
  return [{ id: 'external_1', profession_type: 'nurse' }];
}

export function installCareTeamTransactionMock(
  withOrgContextMock: Mock,
  dependencies: {
    externalProfessionalFindManyMock: Mock;
    deleteManyMock: Mock;
    createManyMock: Mock;
    findManyMock: Mock;
  },
) {
  withOrgContextMock.mockImplementation(async (_orgId, callback) =>
    callback({
      externalProfessional: {
        findMany: dependencies.externalProfessionalFindManyMock,
      },
      careTeamLink: {
        deleteMany: dependencies.deleteManyMock,
        createMany: dependencies.createManyMock,
        findMany: dependencies.findManyMock,
      },
      auditLog: {
        create: vi.fn(),
      },
    }),
  );
}
