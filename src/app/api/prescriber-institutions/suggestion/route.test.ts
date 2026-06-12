import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { findLatestPrescriberInstitutionSuggestionMock } = vi.hoisted(() => ({
  findLatestPrescriberInstitutionSuggestionMock: vi.fn(),
}));

const emptyRouteContext = { params: Promise.resolve({}) };

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (
    handler: (
      req: NextRequest,
      ctx: { orgId: string; userId: string; role: 'pharmacist' },
      routeContext: typeof emptyRouteContext,
    ) => Promise<Response>,
  ) => {
    return (req: NextRequest, routeContext = emptyRouteContext) =>
      handler(req, { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' }, routeContext);
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {},
}));

vi.mock('@/lib/prescriptions/prescriber-institutions', () => ({
  findLatestPrescriberInstitutionSuggestion: findLatestPrescriberInstitutionSuggestionMock,
}));

import { GET } from './route';

function createRequest(url: string) {
  return new NextRequest(url);
}

describe('/api/prescriber-institutions/suggestion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findLatestPrescriberInstitutionSuggestionMock.mockResolvedValue({
      id: 'institution_1',
      name: 'みなとクリニック',
      phone: '03-1111-2222',
      fax: '03-1111-3333',
      address: '東京都港区1-1-1',
      prescribed_date: new Date('2026-03-28T00:00:00.000Z'),
      prescriber_name: '田中 一郎',
    });
  });

  it('returns the latest prescriber institution suggestion for patient/case context', async () => {
    const response = (await GET(
      createRequest(
        'http://localhost/api/prescriber-institutions/suggestion?patient_id=patient_1&case_id=case_1',
      ),
      emptyRouteContext,
    ))!;

    expect(response.status).toBe(200);
    expect(findLatestPrescriberInstitutionSuggestionMock).toHaveBeenCalledWith(
      expect.anything(),
      'org_1',
      {
        patientId: 'patient_1',
        caseId: 'case_1',
      },
    );
    await expect(response.json()).resolves.toMatchObject({
      data: {
        id: 'institution_1',
        name: 'みなとクリニック',
        prescribed_date: '2026-03-28T00:00:00.000Z',
      },
    });
  });

  it('rejects requests without patient or case context', async () => {
    const response = (await GET(
      createRequest('http://localhost/api/prescriber-institutions/suggestion'),
      emptyRouteContext,
    ))!;

    expect(response.status).toBe(400);
  });
});
