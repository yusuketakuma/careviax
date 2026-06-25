import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

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

import { GET as rawGET, POST as rawPOST } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };
const GET = (req: NextRequest) => rawGET(req, emptyRouteContext);
const POST = (req: NextRequest) => rawPOST(req, emptyRouteContext);

function createRequest(headers?: Record<string, string>) {
  return createGetRequest('', headers);
}

function createGetRequest(search = '', headers?: Record<string, string>) {
  return new NextRequest(`http://localhost/api/admin/pharmacist-credentials${search}`, {
    headers,
  });
}

function createJsonRequest(body: unknown, headers?: Record<string, string>) {
  return new NextRequest('http://localhost/api/admin/pharmacist-credentials', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function createMalformedJsonRequest(headers?: Record<string, string>) {
  return new NextRequest('http://localhost/api/admin/pharmacist-credentials', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: '{bad json',
  });
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
      }),
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

    const response = await GET(createGetRequest('?limit=5', { 'x-org-id': 'org_1' }));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(pharmacistCredentialFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
      },
      select: {
        id: true,
        certification_type: true,
        certification_number: true,
        issued_date: true,
        expiry_date: true,
        tenure_years: true,
        weekly_work_hours: true,
        user: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: [{ expiry_date: 'asc' }, { created_at: 'desc' }],
      take: 5,
    });
    expect(visitScheduleFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        pharmacist_id: { in: ['user_2'] },
        schedule_status: { notIn: ['cancelled', 'rescheduled'] },
        case_: {
          patient: {
            consents: {
              some: {
                org_id: 'org_1',
                is_active: true,
                revoked_date: null,
              },
            },
          },
        },
      },
      select: {
        pharmacist_id: true,
        case_: {
          select: {
            patient: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });
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

  it.each([
    ['', 100],
    ['?limit=200', 200],
    ['?limit=9999', 200],
    ['?limit=0', 1],
    ['?limit=abc', 100],
  ])('bounds pharmacist credential list size for "%s"', async (search, expectedTake) => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });
    pharmacistCredentialFindManyMock.mockResolvedValue([]);

    const response = await GET(createGetRequest(search, { 'x-org-id': 'org_1' }));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(pharmacistCredentialFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
        },
        take: expectedTake,
      }),
    );
    expect(visitScheduleFindManyMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      data: [],
    });
  });

  it('rejects non-object create payloads before pharmacist reference validation', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const response = await POST(createJsonRequest([], { 'x-org-id': 'org_1' }));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(pharmacistCredentialCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON create payloads before pharmacist reference validation', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const response = await POST(createMalformedJsonRequest({ 'x-org-id': 'org_1' }));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(pharmacistCredentialCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('creates a pharmacist credential row for admins', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const response = await POST(
      createJsonRequest(
        {
          user_id: ' user_2 ',
          certification_type: ' 研修認定 ',
          certification_number: ' N-100 ',
          issued_date: ' 2025-04-01 ',
          expiry_date: ' 2027-03-31 ',
          tenure_years: ' 3 ',
          weekly_work_hours: ' 28 ',
        },
        { 'x-org-id': 'org_1' },
      ),
    );

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
        certification_number: 'N-100',
        issued_date: new Date('2025-04-01'),
        expiry_date: new Date('2027-03-31'),
        tenure_years: 3,
        weekly_work_hours: 28,
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

  it('normalizes blank optional create fields to null before insert', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const response = await POST(
      createJsonRequest(
        {
          user_id: 'user_2',
          certification_type: '研修認定',
          certification_number: ' ',
          issued_date: ' ',
          expiry_date: '',
          tenure_years: ' ',
          weekly_work_hours: '',
        },
        { 'x-org-id': 'org_1' },
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(pharmacistCredentialCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        certification_number: null,
        issued_date: null,
        expiry_date: null,
        tenure_years: null,
        weekly_work_hours: null,
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

  it('rejects non-plain numeric create fields before pharmacist reference validation', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const response = await POST(
      createJsonRequest(
        {
          user_id: 'user_2',
          certification_type: '研修認定',
          tenure_years: '1e1',
          weekly_work_hours: '32hours',
        },
        { 'x-org-id': 'org_1' },
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '入力値が不正です',
    });
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(pharmacistCredentialCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects reversed credential dates before pharmacist reference validation', async () => {
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const response = await POST(
      createJsonRequest(
        {
          user_id: 'user_2',
          certification_type: '研修認定',
          issued_date: '2027-03-31',
          expiry_date: '2025-04-01',
        },
        { 'x-org-id': 'org_1' },
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '入力値が不正です',
    });
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(pharmacistCredentialCreateMock).not.toHaveBeenCalled();
  });
});
