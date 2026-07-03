import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const { careCaseFindFirstMock, patientFindFirstMock, findExternalProfessionalSuggestionsMock } =
  vi.hoisted(() => ({
    careCaseFindFirstMock: vi.fn(),
    patientFindFirstMock: vi.fn(),
    findExternalProfessionalSuggestionsMock: vi.fn(),
  }));

const emptyRouteContext = { params: Promise.resolve({}) };
const authContext = {
  orgId: 'org_1',
  userId: 'user_1',
  role: 'pharmacist',
  ipAddress: '127.0.0.1',
  userAgent: 'vitest',
};
type WithAuthOptions = { permission?: string; message?: string };

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (
    handler: (
      req: NextRequest,
      ctx: typeof authContext,
      routeContext: typeof emptyRouteContext,
    ) => Promise<Response>,
    options?: WithAuthOptions,
  ) => {
    return (req: NextRequest, routeContext = emptyRouteContext) => {
      if (options?.permission === 'canSendCareReport' && authContext.role === 'clerk') {
        return Promise.resolve(
          new Response(JSON.stringify({ error: options.message ?? '権限がありません' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      return handler(req, authContext, routeContext);
    };
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    careCase: {
      findFirst: careCaseFindFirstMock,
    },
    patient: {
      findFirst: patientFindFirstMock,
    },
  },
}));

vi.mock('@/lib/contact-profiles', () => ({
  findExternalProfessionalSuggestions: findExternalProfessionalSuggestionsMock,
}));

import { GET } from './route';

function createRequest(search = '') {
  return new NextRequest(`http://localhost/api/external-professionals/suggestions${search}`);
}

describe('/api/external-professionals/suggestions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authContext.role = 'pharmacist';
    careCaseFindFirstMock.mockResolvedValue({ id: 'case_1' });
    patientFindFirstMock.mockResolvedValue({ id: 'patient_1' });
    findExternalProfessionalSuggestionsMock.mockResolvedValue([
      {
        id: 'external_1',
        name: '山田 ケアマネ',
        profession_type: 'care_manager',
        organization_name: '居宅支援A',
        department: null,
        phone: '03-1111-2222',
        email: null,
        fax: '03-1111-3333',
        preferred_contact_method: 'fax',
        preferred_contact_time: '平日 14:00-17:00',
        last_contacted_at: new Date('2026-03-30T00:00:00.000Z'),
        last_success_channel: 'fax',
        recommended_channels: ['fax', 'phone'],
        contact_reliability: {
          ready: true,
          warnings: [],
          missing_channel_labels: [],
        },
        is_primary: true,
      },
    ]);
  });

  it('returns external professional suggestions for patient/case context', async () => {
    const response = (await GET(
      createRequest('?patient_id=patient_1&case_id=case_1'),
      emptyRouteContext,
    ))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(careCaseFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'case_1',
        org_id: 'org_1',
        patient_id: 'patient_1',
      },
      select: { id: true },
    });
    expect(findExternalProfessionalSuggestionsMock).toHaveBeenCalledWith(
      expect.anything(),
      'org_1',
      {
        patientId: 'patient_1',
        caseId: 'case_1',
      },
    );
    await expect(response.json()).resolves.toMatchObject({
      data: [
        {
          id: 'external_1',
          last_contacted_at: '2026-03-30T00:00:00.000Z',
          recommended_channels: ['fax', 'phone'],
          contact_reliability: {
            ready: true,
            warnings: [],
            missing_channel_labels: [],
          },
        },
      ],
    });
  });

  it('rejects requests without patient or case context', async () => {
    const response = (await GET(createRequest(), emptyRouteContext))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
  });

  it('returns empty suggestions when the requested case is outside assignment scope', async () => {
    careCaseFindFirstMock.mockResolvedValue(null);

    const response = (await GET(
      createRequest('?patient_id=patient_1&case_id=case_other'),
      emptyRouteContext,
    ))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(findExternalProfessionalSuggestionsMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ data: [] });
  });

  it('requires care-report send permission because suggestions include delivery contacts', async () => {
    authContext.role = 'clerk';

    const response = (await GET(
      createRequest('?patient_id=patient_1&case_id=case_1'),
      emptyRouteContext,
    ))!;

    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(findExternalProfessionalSuggestionsMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: '他職種候補の閲覧権限がありません',
    });
  });

  it('returns a sanitized no-store 500 when suggestion loading fails', async () => {
    findExternalProfessionalSuggestionsMock.mockRejectedValue(
      new Error('raw professional phone 03-1111-2222 leaked failure'),
    );

    const response = (await GET(
      createRequest('?patient_id=patient_1&case_id=case_1'),
      emptyRouteContext,
    ))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(JSON.stringify(body)).not.toContain('03-1111-2222');
  });
});
