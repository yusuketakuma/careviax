import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

type AuthenticatedTestRequest = NextRequest & { orgId: string; userId: string; role: string };

const {
  pcaPumpFindFirstMock,
  prescriberInstitutionFindFirstMock,
  pcaPumpRentalFindManyMock,
  pcaPumpRentalCreateMock,
  pcaPumpUpdateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  pcaPumpFindFirstMock: vi.fn(),
  prescriberInstitutionFindFirstMock: vi.fn(),
  pcaPumpRentalFindManyMock: vi.fn(),
  pcaPumpRentalCreateMock: vi.fn(),
  pcaPumpUpdateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (handler: (req: AuthenticatedTestRequest) => Promise<Response>) => handler,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    pcaPump: {
      findFirst: pcaPumpFindFirstMock,
    },
    prescriberInstitution: {
      findFirst: prescriberInstitutionFindFirstMock,
    },
    pcaPumpRental: {
      findMany: pcaPumpRentalFindManyMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET, POST } from './route';

function createRequest(url: string, body?: unknown): AuthenticatedTestRequest {
  return Object.assign(
    new NextRequest(url, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { orgId: 'org_1', userId: 'user_1', role: 'admin' },
  );
}

const rentalRecord = {
  id: 'rental_1',
  org_id: 'org_1',
  pump_id: 'pump_1',
  institution_id: 'institution_1',
  status: 'active',
  rented_at: new Date('2026-06-10T00:00:00.000Z'),
  due_at: new Date('2026-06-20T00:00:00.000Z'),
  returned_at: null,
  contact_name: '山田看護師',
  contact_phone: '03-1234-5678',
  rental_fee_yen: 12000,
  notes: null,
  created_at: new Date('2026-06-10T01:00:00.000Z'),
  updated_at: new Date('2026-06-10T01:00:00.000Z'),
  pump: {
    id: 'pump_1',
    asset_code: 'PCA-001',
    serial_number: 'SN-001',
    model_name: 'CADD Legacy PCA',
    status: 'rented',
  },
  institution: {
    id: 'institution_1',
    name: 'みなと病院',
    institution_code: '1234567',
    phone: '03-1111-2222',
    fax: null,
  },
};

describe('/api/pca-pump-rentals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pcaPumpFindFirstMock.mockResolvedValue({ id: 'pump_1', status: 'available' });
    prescriberInstitutionFindFirstMock.mockResolvedValue({ id: 'institution_1' });
    pcaPumpRentalFindManyMock.mockResolvedValue([rentalRecord]);
    pcaPumpRentalCreateMock.mockResolvedValue(rentalRecord);
    pcaPumpUpdateMock.mockResolvedValue({ id: 'pump_1', status: 'rented' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        pcaPumpRental: {
          create: pcaPumpRentalCreateMock,
        },
        pcaPump: {
          update: pcaPumpUpdateMock,
        },
      }),
    );
  });

  it('lists PCA pump rentals scoped to org and status', async () => {
    const response = await GET(
      createRequest('http://localhost/api/pca-pump-rentals?status=active'),
    );

    expect(response.status).toBe(200);
    expect(pcaPumpRentalFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          status: 'active',
        },
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      data: [
        {
          id: 'rental_1',
          rented_at: '2026-06-10',
          due_at: '2026-06-20',
          pump: { asset_code: 'PCA-001' },
          institution: { name: 'みなと病院' },
        },
      ],
    });
  });

  it('creates a rental and marks the pump as rented in the same org transaction', async () => {
    const response = await POST(
      createRequest('http://localhost/api/pca-pump-rentals', {
        pump_id: 'pump_1',
        institution_id: 'institution_1',
        rented_at: '2026-06-10',
        due_at: '2026-06-20',
        contact_name: '山田看護師',
        contact_phone: '03-1234-5678',
        rental_fee_yen: 12000,
      }),
    );

    expect(response.status).toBe(201);
    expect(pcaPumpFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'pump_1', org_id: 'org_1' },
      select: { id: true, status: true },
    });
    expect(prescriberInstitutionFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'institution_1', org_id: 'org_1' },
      select: { id: true },
    });
    expect(pcaPumpRentalCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        pump_id: 'pump_1',
        institution_id: 'institution_1',
        status: 'active',
        rented_at: new Date('2026-06-10'),
        due_at: new Date('2026-06-20'),
        contact_name: '山田看護師',
        contact_phone: '03-1234-5678',
        rental_fee_yen: 12000,
      }),
      include: {
        pump: true,
        institution: true,
      },
    });
    expect(pcaPumpUpdateMock).toHaveBeenCalledWith({
      where: { id: 'pump_1' },
      data: { status: 'rented' },
    });
  });

  it('rejects already rented pumps before creating a rental', async () => {
    pcaPumpFindFirstMock.mockResolvedValue({ id: 'pump_1', status: 'rented' });

    const response = await POST(
      createRequest('http://localhost/api/pca-pump-rentals', {
        pump_id: 'pump_1',
        institution_id: 'institution_1',
        rented_at: '2026-06-10',
      }),
    );

    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(pcaPumpRentalCreateMock).not.toHaveBeenCalled();
    expect(pcaPumpUpdateMock).not.toHaveBeenCalled();
  });
});
