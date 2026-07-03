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
  advisoryLockMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  pharmacySiteFindFirstMock: vi.fn(),
  insuranceConfigFindManyMock: vi.fn(),
  insuranceConfigFindFirstMock: vi.fn(),
  insuranceConfigUpdateManyMock: vi.fn(),
  insuranceConfigCreateMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
  advisoryLockMock: vi.fn(),
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

vi.mock('@/lib/db/advisory-lock', () => ({
  acquireAdvisoryTxLock: advisoryLockMock,
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

function createMalformedJsonPostRequest() {
  return new NextRequest('http://localhost/api/pharmacy-sites/site_1/insurance-configs', {
    method: 'POST',
    body: '{bad-json',
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
    advisoryLockMock.mockResolvedValue(undefined);
    // dedup / overlap の read は tx 内で行うため、tx クライアントにも findFirst/findMany を提供する。
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        pharmacySiteInsuranceConfig: {
          findFirst: insuranceConfigFindFirstMock,
          findMany: insuranceConfigFindManyMock,
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

  it('rejects blank route ids before loading insurance configs', async () => {
    const response = (await GET(createGetRequest(), {
      params: Promise.resolve({ id: '   ' }),
    }))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '薬局IDが不正です',
    });
    expect(pharmacySiteFindFirstMock).not.toHaveBeenCalled();
    expect(insuranceConfigFindManyMock).not.toHaveBeenCalled();
  });

  it('rejects non-object create payloads before loading the pharmacy site', async () => {
    const response = (await POST(createPostRequest([]), {
      params: Promise.resolve({ id: 'site_1' }),
    }))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(pharmacySiteFindFirstMock).not.toHaveBeenCalled();
    expect(insuranceConfigFindFirstMock).not.toHaveBeenCalled();
    expect(insuranceConfigFindManyMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(insuranceConfigCreateMock).not.toHaveBeenCalled();
  });

  it('rejects blank route ids before creating an insurance config', async () => {
    const response = (await POST(
      createPostRequest({
        insurance_type: 'care',
        revision_code: '2024',
        effective_from: '2024-04-01',
        effective_to: null,
        config: {},
      }),
      {
        params: Promise.resolve({ id: '   ' }),
      },
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '薬局IDが不正です',
    });
    expect(pharmacySiteFindFirstMock).not.toHaveBeenCalled();
    expect(insuranceConfigFindFirstMock).not.toHaveBeenCalled();
    expect(insuranceConfigFindManyMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(insuranceConfigCreateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON create payloads before loading the pharmacy site', async () => {
    const response = (await POST(createMalformedJsonPostRequest(), {
      params: Promise.resolve({ id: 'site_1' }),
    }))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(pharmacySiteFindFirstMock).not.toHaveBeenCalled();
    expect(insuranceConfigFindFirstMock).not.toHaveBeenCalled();
    expect(insuranceConfigFindManyMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(insuranceConfigCreateMock).not.toHaveBeenCalled();
  });

  it('rejects invalid effective_from dates before loading the pharmacy site', async () => {
    const response = (await POST(
      createPostRequest({
        insurance_type: 'care',
        revision_code: '2024',
        effective_from: '2024-02-30',
        effective_to: null,
        config: {},
      }),
      {
        params: Promise.resolve({ id: 'site_1' }),
      },
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '入力値が不正です',
    });
    expect(pharmacySiteFindFirstMock).not.toHaveBeenCalled();
    expect(insuranceConfigFindFirstMock).not.toHaveBeenCalled();
    expect(insuranceConfigFindManyMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(insuranceConfigCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
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

  it('detects a concurrently-created duplicate revision inside the transaction and skips insert (TOCTOU guard)', async () => {
    // 同時作成レース: advisory lock 取得後の tx 内 re-read で同一 revision_code の
    // 行が見つかった場合は create せず 400 を返す。tx 外 read→create の窓を塞いだ回帰確認。
    insuranceConfigFindFirstMock.mockResolvedValue({ id: 'config_existing' });

    const response = (await POST(
      createPostRequest({
        insurance_type: 'care',
        revision_code: '2024',
        effective_from: '2024-04-01',
        effective_to: null,
        config: {},
      }),
      {
        params: Promise.resolve({ id: 'site_1' }),
      },
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '同じ保険種別・改定年度の設定が既に存在します',
    });
    // advisory lock は org+site+insurance_type 単位で tx 内・re-read 前に取得される。
    expect(advisoryLockMock).toHaveBeenCalledTimes(1);
    expect(advisoryLockMock).toHaveBeenCalledWith(
      expect.anything(),
      'insurance_config_dedup',
      'org_1:site_1:care',
    );
    expect(insuranceConfigCreateMock).not.toHaveBeenCalled();
    expect(insuranceConfigUpdateManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });
});
