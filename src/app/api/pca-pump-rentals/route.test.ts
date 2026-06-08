import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

type AuthenticatedTestRequest = NextRequest & { orgId: string; userId: string; role: string };

const {
  pcaPumpFindFirstMock,
  prescriberInstitutionFindFirstMock,
  pcaPumpRentalFindManyMock,
  pcaPumpRentalCreateMock,
  pcaPumpUpdateManyMock,
  auditLogCreateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  pcaPumpFindFirstMock: vi.fn(),
  prescriberInstitutionFindFirstMock: vi.fn(),
  pcaPumpRentalFindManyMock: vi.fn(),
  pcaPumpRentalCreateMock: vi.fn(),
  pcaPumpUpdateManyMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
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
    pcaPumpUpdateManyMock.mockResolvedValue({ count: 1 });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        pcaPumpRental: {
          findMany: pcaPumpRentalFindManyMock,
          create: pcaPumpRentalCreateMock,
        },
        pcaPump: {
          findFirst: pcaPumpFindFirstMock,
          updateMany: pcaPumpUpdateManyMock,
        },
        prescriberInstitution: {
          findFirst: prescriberInstitutionFindFirstMock,
        },
        auditLog: {
          create: auditLogCreateMock,
        },
      }),
    );
  });

  it('lists PCA pump rentals scoped to org and status', async () => {
    const response = await GET(
      createRequest('http://localhost/api/pca-pump-rentals?status=active'),
    );

    expect(response.status).toBe(200);
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: expect.objectContaining({ orgId: 'org_1' }),
    });
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

  it('lists only open PCA pump rentals for operational queues', async () => {
    const response = await GET(createRequest('http://localhost/api/pca-pump-rentals?status=open'));

    expect(response.status).toBe(200);
    expect(pcaPumpRentalFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          status: { in: ['scheduled', 'active', 'overdue'] },
        },
      }),
    );
  });

  it('filters returned PCA pump rentals by return inspection status', async () => {
    const response = await GET(
      createRequest(
        'http://localhost/api/pca-pump-rentals?status=returned&inspection_status=pending',
      ),
    );

    expect(response.status).toBe(200);
    expect(pcaPumpRentalFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          status: 'returned',
          return_inspection_status: 'pending',
        },
      }),
    );
  });

  it('rejects invalid rental status filters', async () => {
    const response = await GET(
      createRequest('http://localhost/api/pca-pump-rentals?status=broken'),
    );

    expect(response.status).toBe(400);
    expect(pcaPumpRentalFindManyMock).not.toHaveBeenCalled();
  });

  it('rejects invalid return inspection status filters', async () => {
    const response = await GET(
      createRequest(
        'http://localhost/api/pca-pump-rentals?status=returned&inspection_status=unknown',
      ),
    );

    expect(response.status).toBe(400);
    expect(pcaPumpRentalFindManyMock).not.toHaveBeenCalled();
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
    expect(pcaPumpUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'pump_1',
        org_id: 'org_1',
        status: 'available',
      },
      data: { status: 'rented' },
    });
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        actor_id: 'user_1',
        action: 'pca_pump_rental_created',
        target_type: 'PcaPumpRental',
        target_id: 'rental_1',
        changes: expect.objectContaining({
          pump_id: 'pump_1',
          institution_id: 'institution_1',
          status: 'active',
        }),
      }),
    });
  });

  it('rejects open rentals without a due date', async () => {
    const response = await POST(
      createRequest('http://localhost/api/pca-pump-rentals', {
        pump_id: 'pump_1',
        institution_id: 'institution_1',
        status: 'active',
        rented_at: '2026-06-10',
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '入力値が不正です',
      details: {
        due_at: ['貸出中・予定・延滞のPCAポンプには返却予定日が必須です'],
      },
    });
    expect(pcaPumpFindFirstMock).not.toHaveBeenCalled();
    expect(pcaPumpRentalCreateMock).not.toHaveBeenCalled();
  });

  it('creates a returned rental with pending inspection and marks the pump maintenance', async () => {
    pcaPumpRentalCreateMock.mockResolvedValue({
      ...rentalRecord,
      status: 'returned',
      returned_at: new Date('2026-06-18T00:00:00.000Z'),
      return_inspection_status: 'pending',
      pump: { ...rentalRecord.pump, status: 'maintenance' },
    });

    const response = await POST(
      createRequest('http://localhost/api/pca-pump-rentals', {
        pump_id: 'pump_1',
        institution_id: 'institution_1',
        status: 'returned',
        rented_at: '2026-06-10',
        returned_at: '2026-06-18',
      }),
    );

    expect(response.status).toBe(201);
    expect(pcaPumpUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'pump_1',
        org_id: 'org_1',
        status: 'available',
      },
      data: { status: 'maintenance' },
    });
    expect(pcaPumpRentalCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: 'returned',
        returned_at: new Date('2026-06-18'),
        return_inspection_status: 'pending',
      }),
      include: {
        pump: true,
        institution: true,
      },
    });
  });

  it('rejects a rental if the pump cannot be claimed inside the transaction', async () => {
    pcaPumpUpdateManyMock.mockResolvedValue({ count: 0 });

    const response = await POST(
      createRequest('http://localhost/api/pca-pump-rentals', {
        pump_id: 'pump_1',
        institution_id: 'institution_1',
        rented_at: '2026-06-10',
        due_at: '2026-06-20',
      }),
    );

    expect(response.status).toBe(400);
    expect(pcaPumpRentalCreateMock).not.toHaveBeenCalled();
  });

  it('returns a validation error if the open-rental unique index rejects a race', async () => {
    withOrgContextMock
      .mockImplementationOnce(async (_orgId, callback) =>
        callback({
          pcaPump: { findFirst: pcaPumpFindFirstMock },
          prescriberInstitution: { findFirst: prescriberInstitutionFindFirstMock },
        }),
      )
      .mockRejectedValueOnce({ code: 'P2002' });

    const response = await POST(
      createRequest('http://localhost/api/pca-pump-rentals', {
        pump_id: 'pump_1',
        institution_id: 'institution_1',
        rented_at: '2026-06-10',
        due_at: '2026-06-20',
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'このPCAポンプには未完了の貸出があるため登録できません',
    });
  });

  it('rejects already rented pumps before creating a rental', async () => {
    pcaPumpFindFirstMock.mockResolvedValue({ id: 'pump_1', status: 'rented' });

    const response = await POST(
      createRequest('http://localhost/api/pca-pump-rentals', {
        pump_id: 'pump_1',
        institution_id: 'institution_1',
        rented_at: '2026-06-10',
        due_at: '2026-06-20',
      }),
    );

    expect(response.status).toBe(400);
    expect(withOrgContextMock).toHaveBeenCalledTimes(1);
    expect(pcaPumpRentalCreateMock).not.toHaveBeenCalled();
    expect(pcaPumpUpdateManyMock).not.toHaveBeenCalled();
  });
});
