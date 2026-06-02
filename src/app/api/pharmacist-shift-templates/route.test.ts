import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  pharmacistShiftTemplateFindManyMock,
  pharmacistShiftTemplateUpsertMock,
  validateOrgReferencesMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  pharmacistShiftTemplateFindManyMock: vi.fn(),
  pharmacistShiftTemplateUpsertMock: vi.fn(),
  validateOrgReferencesMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    pharmacistShiftTemplate: {
      findMany: pharmacistShiftTemplateFindManyMock,
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

function createRequest(url: string, body?: unknown) {
  return new NextRequest(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('/api/pharmacist-shift-templates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'admin',
      },
    });
    pharmacistShiftTemplateFindManyMock.mockResolvedValue([]);
    pharmacistShiftTemplateUpsertMock.mockResolvedValue({ id: 'template_1' });
    validateOrgReferencesMock.mockResolvedValue({ ok: true });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        pharmacistShiftTemplate: {
          upsert: pharmacistShiftTemplateUpsertMock,
        },
      }),
    );
  });

  it('lists shift templates filtered by pharmacist', async () => {
    const response = (await GET(
      createRequest('http://localhost/api/pharmacist-shift-templates?user_id=user_2'),
    ))!;

    expect(response.status).toBe(200);
    expect(pharmacistShiftTemplateFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        user_id: 'user_2',
      },
      orderBy: [{ user_id: 'asc' }, { weekday: 'asc' }],
      include: {
        site: { select: { id: true, name: true } },
        user: { select: { id: true, name: true } },
      },
    });
  });

  it('rejects non-object template payloads before reference checks or upsert', async () => {
    const response = (await POST(
      createRequest('http://localhost/api/pharmacist-shift-templates', []),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(pharmacistShiftTemplateUpsertMock).not.toHaveBeenCalled();
  });

  it('upserts a shift template', async () => {
    const response = (await POST(
      createRequest('http://localhost/api/pharmacist-shift-templates', {
        user_id: ' user_2 ',
        site_id: ' site_1 ',
        weekday: 1,
        available: true,
        available_from: ' 09:00 ',
        available_to: ' 18:00 ',
        note: ' ',
      }),
    ))!;

    expect(response.status).toBe(201);
    expect(validateOrgReferencesMock).toHaveBeenCalledWith('org_1', {
      site_id: 'site_1',
      pharmacist_id: 'user_2',
    });
    expect(pharmacistShiftTemplateUpsertMock).toHaveBeenCalledWith({
      where: {
        user_id_weekday: {
          user_id: 'user_2',
          weekday: 1,
        },
      },
      create: {
        org_id: 'org_1',
        user_id: 'user_2',
        site_id: 'site_1',
        weekday: 1,
        available: true,
        available_from: new Date('1970-01-01T09:00'),
        available_to: new Date('1970-01-01T18:00'),
        note: null,
      },
      update: {
        site_id: 'site_1',
        available: true,
        available_from: new Date('1970-01-01T09:00'),
        available_to: new Date('1970-01-01T18:00'),
        note: null,
      },
    });
  });

  it('rejects blank ids and malformed template times before reference checks', async () => {
    const response = (await POST(
      createRequest('http://localhost/api/pharmacist-shift-templates', {
        user_id: '   ',
        site_id: 'site_1',
        weekday: 1,
        available_from: '24:00',
      }),
    ))!;

    expect(response.status).toBe(400);
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(pharmacistShiftTemplateUpsertMock).not.toHaveBeenCalled();
  });
});
