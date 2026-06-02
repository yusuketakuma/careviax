import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

type AuthenticatedTestRequest = NextRequest & {
  orgId: string;
  userId: string;
  ipAddress?: string;
  userAgent?: string;
};

const {
  businessHolidayFindManyMock,
  businessHolidayFindFirstMock,
  businessHolidayCreateMock,
  auditLogCreateMock,
  validateOrgReferencesMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  businessHolidayFindManyMock: vi.fn(),
  businessHolidayFindFirstMock: vi.fn(),
  businessHolidayCreateMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
  validateOrgReferencesMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (handler: (req: AuthenticatedTestRequest) => Promise<Response>) => {
    return (req: NextRequest) =>
      handler(
        Object.assign(req, {
          orgId: 'org_1',
          userId: 'user_1',
          ipAddress: '127.0.0.1',
          userAgent: 'vitest',
        }) as AuthenticatedTestRequest,
      );
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    businessHoliday: {
      findMany: businessHolidayFindManyMock,
      findFirst: businessHolidayFindFirstMock,
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

type NextRequestInit = ConstructorParameters<typeof NextRequest>[1];

function createGetRequest(search = '') {
  return new NextRequest(`http://localhost/api/business-holidays${search}`);
}

function createPostRequest(body: unknown) {
  return new NextRequest('http://localhost/api/business-holidays', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  } satisfies NextRequestInit);
}

function createMalformedJsonPostRequest() {
  return new NextRequest('http://localhost/api/business-holidays', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{bad json',
  } satisfies NextRequestInit);
}

describe('/api/business-holidays', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    businessHolidayFindManyMock.mockResolvedValue([{ id: 'holiday_1', name: '祝日' }]);
    businessHolidayFindFirstMock.mockResolvedValue(null);
    validateOrgReferencesMock.mockResolvedValue({ ok: true });
    businessHolidayCreateMock.mockResolvedValue({ id: 'holiday_2', name: '臨時休業' });
    auditLogCreateMock.mockResolvedValue({ id: 'audit_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        businessHoliday: {
          create: businessHolidayCreateMock,
        },
        auditLog: {
          create: auditLogCreateMock,
        },
      }),
    );
  });

  it('lists business holidays', async () => {
    const response = (await GET(createGetRequest('?site_id=site_1')))!;

    expect(response.status).toBe(200);
  });

  it('creates a business holiday and records an audit log', async () => {
    const response = (await POST(
      createPostRequest({
        date: '2026-03-30',
        name: '臨時休業',
        holiday_type: 'site_closure',
        is_closed: true,
      }),
    ))!;

    expect(response.status).toBe(201);
    expect(businessHolidayCreateMock).toHaveBeenCalled();
    expect(auditLogCreateMock).toHaveBeenCalled();
  });

  it('rejects non-object create payloads before reference validation or duplicate lookup', async () => {
    const response = (await POST(createPostRequest([])))!;

    expect(response.status).toBe(400);
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(businessHolidayFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(businessHolidayCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON create payloads before reference validation or duplicate lookup', async () => {
    const response = (await POST(createMalformedJsonPostRequest()))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(businessHolidayFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(businessHolidayCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });
});
