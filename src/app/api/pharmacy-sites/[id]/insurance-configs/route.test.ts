import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  pharmacySiteFindFirstMock,
  insuranceConfigFindManyMock,
  insuranceConfigFindFirstMock,
  insuranceConfigUpdateManyMock,
  insuranceConfigCreateMock,
  auditLogCreateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  pharmacySiteFindFirstMock: vi.fn(),
  insuranceConfigFindManyMock: vi.fn(),
  insuranceConfigFindFirstMock: vi.fn(),
  insuranceConfigUpdateManyMock: vi.fn(),
  insuranceConfigCreateMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    pharmacySite: {
      findFirst: pharmacySiteFindFirstMock,
    },
    pharmacySiteInsuranceConfig: {
      findMany: insuranceConfigFindManyMock,
      findFirst: insuranceConfigFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET, POST } from './route';

function createGetRequest() {
  return new NextRequest('http://localhost/api/pharmacy-sites/site_1/insurance-configs');
}

function createPostRequest(body: unknown) {
  return new NextRequest('http://localhost/api/pharmacy-sites/site_1/insurance-configs', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('/api/pharmacy-sites/[id]/insurance-configs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        ipAddress: '127.0.0.1',
        userAgent: 'vitest',
      },
    });
    pharmacySiteFindFirstMock.mockResolvedValue({ id: 'site_1' });
    insuranceConfigFindManyMock.mockResolvedValue([]);
    insuranceConfigFindFirstMock.mockResolvedValue(null);
    insuranceConfigCreateMock.mockResolvedValue({
      id: 'config_2',
      insurance_type: 'care',
      revision_code: '2024',
      revision_label: '令和6年度',
      effective_from: new Date('2024-04-01T00:00:00.000Z'),
      effective_to: null,
      config: {},
    });
    insuranceConfigUpdateManyMock.mockResolvedValue({ count: 0 });
    auditLogCreateMock.mockResolvedValue({ id: 'audit_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        pharmacySiteInsuranceConfig: {
          updateMany: insuranceConfigUpdateManyMock,
          create: insuranceConfigCreateMock,
        },
        auditLog: {
          create: auditLogCreateMock,
        },
      }),
    );
  });

  it('lists insurance configs', async () => {
    insuranceConfigFindManyMock.mockResolvedValue([
      {
        id: 'config_1',
        insurance_type: 'medical',
        revision_code: '2024',
      },
    ]);
    const response = (await GET(createGetRequest(), {
      params: Promise.resolve({ id: 'site_1' }),
    }))!;

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [{ id: 'config_1', insurance_type: 'medical' }],
    });
  });

  it('creates an insurance config with wrapped data', async () => {
    const response = (await POST(
      createPostRequest({
        insurance_type: 'care',
        revision_code: '2024',
        revision_label: '令和6年度',
        effective_from: '2024-04-01',
        effective_to: null,
        config: {},
      }),
      {
        params: Promise.resolve({ id: 'site_1' }),
      },
    ))!;

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        id: 'config_2',
        insurance_type: 'care',
        revision_code: '2024',
      },
    });
    expect(insuranceConfigCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        site_id: 'site_1',
        insurance_type: 'care',
        revision_code: '2024',
        revision_label: '令和6年度',
        effective_from: new Date('2024-04-01'),
        effective_to: null,
        config: {},
      }),
    });
  });

  it('returns 400 when the effective range is invalid', async () => {
    const response = (await POST(
      createPostRequest({
        insurance_type: 'care',
        revision_code: '2024',
        effective_from: '2024-05-01',
        effective_to: '2024-04-01',
        config: {},
      }),
      {
        params: Promise.resolve({ id: 'site_1' }),
      },
    ))!;

    expect(response.status).toBe(400);
    expect(insuranceConfigCreateMock).not.toHaveBeenCalled();
  });

  it('returns 400 when the effective range overlaps an existing config', async () => {
    insuranceConfigFindManyMock.mockResolvedValue([
      {
        id: 'config_existing',
        effective_from: new Date('2024-04-01T00:00:00.000Z'),
        effective_to: new Date('2024-07-01T00:00:00.000Z'),
      },
    ]);

    const response = (await POST(
      createPostRequest({
        insurance_type: 'medical',
        revision_code: '2026',
        effective_from: '2024-06-01',
        effective_to: '2024-08-01',
        config: {},
      }),
      {
        params: Promise.resolve({ id: 'site_1' }),
      },
    ))!;

    expect(response.status).toBe(400);
    expect(insuranceConfigCreateMock).not.toHaveBeenCalled();
  });

  it('rejects unsupported care revisions', async () => {
    const response = (await POST(
      createPostRequest({
        insurance_type: 'care',
        revision_code: '2026',
        effective_from: '2026-06-01',
        effective_to: null,
        config: {},
      }),
      {
        params: Promise.resolve({ id: 'site_1' }),
      },
    ))!;

    expect(response.status).toBe(400);
    expect(insuranceConfigCreateMock).not.toHaveBeenCalled();
  });

  it('auto-closes overlapping prior revisions when explicitly requested', async () => {
    insuranceConfigFindManyMock.mockResolvedValue([
      {
        id: 'config_2024',
        effective_from: new Date('2024-06-01T00:00:00.000Z'),
        effective_to: null,
      },
    ]);

    const response = (await POST(
      createPostRequest({
        insurance_type: 'medical',
        revision_code: '2026',
        revision_label: '令和8年度改定',
        effective_from: '2026-06-01',
        effective_to: null,
        auto_close_overlaps: true,
        config: { home_comprehensive_level: 'level_2' },
      }),
      {
        params: Promise.resolve({ id: 'site_1' }),
      },
    ))!;

    expect(response.status).toBe(201);
    expect(insuranceConfigUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: { in: ['config_2024'] },
      },
      data: {
        effective_to: new Date('2026-05-31T00:00:00.000Z'),
      },
    });
    expect(insuranceConfigCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        insurance_type: 'medical',
        revision_code: '2026',
        revision_label: '令和8年度改定',
        effective_from: new Date('2026-06-01'),
        effective_to: null,
        config: { home_comprehensive_level: 'level_2' },
      }),
    });
  });
});
