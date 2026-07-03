import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { authMock, prismaMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  prismaMock: {
    membership: { findFirst: vi.fn() },
    pharmacySite: { findFirst: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: prismaMock,
}));

import { GET } from './route';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

function createRequest(url = 'http://localhost/api/pharmacy-drug-stocks/template?site_id=site_1') {
  return new NextRequest(url, {
    headers: { 'x-org-id': 'org_1' },
  });
}

describe('/api/pharmacy-drug-stocks/template', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    prismaMock.membership.findFirst.mockResolvedValue({ role: 'admin' });
    prismaMock.pharmacySite.findFirst.mockResolvedValue({ id: 'site_1' });
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit_1' });
  });

  it('downloads a BOM-prefixed CSV template matching the bulk import headers', async () => {
    const response = await GET(createRequest(), { params: Promise.resolve({}) });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(response.headers.get('content-type')).toContain('text/csv');
    expect(response.headers.get('content-disposition')).toContain('formulary-template-site_1.csv');
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const csv = Buffer.from(bytes.slice(3)).toString('utf8');
    expect(csv).toBe('"YJコード","医薬品名","採用","発注点","優先後発品YJコード","メモ"\n');
    expect(prismaMock.pharmacySite.findFirst).toHaveBeenCalledWith({
      where: { id: 'site_1', org_id: 'org_1' },
      select: { id: true },
    });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          org_id: 'org_1',
          actor_id: 'user_1',
          action: 'pharmacy_drug_stock_template_downloaded',
          target_type: 'PharmacySite',
          target_id: 'site_1',
          changes: expect.objectContaining({
            site_id: 'site_1',
            headers: ['YJコード', '医薬品名', '採用', '発注点', '優先後発品YJコード', 'メモ'],
          }),
        }),
      }),
    );
  });

  it('rejects another org site before writing audit log', async () => {
    prismaMock.pharmacySite.findFirst.mockResolvedValue(null);

    const response = await GET(createRequest(), { params: Promise.resolve({}) });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expectSensitiveNoStore(response);
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('percent-encodes site ids in the download filename', async () => {
    prismaMock.pharmacySite.findFirst.mockResolvedValue({ id: 'site\r\nSet-Cookie:bad=1' });

    const response = await GET(
      createRequest(
        'http://localhost/api/pharmacy-drug-stocks/template?site_id=site%0D%0ASet-Cookie:bad=1',
      ),
      { params: Promise.resolve({}) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    const disposition = response.headers.get('content-disposition') ?? '';
    expect(disposition).toContain('formulary-template-site%0D%0ASet-Cookie%3Abad%3D1.csv');
    expect(disposition).not.toContain('\r');
    expect(disposition).not.toContain('\n');
  });

  it('allows an org-scoped generic template without a site_id', async () => {
    const response = await GET(
      createRequest('http://localhost/api/pharmacy-drug-stocks/template'),
      {
        params: Promise.resolve({}),
      },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(response.headers.get('content-disposition')).toContain('formulary-template.csv');
    expect(prismaMock.pharmacySite.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          target_type: 'PharmacyDrugStock',
          target_id: 'template',
          changes: expect.objectContaining({ site_id: null }),
        }),
      }),
    );
  });
});
